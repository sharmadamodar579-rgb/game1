import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { WorldManager } from './world.js';
import { LocalPlayer, RemotePlayer } from './player.js';
import { NetworkManager } from './network.js';

class GameApp {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.physicsWorld = null;
    
    // Core game managers
    this.world = null;
    this.localPlayer = null;
    this.peerPlayer = null;
    this.network = null;
    
    // Build options
    this.selectedTool = "neon-block"; // Default placing block
    this.isBuildMode = false;
    this.buildHelperMesh = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(0, 0);
    
    // Timers
    this.lastTime = performance.now();
    this.syncInterval = null;
    
    // Particles pool
    this.particles = [];
    
    // Setup engines
    this.initThree();
    this.initPhysics();
    
    // Instantiate managers
    this.world = new WorldManager(this);
    this.localPlayer = new LocalPlayer(this, this.camera, new THREE.Vector3(0, 5, 0));
    this.network = new NetworkManager(this);
    
    this.initBuildHelper();
    this.initInputListeners();
    this.initMobileControls();

    // Hide loader
    document.getElementById("loading-screen").style.opacity = 0;
    setTimeout(() => {
      document.getElementById("loading-screen").classList.add("hidden");
    }, 500);

    // Start rendering loops
    this.animate();
  }

  initThree() {
    // 1. Core WebGL Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070412);
    // Fog adds spatial depth
    this.scene.fog = new THREE.FogExp2(0x070412, 0.012);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById("game-canvas"),
      antialias: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 2. High-Fidelity Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambientLight);

    // Directional sunlight casting shadows
    const dirLight = new THREE.DirectionalLight(0xffd0f0, 0.85);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 100;
    const d = 40;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    // Ambient skyglow pointlight
    const pointLight = new THREE.PointLight(0x00f0ff, 1.2, 100);
    pointLight.position.set(0, 10, 0);
    this.scene.add(pointLight);

    // 3. Galactic Background Stars
    const starGeom = new THREE.BufferGeometry();
    const starCount = 600;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      // Random coordinates distributed on a sphere radius 120-200
      const radius = 120 + Math.random() * 80;
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      positions[i] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i+1] = Math.abs(radius * Math.sin(phi) * Math.sin(theta)); // keep above horizon
      positions[i+2] = radius * Math.cos(phi);
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.0,
      transparent: true,
      opacity: 0.8
    });
    const starField = new THREE.Points(starGeom, starMat);
    this.scene.add(starField);
  }

  initPhysics() {
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -22, 0) // realistic slightly heavy gravity
    });
  }

  initBuildHelper() {
    // 3D wireframe box highlighting the grid intersection
    const size = this.world.gridSize;
    const geom = new THREE.BoxGeometry(size, size, size);
    const edges = new THREE.EdgesGeometry(geom);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      linewidth: 2
    });
    this.buildHelperMesh = new THREE.LineSegments(edges, lineMat);
    this.buildHelperMesh.visible = false;
    this.scene.add(this.buildHelperMesh);
  }

  initInputListeners() {
    // Update pointer coordinates on mouse move
    window.addEventListener("mousemove", (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // Toggle Build Mode key
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "b") {
        this.toggleBuildMode();
      }
    });

    // Click on canvas places/deletes blocks (Desktop)
    window.addEventListener("mousedown", (e) => {
      if (!this.isBuildMode) return;
      // Ignore UI panel clicks
      if (e.target.closest(".hud-card") || e.target.closest("#lobby-overlay") || e.target.closest("#toolbox") || e.target.closest("#mobile-overlay")) return;

      if (e.button === 0) {
        // Left click: Place block
        this.raycastPlaceBlock();
      } else if (e.button === 2) {
        // Right click: Delete block
        this.raycastDeleteBlock();
      }
    });

    // Prevent context menu showing on right click
    window.addEventListener("contextmenu", (e) => {
      if (this.isBuildMode) {
        e.preventDefault();
      }
    });

    // Select tool items
    const toolBtns = document.querySelectorAll(".tool-btn");
    toolBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        toolBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.selectedTool = btn.dataset.type;
        this.updateBuildHelperColor();
      });
    });

    // Window resizing
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  toggleBuildMode() {
    this.isBuildMode = !this.isBuildMode;
    this.buildHelperMesh.visible = this.isBuildMode;

    const buildBtn = document.getElementById("btn-touch-mode");
    const placeBtn = document.getElementById("btn-touch-place");
    const deleteBtn = document.getElementById("btn-touch-delete");

    if (this.isBuildMode) {
      buildBtn.classList.add("active");
      placeBtn.classList.remove("hidden");
      deleteBtn.classList.remove("hidden");
    } else {
      buildBtn.classList.remove("active");
      placeBtn.classList.add("hidden");
      deleteBtn.classList.add("hidden");
    }
  }

  updateBuildHelperColor() {
    let color = 0x00f0ff;
    if (this.selectedTool === "crate") color = 0x8b5a2b;
    else if (this.selectedTool === "lava") color = 0xff3300;
    else if (this.selectedTool === "bounce") color = 0x00ffff;
    
    this.buildHelperMesh.material.color.setHex(color);
  }

  raycastPlaceBlock() {
    // Project ray from mouse position (or center screen on touch mobile devices)
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const result = this.world.getGridIntersection(this.raycaster);
    
    if (result) {
      this.world.placeBlock(result.position, this.selectedTool, true);
    }
  }

  raycastDeleteBlock() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.world.deleteBlockAtIntersection(this.raycaster);
  }

  initMobileControls() {
    // Detect mobile touch
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      document.getElementById("mobile-overlay").classList.remove("hidden");
    }

    // Touch events for Virtual Joystick
    const zone = document.getElementById("joystick-zone");
    const handle = document.getElementById("joystick-handle");
    const ring = document.getElementById("joystick-ring");
    
    let joystickActive = false;
    let joystickStartPos = { x: 0, y: 0 };
    const maxRadius = 45; // limit handle travel distance

    zone.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      const rect = ring.getBoundingClientRect();
      // Calculate center coordinates
      joystickStartPos = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      joystickActive = true;
      e.preventDefault();
    });

    zone.addEventListener("touchmove", (e) => {
      if (!joystickActive) return;
      const touch = e.touches[0];
      const dx = touch.clientX - joystickStartPos.x;
      const dy = touch.clientY - joystickStartPos.y;
      
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      let moveX = dx;
      let moveY = dy;

      if (distance > maxRadius) {
        moveX = (dx / distance) * maxRadius;
        moveY = (dy / distance) * maxRadius;
      }

      handle.style.transform = `translate(${moveX}px, ${moveY}px)`;

      // Map back to analog vector range [-1, 1]
      const joyVecX = moveX / maxRadius;
      const joyVecY = -moveY / maxRadius; // invert Y coordinate for forward/backward matching

      this.localPlayer.updateJoystickInput(joyVecX, joyVecY);
      e.preventDefault();
    });

    const resetJoystick = () => {
      joystickActive = false;
      handle.style.transform = `translate(0px, 0px)`;
      this.localPlayer.updateJoystickInput(0, 0);
    };

    zone.addEventListener("touchend", resetJoystick);
    zone.addEventListener("touchcancel", resetJoystick);

    // On-screen touch buttons listeners
    document.getElementById("btn-touch-jump").addEventListener("touchstart", (e) => {
      this.localPlayer.jump();
      e.preventDefault();
    });

    document.getElementById("btn-touch-mode").addEventListener("touchstart", (e) => {
      this.toggleBuildMode();
      e.preventDefault();
    });

    document.getElementById("btn-touch-place").addEventListener("touchstart", (e) => {
      // Force screen center raycasting for tap placement
      this.mouse.set(0, 0);
      this.raycastPlaceBlock();
      e.preventDefault();
    });

    document.getElementById("btn-touch-delete").addEventListener("touchstart", (e) => {
      this.mouse.set(0, 0);
      this.raycastDeleteBlock();
      e.preventDefault();
    });
  }

  syncPeerPlayer(data) {
    if (!this.peerPlayer) {
      this.peerPlayer = new RemotePlayer(this, new THREE.Vector3(data.x, data.y, data.z));
      this.network.appendSystemMessage("🌐 Peer entered sandbox. Synced graphics & positions.");
    }
    this.peerPlayer.updateData(data);
  }

  onPeerDisconnected() {
    if (this.peerPlayer) {
      this.peerPlayer.cleanup();
      this.peerPlayer = null;
      this.network.appendSystemMessage("🔌 Peer disconnected. Cleared meshes.");
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.world.clearPlacedBlocks();
  }

  startMultiplayerSync() {
    // Send local position/rotation updates 20 times per second
    this.syncInterval = setInterval(() => {
      if (this.localPlayer && this.network.conn && this.network.conn.open) {
        this.network.sendSyncPacket({
          x: this.localPlayer.body.position.x,
          y: this.localPlayer.body.position.y,
          z: this.localPlayer.body.position.z,
          rotY: this.localPlayer.mesh.rotation.y
        });
      }
    }, 50);
  }

  spawnPlacementParticles(position, colorHex, count = 10) {
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(count * 3);
    const particleVelocities = [];

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      particlePositions[idx] = position.x;
      particlePositions[idx + 1] = position.y + 0.5;
      particlePositions[idx + 2] = position.z;

      // Random explosion vectors
      particleVelocities.push({
        x: (Math.random() - 0.5) * 0.15,
        y: (Math.random() - 0.2) * 0.2,
        z: (Math.random() - 0.5) * 0.15
      });
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const material = new THREE.PointsMaterial({
      color: colorHex,
      size: 0.35,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(particleGeometry, material);
    this.scene.add(points);

    this.particles.push({
      points: points,
      velocities: particleVelocities,
      positionsArray: particlePositions,
      life: 1.0, // starts at full life
      decay: 0.035
    });
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= p.decay;

      if (p.life <= 0) {
        this.scene.remove(p.points);
        p.points.geometry.dispose();
        p.points.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      // Fade out materials over lifespan
      p.points.material.opacity = p.life;
      
      const posAttr = p.points.geometry.attributes.position;
      const array = posAttr.array;

      for (let j = 0; j < p.velocities.length; j++) {
        const idx = j * 3;
        const vel = p.velocities[j];
        
        array[idx] += vel.x;
        array[idx + 1] += vel.y;
        array[idx + 2] += vel.z;

        // Apply drag/gravity to particles
        vel.y -= 0.005;
        vel.x *= 0.98;
        vel.z *= 0.98;
      }
      posAttr.needsUpdate = true;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    if (dt > 0.1) dt = 0.1; // clamp delta to prevent physics explosion after tab freeze
    this.lastTime = now;

    // 1. Advance physical time step
    this.physicsWorld.fixedStep();

    // 2. Update agents
    this.localPlayer.update();
    if (this.peerPlayer) {
      this.peerPlayer.update();
    }
    
    // 3. Update world dynamics (crates, bounce pads)
    this.world.update();

    // 4. Update particles
    this.updateParticles();

    // 5. Update wireframe grid projection helper (Build Mode)
    if (this.isBuildMode) {
      // Center raycast for mobile touch, otherwise pointer-controlled raycast
      const isTouch = document.getElementById("mobile-overlay").classList.contains("hidden") === false;
      if (isTouch) {
        this.mouse.set(0, 0); // center of screen
      }
      
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const result = this.world.getGridIntersection(this.raycaster);
      if (result) {
        this.buildHelperMesh.position.copy(result.position);
        this.buildHelperMesh.visible = true;
      } else {
        this.buildHelperMesh.visible = false;
      }
    }

    // 6. Draw WebGL Scene to target viewport
    this.renderer.render(this.scene, this.camera);
  }
}

// Instantiate game on load
window.addEventListener("DOMContentLoaded", () => {
  window.gameApp = new GameApp();
});
