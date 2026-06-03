import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { WorldManager } from './world.js';
import { LocalPlayer, RemotePlayer, HumanoidAvatar } from './player.js';
import { NetworkManager } from './network.js';

class GameApp {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.physicsWorld = null;

    // Game states
    this.gameState = "launch"; // launch -> lobby -> loading -> game
    this.selectedTheme = "neon"; // default
    this.localNickname = "Player";
    
    // Mannequin configurations
    this.localMannequinType = "K"; // "K" (Male) or "R" (Female)
    this.localOutfitColor = "0xff007f"; // Default neon pink
    this.localWardrobeOutfit = {
      head: "none",
      torso: "none",
      legs: "none",
      feet: "none"
    };

    // Client entities
    this.world = null;
    this.localPlayer = null;
    this.peerPlayers = new Map(); // peerId -> RemotePlayer

    // Lobby preview meshes mapping (peerId -> HumanoidAvatar)
    this.lobbyAvatars = new Map();

    // Matching network
    this.network = null;

    // Raycast / Building tools
    this.selectedTool = "neon-block";
    this.isBuildMode = false;
    this.buildHelperMesh = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(0, 0);

    // Dynamic particles pool
    this.particles = [];
    this.lastTime = performance.now();
    this.syncInterval = null;

    // Boot systems
    this.initThree();
    this.initPhysics();

    this.world = new WorldManager(this);
    this.network = new NetworkManager(this);

    this.initBuildHelper();
    this.initUIControllers();
    this.startLaunchSequence();

