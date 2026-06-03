import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Robot Avatar Construction helper
function createRobotAvatar(colorHex) {
  const group = new THREE.Group();
  
  // Metallic black body base
  const bodyGeom = new THREE.BoxGeometry(1.2, 1.2, 1.0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x181528,
    roughness: 0.4,
    metalness: 0.8
  });
  const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
  bodyMesh.position.y = 0.6;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // Visor head
  const headGeom = new THREE.BoxGeometry(0.8, 0.6, 0.8);
  const headMesh = new THREE.Mesh(headGeom, bodyMat);
  headMesh.position.y = 1.5;
  headMesh.castShadow = true;
  group.add(headMesh);

  // Emissive visor face (makes it look like a real robot!)
  const visorGeom = new THREE.BoxGeometry(0.7, 0.2, 0.1);
  const visorMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.5,
    roughness: 0.1
  });
  const visorMesh = new THREE.Mesh(visorGeom, visorMat);
  visorMesh.position.set(0, 1.5, 0.41);
  group.add(visorMesh);

  // Hover ring base
  const ringGeom = new THREE.TorusGeometry(0.6, 0.12, 8, 24);
  const ringMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.8,
    roughness: 0.2
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.y = -0.2;
  ringMesh.castShadow = true;
  group.add(ringMesh);

  // Glow under-thruster
  const thrusterGeom = new THREE.ConeGeometry(0.4, 0.6, 8);
  const thrusterMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.7
  });
  const thrusterMesh = new THREE.Mesh(thrusterGeom, thrusterMat);
  thrusterMesh.rotation.x = Math.PI;
  thrusterMesh.position.y = -0.6;
  group.add(thrusterMesh);

  return group;
}

export class LocalPlayer {
  constructor(game, camera, initialPos) {
    this.game = game;
    this.camera = camera;
    
    // Physics properties
    this.speed = 12;
    this.jumpForce = 8.5;
    
    // Joystick vector
    this.joystickX = 0;
    this.joystickY = 0;
    
    // Keyboard inputs
    this.keys = { w: false, a: false, s: false, d: false, space: false };
    
    // Setup rigid physical body (Sphere collider avoids tipping issues)
    const radius = 1.0;
    this.shape = new CANNON.Sphere(radius);
    this.body = new CANNON.Body({
      mass: 65, // Kg player weight
      shape: this.shape,
      material: this.game.world.groundMaterial,
      fixedRotation: true,
      linearDamping: 0.15
    });
    this.body.position.copy(initialPos);
    this.game.physicsWorld.addBody(this.body);

    // Setup 3D mesh
    this.mesh = createRobotAvatar(0xff007f); // Pink neon for local
    this.game.scene.add(this.mesh);

    // Third-person Camera controls state
    this.cameraDistance = 9;
    this.cameraTheta = 0; // horizontal angle
    this.cameraPhi = Math.PI / 6; // vertical angle (elevated)
    
    this.initControls();
  }

