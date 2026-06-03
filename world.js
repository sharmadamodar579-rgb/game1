import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class WorldManager {
  constructor(game) {
    this.game = game;
    
    // Lists of objects
    this.blocks = new Map(); // id -> { mesh, body, type }
    this.staticObstacles = [];
    
    // Grid alignment settings
    this.gridSize = 2; // Each block is 2x2x2
    
    // Materials
    this.initMaterials();
    this.buildStaticLobby();
  }

  initMaterials() {
    // Cannon-es Physics Materials
    this.groundMaterial = new CANNON.Material('ground');
    this.crateMaterial = new CANNON.Material('crate');
    
    // Define behaviors between materials
    const groundCrateContact = new CANNON.ContactMaterial(
      this.groundMaterial,
      this.crateMaterial,
      {
        friction: 0.4,
        restitution: 0.1
      }
    );
    this.game.physicsWorld.addContactMaterial(groundCrateContact);

    const crateCrateContact = new CANNON.ContactMaterial(
      this.crateMaterial,
      this.crateMaterial,
      {
        friction: 0.5,
        restitution: 0.2
      }
    );
    this.game.physicsWorld.addContactMaterial(crateCrateContact);
  }

  buildStaticLobby() {
    // 1. Core Arena Platform (Circular cyber-grid plate)
    const platformRadius = 30;
    const platformThickness = 2;
    
    const geom = new THREE.CylinderGeometry(platformRadius, platformRadius, platformThickness, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120a2e,
      roughness: 0.7,
      metalness: 0.2,
      flatShading: true
    });
    const platformMesh = new THREE.Mesh(geom, mat);
    platformMesh.receiveShadow = true;
    this.game.scene.add(platformMesh);

    // Grid helper overlay on floor
    const gridHelper = new THREE.GridHelper(60, 30, 0x00f0ff, 0x18103c);
    gridHelper.position.y = platformThickness / 2 + 0.01;
    this.game.scene.add(gridHelper);

    // Physics body for central platform
    const platformShape = new CANNON.Cylinder(platformRadius, platformRadius, platformThickness, 32);
    const platformBody = new CANNON.Body({
      mass: 0, // static
      shape: platformShape,
      material: this.groundMaterial
    });
    // Cannon cylinders align on local Z axis by default, rotate it to align with Three.js cylinder (Y-axis)
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    platformBody.addShape(platformShape, new CANNON.Vec3(0, 0, 0), q);
    
    this.game.physicsWorld.addBody(platformBody);
    this.staticObstacles.push({ mesh: platformMesh, body: platformBody });

    // 2. Obstacle Course Components (Floating Obby steps)
    // Left stair
    this.createStaticBox(new THREE.Vector3(-15, 3, -10), new THREE.Vector3(4, 1, 4), 0x00f0ff);
    this.createStaticBox(new THREE.Vector3(-15, 5, -15), new THREE.Vector3(4, 1, 4), 0x00f0ff);
    this.createStaticBox(new THREE.Vector3(-10, 7, -20), new THREE.Vector3(4, 1, 4), 0xff007f);
    
    // Right high ledge with dynamic spheres / crates
    this.createStaticBox(new THREE.Vector3(15, 4, 10), new THREE.Vector3(8, 1, 8), 0x18103c);
  }

  createStaticBox(position, size, colorHex) {
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.5,
      metalness: 0.1,
      emissive: colorHex,
      emissiveIntensity: 0.15
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.game.scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      material: this.groundMaterial
    });
    body.position.copy(position);
    this.game.physicsWorld.addBody(body);

    this.staticObstacles.push({ mesh, body });
  }

  // Raycasts onto existing static platform or placed blocks to return placement grid position
  getGridIntersection(raycaster) {
    // Collect all intersectable objects
    const targets = [];
    
    // Add static obstacles meshes
    this.staticObstacles.forEach(o => targets.push(o.mesh));
    
    // Add placed blocks meshes
    this.blocks.forEach(b => targets.push(b.mesh));

    const intersects = raycaster.intersectObjects(targets);

    if (intersects.length > 0) {
      const intersect = intersects[0];
      const point = intersect.point;
      const normal = intersect.face.normal;

      // Calculate position of new block centered along the intersection normal
      const newPos = new THREE.Vector3()
        .copy(point)
        .add(normal.clone().multiplyScalar(this.gridSize / 2));

      // Snap coordinates to our 2-unit grid
      newPos.x = Math.round(newPos.x / this.gridSize) * this.gridSize;
      newPos.y = Math.round(newPos.y / this.gridSize) * this.gridSize;
      newPos.z = Math.round(newPos.z / this.gridSize) * this.gridSize;

      // Keep above void level
      if (newPos.y < 0.5) newPos.y = 1;

      return {
        position: newPos,
        intersectedMesh: intersect.object
      };
    }
    return null;
  }

  placeBlock(pos, type, networkSync = true) {
    const id = `block-${Math.random().toString(36).substr(2, 9)}`;
    this.placeBlockSync(pos, type, id);

    if (networkSync) {
      this.game.network.sendBlockPlace(pos, type, id);
    }
    return id;
  }

  placeBlockSync(pos, type, id) {
    // Prevent duplicate spawning if sync is out-of-order
    if (this.blocks.has(id)) return;

    const size = this.gridSize;
    let geom, mat, shape, mass = 0;
    
    // Setup type configuration
    if (type === "crate") {
      geom = new THREE.BoxGeometry(size, size, size);
      // Soft brown wooden crate look
      mat = new THREE.MeshStandardMaterial({
        color: 0x8B5A2B,
        roughness: 0.9,
        metalness: 0.05
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      mass = 4.0; // Dynamic physics box!
    } else if (type === "neon-block") {
      geom = new THREE.BoxGeometry(size, size, size);
      mat = new THREE.MeshStandardMaterial({
        color: 0xff007f,
        emissive: 0xff007f,
        emissiveIntensity: 0.6,
        roughness: 0.3,
        metalness: 0.1
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      mass = 0; // Static platform
    } else if (type === "bounce") {
      // Shorter wedge or box
      geom = new THREE.BoxGeometry(size, size * 0.5, size);
      mat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.2
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size * 0.25, size / 2));
      mass = 0; // Static trigger
    } else if (type === "lava") {
      geom = new THREE.BoxGeometry(size, size, size);
      mat = new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff3300,
        emissiveIntensity: 1.0,
        roughness: 0.5
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      mass = 0; // Static hazard
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.game.scene.add(mesh);

    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      material: type === "crate" ? this.crateMaterial : this.groundMaterial
    });
    body.position.copy(pos);
    this.game.physicsWorld.addBody(body);

    this.blocks.set(id, { mesh, body, type, id });

    // Play visual feedback particle puff
    this.game.spawnPlacementParticles(pos, type === "lava" ? 0xff3300 : 0x00f0ff);
  }

  deleteBlockAtIntersection(raycaster) {
    const targets = [];
    this.blocks.forEach(b => targets.push(b.mesh));

    const intersects = raycaster.intersectObjects(targets);
    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      
      // Find block id by matching meshes
      for (const [id, block] of this.blocks.entries()) {
        if (block.mesh === mesh) {
          this.deleteBlockSync(id);
          this.game.network.sendBlockDelete(id);
          break;
        }
      }
    }
  }

  deleteBlockSync(id) {
    const block = this.blocks.get(id);
    if (block) {
      // Remove visual mesh
      this.game.scene.remove(block.mesh);
      block.mesh.geometry.dispose();
      if (Array.isArray(block.mesh.material)) {
        block.mesh.material.forEach(m => m.dispose());
      } else {
        block.mesh.material.dispose();
      }

      // Remove physics body
      this.game.physicsWorld.removeBody(block.body);

      // Play delete puff
      this.game.spawnPlacementParticles(block.mesh.position, 0xff0055);

      this.blocks.delete(id);
    }
  }

  // Update physical coordinates (only dynamic boxes move)
  update() {
    this.blocks.forEach(block => {
      if (block.body.mass > 0) {
        block.mesh.position.copy(block.body.position);
        block.mesh.quaternion.copy(block.body.quaternion);
      }
    });

    // Check interaction zones (bounce pad impulses, lava hazards)
    this.checkBlockTriggers();
  }

  checkBlockTriggers() {
    const playersToCheck = [this.game.localPlayer];
    if (this.game.peerPlayer) {
      playersToCheck.push(this.game.peerPlayer);
    }

    playersToCheck.forEach(player => {
      if (!player || !player.body) return;

      const pPos = player.body.position;

      // Void reset height
      if (pPos.y < -20) {
        this.resetPlayer(player);
        return;
      }

      this.blocks.forEach(block => {
        const bPos = block.body.position;
        const dx = Math.abs(pPos.x - bPos.x);
        const dz = Math.abs(pPos.z - bPos.z);
        const dy = pPos.y - bPos.y;

        if (block.type === "bounce") {
          // If player stands on bounce pad
          if (dx < 1.2 && dz < 1.2 && dy > 0.4 && dy < 1.6) {
            // Apply massive upward force
            player.body.velocity.y = 16;
            this.game.spawnPlacementParticles(bPos, 0x00f0ff, 15);
          }
        } else if (block.type === "lava") {
          // If player is inside or touching lava
          if (dx < 1.4 && dz < 1.4 && Math.abs(dy) < 1.4) {
            this.resetPlayer(player);
          }
        }
      });
    });
  }

  resetPlayer(player) {
    player.body.position.set(0, 5, 0);
    player.body.velocity.set(0, 0, 0);
    player.body.angularVelocity.set(0, 0, 0);
    this.game.spawnPlacementParticles(new THREE.Vector3(0, 5, 0), 0xff007f, 20);
    
    if (player === this.game.localPlayer) {
      this.game.network.appendSystemMessage("💥 Respawned. Avoid lava and the endless void!");
    }
  }

  clearPlacedBlocks() {
    const ids = Array.from(this.blocks.keys());
    ids.forEach(id => this.deleteBlockSync(id));
  }
}