    // Start frame ticks
    this.animate();
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070412);
    this.scene.fog = new THREE.FogExp2(0x070412, 0.012);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Position camera initially looking at the lobby platform
    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1.8, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById("game-canvas"),
      antialias: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Starfield background
    const starGeom = new THREE.BufferGeometry();
    const starCount = 500;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      const radius = 120 + Math.random() * 80;
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      positions[i] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i+1] = Math.abs(radius * Math.sin(phi) * Math.sin(theta));
      positions[i+2] = radius * Math.cos(phi);
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.9,
      transparent: true,
      opacity: 0.75
    });
    this.scene.add(new THREE.Points(starGeom, starMat));
  }

  initPhysics() {
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -22, 0)
    });
  }

  initBuildHelper() {
    const size = this.world.gridSize;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
    this.buildHelperMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 }));
    this.buildHelperMesh.visible = false;
    this.scene.add(this.buildHelperMesh);
  }

  startLaunchSequence() {
    // Screen 1: Auto advance to Lobby (Screen 2) after assets load
    setTimeout(() => {
      document.getElementById("loading-screen").style.opacity = 0;
      setTimeout(() => {
        document.getElementById("loading-screen").classList.add("hidden");
        this.transitionToScreen("screen-login");
      }, 500);
    }, 2000);
  }

  initUIControllers() {
    // Stage navigation helper buttons
    const backBtns = document.querySelectorAll(".btn-back");
    backBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const currentScreen = document.querySelector(".screen-panel.active");
        if (currentScreen.id === "screen-mode") {
          this.transitionToScreen("screen-login");
        } else if (currentScreen.id === "screen-multi-config") {
          this.transitionToScreen("screen-mode");
        } else if (currentScreen.id === "screen-private-lobby") {
          this.transitionToScreen("screen-multi-config");
        } else if (currentScreen.id === "screen-theme") {
          const isSingle = this.network.isSinglePlayer;
          this.transitionToScreen(isSingle ? "screen-mode" : "screen-multi-config");
        }
      });
    });

    // 1. LOGIN SCREEN Handlers
    const btnLoginNext = document.getElementById("btn-login-next");
    const txtUsername = document.getElementById("txt-username");
    
    // Character selector toggles K vs R
    const btnMale = document.getElementById("btn-char-male");
    const btnFemale = document.getElementById("btn-char-female");

    btnMale.addEventListener("click", () => {
      btnFemale.classList.remove("active");
      btnMale.classList.add("active");
      this.localMannequinType = "K";
      this.rebuildLobbyPreview();
    });

    btnFemale.addEventListener("click", () => {
      btnMale.classList.remove("active");
      btnFemale.classList.add("active");
      this.localMannequinType = "R";
      this.rebuildLobbyPreview();
    });

    btnLoginNext.addEventListener("click", async () => {
      const name = txtUsername.value.trim();
      if (!name) {
        alert("Please enter a valid Nickname.");
        return;
      }
      this.localNickname = name;
      btnLoginNext.disabled = true;
      btnLoginNext.textContent = "Connecting Net...";

      try {
        // Boot PeerJS connection instantly in Lobby
        const handle = await this.network.initPeer(name);
        this.transitionToScreen("screen-mode");
        
        // Spawn local mannequin preview in lobby scene
        this.rebuildLobbyPreview();
        this.startLobbyFriendPings();
      } catch (err) {
        alert("Failed to initialize lobby connection network. Try again.");
        btnLoginNext.disabled = false;
        btnLoginNext.textContent = "Next";
      }
    });

    // 2. MODE SELECTION Handlers
    document.getElementById("btn-mode-single").addEventListener("click", () => {
      this.network.isSinglePlayer = true;
      this.transitionToScreen("screen-theme");
    });

    document.getElementById("btn-mode-multi").addEventListener("click", () => {
      this.network.isSinglePlayer = false;
      this.transitionToScreen("screen-multi-config");
    });

    // 3. MULTIPLAYER SETTINGS Config
    const limitBtns = this.network.limitToggleGroup.querySelectorAll(".toggle-btn");
    let playerLimit = 2;
    limitBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        limitBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        playerLimit = parseInt(btn.dataset.val);
      });
    });

    const privacyBtns = this.network.privacyToggleGroup.querySelectorAll(".toggle-btn");
    let privacyType = "public";
    privacyBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        privacyBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        privacyType = btn.dataset.val;
      });
    });

    document.getElementById("btn-multi-config-next").addEventListener("click", () => {
      if (privacyType === "private") {
        this.transitionToScreen("screen-private-lobby");
      } else {
        // Public matchmaking starts immediately
        this.network.startHostingLobby(playerLimit, false);
        this.transitionToScreen("screen-theme");
      }
    });

    // 4. PRIVATE LOBBY Host / Join
    document.getElementById("btn-host-private").addEventListener("click", () => {
      this.network.startHostingLobby(playerLimit, true);
    });

    document.getElementById("btn-join-private").addEventListener("click", () => {
      const code = document.getElementById("txt-private-join-id").value.trim();
      if (!code) return;
      this.network.joinPrivateLobby(code);
    });

    // 5. THEME SELECTION Picker
    const themeCards = document.querySelectorAll(".theme-card");
    themeCards.forEach(card => {
      card.addEventListener("click", () => {
        themeCards.forEach(c => c.classList.remove("active"));
        card.classList.add("active");
        this.selectedTheme = card.dataset.theme;
        this.world.applyThemeSettings(this.selectedTheme);
      });
    });

    document.getElementById("btn-start-game").addEventListener("click", () => {
      if (this.network.isSinglePlayer) {
        this.transitionToGameScreen(this.selectedTheme);
      } else {
        // Trigger matching clients to start
        this.network.broadcastStartGame(this.selectedTheme);
        this.transitionToGameScreen(this.selectedTheme);
      }
    });

    // 6. IN-GAME EXIT Handlers
    document.getElementById("btn-exit").addEventListener("click", () => {
      this.network.disconnect();
    });

    // 7. WARDROBE HUD customization drawer click triggers
    const optBtns = document.querySelectorAll(".opt-btn");
    optBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const slot = btn.parentElement.dataset.slot;
        const item = btn.dataset.item;
        
        btn.parentElement.querySelectorAll(".opt-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        this.localWardrobeOutfit[slot] = item;
        this.updateLocalWardrobe();
      });
    });

    const colorDots = document.querySelectorAll(".color-dot");
    colorDots.forEach(dot => {
      dot.addEventListener("click", () => {
        colorDots.forEach(d => d.classList.remove("active"));
        dot.classList.add("active");
        
        this.localOutfitColor = dot.dataset.color;
        this.updateLocalWardrobe();
      });
    });

    document.getElementById("btn-close-wardrobe").addEventListener("click", () => {
      document.getElementById("wardrobe-panel").classList.add("hidden");
    });

    // Mobile Closet HUD trigger
    document.getElementById("btn-touch-wardrobe").addEventListener("touchstart", (e) => {
      document.getElementById("wardrobe-panel").classList.remove("hidden");
      e.preventDefault();
    });

    // 8. Key listening to trigger Closet during gameplay
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "e" && this.gameState === "game" && this.world.isNearWardrobe) {
        document.getElementById("wardrobe-panel").classList.toggle("hidden");
      }
    });
  }

  transitionToScreen(screenId) {
    document.querySelectorAll(".screen-panel").forEach(s => s.classList.remove("active"));
    document.getElementById(screenId).classList.add("active");
  }

  // Live 3D humanoid mesh previews inside lobby
  rebuildLobbyPreview() {
    // Clear old local preview
    if (this.localLobbyAvatar) {
      this.scene.remove(this.localLobbyAvatar.group);
    }

    this.localLobbyAvatar = new HumanoidAvatar(
      this.localMannequinType,
      this.localOutfitColor,
      this.localWardrobeOutfit
    );
    this.localLobbyAvatar.group.position.set(0, 0.4, 0); // Center stage
    this.scene.add(this.localLobbyAvatar.group);

    // Sync outfit data to matching peers in lobby
    this.network.broadcastLobbyOutfit(this.localMannequinType, this.localWardrobeOutfit);
  }

  updateLocalWardrobe() {
    // Rebuild local mesh representation
    if (this.localPlayer) {
      // In-game update
      this.localPlayer.updateMannequin(
        this.localMannequinType,
        this.localOutfitColor,
        this.localWardrobeOutfit
      );
      this.network.broadcastInGameOutfit(this.localMannequinType, this.localWardrobeOutfit);
    } else {
      // Lobby preview update
      this.rebuildLobbyPreview();
    }
  }

  addLobbyPeer(peerId, handle, model, wardrobe) {
    if (this.lobbyAvatars.has(peerId)) return;

    // Offset position to stand next to host player on lobby circle platform
    const index = this.lobbyAvatars.size + 1;
    const angle = (index * Math.PI) / 3;
    const x = 3.5 * Math.sin(angle);
    const z = -3.5 * Math.cos(angle);

    const avatar = new HumanoidAvatar(model, "0x00f0ff", wardrobe); // Cyan neon for peer
    avatar.group.position.set(x, 0.4, z);
    this.scene.add(avatar.group);

    this.lobbyAvatars.set(peerId, avatar);
    this.network.appendSystemMessage(`👥 ${handle} joined lobby room.`);
  }

  updateLobbyPeerOutfit(peerId, model, wardrobe) {
    const avatar = this.lobbyAvatars.get(peerId);
    if (avatar) {
      const pos = avatar.group.position.clone();
      this.scene.remove(avatar.group);

      const updatedAvatar = new HumanoidAvatar(model, "0x00f0ff", wardrobe);
      updatedAvatar.group.position.copy(pos);
      this.scene.add(updatedAvatar.group);

      this.lobbyAvatars.set(peerId, updatedAvatar);
    }
  }

  // Match launching loading screen (Screen 3)
  transitionToGameScreen(mapTheme) {
    this.gameState = "game";
    
    // Slide UI lobbies
    this.lobbyOverlay.classList.remove("active");
    this.lobbyManager.classList.remove("active");

    // Clear lobby previews
    if (this.localLobbyAvatar) {
      this.scene.remove(this.localLobbyAvatar.group);
      this.localLobbyAvatar = null;
    }
    this.lobbyAvatars.forEach(avatar => this.scene.remove(avatar.group));
    this.lobbyAvatars.clear();

    // Apply theme
    this.world.applyThemeSettings(mapTheme);

    // Boot player in physics world
    this.localPlayer = new LocalPlayer(this, this.camera, new THREE.Vector3(0, 5, 0));

    // Convert active lobby connections into remote gameplay entities
    this.network.connections.forEach((conn, peerId) => {
      // Connect gameplay entity representation
      const startPos = new THREE.Vector3(0, 5, 0);
      const peerPlayer = new RemotePlayer(this, startPos, conn.metadata.model, "0x00f0ff", conn.metadata.wardrobe);
      this.peerPlayers.set(peerId, peerPlayer);
    });

    document.getElementById("game-hud").classList.remove("hidden");
    
    // Enable core builder inputs listeners
    this.initGameInputListeners();

    // Start sync timer
    this.startMultiplayerSync();
  }

  initGameInputListeners() {
    window.addEventListener("mousemove", (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // Toggle build key
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "b") {
        this.isBuildMode = !this.isBuildMode;
        this.buildHelperMesh.visible = this.isBuildMode;
      }
    });

    // Placement
    window.addEventListener("mousedown", (e) => {
      if (!this.isBuildMode || this.gameState !== "game") return;
      if (e.target.closest(".hud-card") || e.target.closest("#toolbox")) return;

      if (e.button === 0) {
        this.raycastPlace();
      } else if (e.button === 2) {
        this.raycastDelete();
      }
    });

    window.addEventListener("contextmenu", (e) => {
      if (this.isBuildMode && this.gameState === "game") {
        e.preventDefault();
      }
    });

    // Toolbar select
    const toolBtns = document.querySelectorAll(".tool-btn");
    toolBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        toolBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.selectedTool = btn.dataset.type;
        
        let color = 0x00f0ff;
        if (this.selectedTool === "crate") color = 0x8b5a2b;
        else if (this.selectedTool === "lava") color = 0xff3300;
        else if (this.selectedTool === "bounce") color = 0x00ffff;
        this.buildHelperMesh.material.color.setHex(color);
      });
    });
  }

  raycastPlace() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const res = this.world.getGridIntersection(this.raycaster);
    if (res) {
      this.world.placeBlock(res.position, this.selectedTool, true);
    }
  }

  raycastDelete() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.world.deleteBlockAtIntersection(this.raycaster);
  }

  // Lobby online ping loops
  startLobbyFriendPings() {
    setInterval(() => {
      this.network.pingFriends((handle, isOnline) => {
        // Look for friends list matching items to toggle lights
        console.log(`Friend ping: ${handle} is ${isOnline ? "Online" : "Offline"}`);
      });
    }, 6000);
  }

  syncPeerPosition(peerId, data) {
    const player = this.peerPlayers.get(peerId);
    if (player) {
      player.updateData(data);
    }
  }

  syncPeerOutfit(peerId, model, wardrobe) {
    const player = this.peerPlayers.get(peerId);
    if (player) {
      player.updateOutfit(model, "0x00f0ff", wardrobe);
    }
  }

  removePeer(peerId) {
    const player = this.peerPlayers.get(peerId);
    if (player) {
      player.cleanup();
      this.peerPlayers.delete(peerId);
    }
    const lobbyAvatar = this.lobbyAvatars.get(peerId);
    if (lobbyAvatar) {
      this.scene.remove(lobbyAvatar.group);
      this.lobbyAvatars.delete(peerId);
    }
  }

  onPeerReset() {
    this.peerPlayers.forEach(p => p.cleanup());
    this.peerPlayers.clear();
    this.lobbyAvatars.forEach(a => this.scene.remove(a.group));
    this.lobbyAvatars.clear();

    if (this.localPlayer) {
      this.localPlayer.cleanup();
      this.localPlayer = null;
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.world.clearPlacedBlocks();
    this.gameState = "lobby";
    
    // Return camera to overview angles
    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1.8, 0);
  }

  startMultiplayerSync() {
    this.syncInterval = setInterval(() => {
      if (this.localPlayer && !this.network.isSinglePlayer) {
        this.network.broadcastSync({
          x: this.localPlayer.body.position.x,
          y: this.localPlayer.body.position.y,
          z: this.localPlayer.body.position.z,
          rotY: this.localPlayer.avatar.group.rotation.y
        });
      }
    }, 50);
  }

  toggleWardrobeTrigger(isNear) {
    const touchBtn = document.getElementById("btn-touch-wardrobe");
    if (isNear) {
      touchBtn.classList.remove("hidden");
      this.network.appendSystemMessage("👕 Near Closet block. Press E to configure wardrobe outfit.");
    } else {
      touchBtn.classList.add("hidden");
      document.getElementById("wardrobe-panel").classList.add("hidden");
    }
  }

  spawnPlacementParticles(pos, colorHex, count = 10) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      positions[idx] = pos.x;
      positions[idx + 1] = pos.y + 0.3;
      positions[idx + 2] = pos.z;

      velocities.push({
        x: (Math.random() - 0.5) * 0.12,
        y: (Math.random() - 0.2) * 0.18,
        z: (Math.random() - 0.5) * 0.12
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex,
      size: 0.3,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, mat);
    this.scene.add(points);

    this.particles.push({
      points,
      velocities,
      positionsArray: positions,
      life: 1.0,
      decay: 0.04
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

      p.points.material.opacity = p.life;
      
      const posAttr = p.points.geometry.attributes.position;
      const array = posAttr.array;

      for (let j = 0; j < p.velocities.length; j++) {
        const idx = j * 3;
        const vel = p.velocities[j];
        
        array[idx] += vel.x;
        array[idx + 1] += vel.y;
        array[idx + 2] += vel.z;

        vel.y -= 0.005; // gravity
        vel.x *= 0.97;
        vel.z *= 0.97;
      }
      posAttr.needsUpdate = true;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    if (dt > 0.1) dt = 0.1;
    this.lastTime = now;

    if (this.gameState === "game") {
      this.physicsWorld.fixedStep();
      
      if (this.localPlayer) this.localPlayer.update();
      this.peerPlayers.forEach(p => p.update());
      this.world.update();
      this.updateParticles();

      // Grid placement highlights
      if (this.isBuildMode) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const result = this.world.getGridIntersection(this.raycaster);
        if (result) {
          this.buildHelperMesh.position.copy(result.position);
          this.buildHelperMesh.visible = true;
        } else {
          this.buildHelperMesh.visible = false;
        }
      }
    } else if (this.gameState === "launch" || this.gameState === "lobby") {
      // Idle rotation animations for lobby previews
      if (this.localLobbyAvatar) {
        this.localLobbyAvatar.group.rotation.y += 0.006;
        // Float hovering bob
        this.localLobbyAvatar.group.position.y = 0.4 + Math.sin(Date.now() * 0.002) * 0.05;
      }
      this.lobbyAvatars.forEach((avatar, id) => {
        avatar.group.rotation.y += 0.006;
        avatar.group.position.y = 0.4 + Math.sin(Date.now() * 0.002) * 0.05;
      });
      // Orbit asteroid stones
      this.world.update();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.gameApp = new GameApp();
});