  initControls() {
    // Keyboard listeners
    window.addEventListener("keydown", (e) => this.handleKey(e, true));
    window.addEventListener("keyup", (e) => this.handleKey(e, false));

    // Mouse drag camera tracking
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    window.addEventListener("mousedown", (e) => {
      // Ignore clicks on HUD cards
      if (e.target.closest(".hud-card") || e.target.closest("#lobby-overlay") || e.target.closest("#toolbox") || e.target.closest("#mobile-overlay")) return;
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      // Orbit coefficients
      this.cameraTheta -= deltaX * 0.007;
      this.cameraPhi = Math.max(0.05, Math.min(Math.PI / 2.1, this.cameraPhi + deltaY * 0.007));
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    // Touch dragging for camera on mobile screens
    window.addEventListener("touchmove", (e) => {
      if (e.target.closest("#joystick-zone") || e.target.closest(".touch-actions-group")) return;
      if (e.touches.length === 1 && !isDragging) {
        // Start dragging camera via swipe
        isDragging = true;
        prevMouseX = e.touches[0].clientX;
        prevMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 1 && isDragging) {
        const deltaX = e.touches[0].clientX - prevMouseX;
        const deltaY = e.touches[0].clientY - prevMouseY;
        prevMouseX = e.touches[0].clientX;
        prevMouseY = e.touches[0].clientY;

        this.cameraTheta -= deltaX * 0.01;
        this.cameraPhi = Math.max(0.05, Math.min(Math.PI / 2.1, this.cameraPhi + deltaY * 0.01));
      }
    });

    window.addEventListener("touchend", () => {
      isDragging = false;
    });

    // Mouse wheel zoom
    window.addEventListener("wheel", (e) => {
      this.cameraDistance = Math.max(4, Math.min(20, this.cameraDistance + e.deltaY * 0.008));
    });
  }

  handleKey(e, isPressed) {
    const key = e.key.toLowerCase();
    if (key === "w" || key === "arrowup") this.keys.w = isPressed;
    if (key === "a" || key === "arrowleft") this.keys.a = isPressed;
    if (key === "s" || key === "arrowdown") this.keys.s = isPressed;
    if (key === "d" || key === "arrowright") this.keys.d = isPressed;
    if (key === " ") this.keys.space = isPressed;
  }

  updateJoystickInput(x, y) {
    this.joystickX = x;
    this.joystickY = y;
  }

  jump() {
    if (this.isGrounded()) {
      this.body.velocity.y = this.jumpForce;
      this.game.spawnPlacementParticles(this.body.position, 0xff007f, 8);
    }
  }

  isGrounded() {
    // Cast a physical ray downwards to see if we are standing on a solid shape
    const start = this.body.position;
    const end = new CANNON.Vec3(start.x, start.y - 1.25, start.z);
    
    // Find closest ray intersection
    const result = new CANNON.RaycastResult();
    const ray = new CANNON.Ray();
    ray.from = start;
    ray.to = end;

    // Check collisions
    let intersects = false;
    this.game.physicsWorld.bodies.forEach(b => {
      if (b === this.body) return;
      if (b.shapeTrigger) return; // ignore triggers
      
      const res = new CANNON.RaycastResult();
      b.pointToLocal(start, new CANNON.Vec3());
      if (ray.intersectBody(b, res)) {
        // Double check distance
        const distance = start.distanceTo(res.hitPointWorld);
        if (distance < 1.3) {
          intersects = true;
        }
      }
    });

    // Fallback: simple floor coordinate check
    if (start.y < 1.1 && start.y > 0.9) return true;

    return intersects;
  }

  update() {
    // 1. Calculate movement vectors based on Camera alignment
    let moveX = 0;
    let moveZ = 0;

    if (this.keys.w) moveZ -= 1;
    if (this.keys.s) moveZ += 1;
    if (this.keys.a) moveX -= 1;
    if (this.keys.d) moveX += 1;

    // Incorporate mobile joystick vectors
    if (Math.abs(this.joystickX) > 0.05 || Math.abs(this.joystickY) > 0.05) {
      moveX = this.joystickX;
      moveZ = -this.joystickY; // map screen joystick coordinates back to 3D Z
    }

    // Align vectors with Camera horizontal plane
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    camForward.y = 0;
    camForward.normalize();

    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    camRight.y = 0;
    camRight.normalize();

    const targetMove = new THREE.Vector3()
      .addScaledVector(camForward, moveZ)
      .addScaledVector(camRight, moveX);

    // Normalize length for clean speed limit caps
    if (targetMove.length() > 0.01) {
      if (targetMove.length() > 1) targetMove.normalize();
      
      // Update physics velocity directly for responsive ground steering
      this.body.velocity.x = targetMove.x * this.speed;
      this.body.velocity.z = targetMove.z * this.speed;

      // Rotate avatar towards direction of movement smoothly
      const targetRotation = Math.atan2(targetMove.x, targetMove.z);
      // Linear interpolation of angle
      let diff = targetRotation - this.mesh.rotation.y;
      // Normalize angle difference to (-PI, PI]
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.mesh.rotation.y += diff * 0.15;
    } else {
      // Rapid deceleration on release to avoid sliding
      this.body.velocity.x *= 0.8;
      this.body.velocity.z *= 0.8;
    }

    // Keyboard Jump
    if (this.keys.space) {
      this.jump();
      this.keys.space = false; // consume trigger
    }

    // 2. Sync 3D Mesh positions with physics
    this.mesh.position.copy(this.body.position);
    // Add custom hover tilt effects based on velocities
    this.mesh.rotation.x = -this.body.velocity.z * 0.015;
    this.mesh.rotation.z = this.body.velocity.x * 0.015;

    // 3. Coordinate Third-Person Follow Camera
    const targetCamX = this.body.position.x + this.cameraDistance * Math.sin(this.cameraTheta) * Math.cos(this.cameraPhi);
    const targetCamY = this.body.position.y + this.cameraDistance * Math.sin(this.cameraPhi);
    const targetCamZ = this.body.position.z + this.cameraDistance * Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi);

    this.camera.position.set(targetCamX, targetCamY, targetCamZ);
    // Camera focuses slightly above player body center
    this.camera.lookAt(this.body.position.x, this.body.position.y + 0.5, this.body.position.z);
  }

  cleanup() {
    this.game.physicsWorld.removeBody(this.body);
    this.game.scene.remove(this.mesh);
  }
}

export class RemotePlayer {
  constructor(game, initialPos) {
    this.game = game;
    
    // Remote avatar setup with blue cyan color theme
    this.mesh = createRobotAvatar(0x00f0ff);
    this.mesh.position.copy(initialPos);
    this.game.scene.add(this.mesh);
    
    // Target position for interpolation
    this.targetPos = new THREE.Vector3().copy(initialPos);
    this.targetRotY = 0;
  }

  updateData(syncPacket) {
    this.targetPos.set(syncPacket.x, syncPacket.y, syncPacket.z);
    this.targetRotY = syncPacket.rotY;
  }

  update() {
    // Smoothly slide mesh coordinates to match synchronized packages (LERP)
    this.mesh.position.lerp(this.targetPos, 0.25);
    
    // Interpolate rotation angle accurately
    let diff = this.targetRotY - this.mesh.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.mesh.rotation.y += diff * 0.25;

    // Thruster hover bobbing effect
    this.mesh.position.y += Math.sin(Date.now() * 0.01) * 0.02;
  }

  cleanup() {
    this.game.scene.remove(this.mesh);
  }
}
