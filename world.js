import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class WorldManager {
  constructor(game) {
    this.game = game;
    this.blocks = new Map(); // blockId -> { mesh, body, type, id }
    this.staticObstacles = [];
    
    this.gridSize = 2;

    // Interactive Wardrobe Block state
    this.wardrobeMesh = null;
    this.wardrobeBody = null;
    this.isNearWardrobe = false;

    // Grid helper reference to redraw themes
    this.gridHelper = null;
    this.pointLight = null;
    this.dirLight = null;
    this.cosmicAsteroids = [];

    this.initPhysicsMaterials();
    this.buildBaseArena();
  }

  initPhysicsMaterials() {
    this.groundMaterial = new CANNON.Material('ground');
    this.crateMaterial = new CANNON.Material('crate');

    const groundCrateContact = new CANNON.ContactMaterial(
      this.groundMaterial,
      this.crateMaterial,
      { friction: 0.35, restitution: 0.12 }
    );
    this.game.physicsWorld.addContactMaterial(groundCrateContact);

    const crateCrateContact = new CANNON.ContactMaterial(
      this.crateMaterial,
      this.crateMaterial,
      { friction: 0.5, restitution: 0.2 }
    );
    this.game.physicsWorld.addContactMaterial(crateCrateContact);
  }

  buildBaseArena() {
    // Platform dimensions
    const radius = 28;
    const thickness = 2;

    const geom = new THREE.CylinderGeometry(radius, radius, thickness, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c071a,
      roughness: 0.8,
      metalness: 0.3,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    this.game.scene.add(mesh);

    const shape = new CANNON.Cylinder(radius, radius, thickness, 32);
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      material: this.groundMaterial
    });
    
    // Cylinder orientation sync
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    body.addShape(shape, new CANNON.Vec3(0, 0, 0), q);
    
    this.game.physicsWorld.addBody(body);
    this.staticObstacles.push({ mesh, body });

    // Grid helper reference
    this.gridHelper = new THREE.GridHelper(56, 28, 0xff007f, 0x18103c);
    this.gridHelper.position.y = thickness / 2 + 0.01;
    this.game.scene.add(this.gridHelper);

    // Dynamic pointlight for grid glow
    this.pointLight = new THREE.PointLight(0x00f0ff, 1.2, 100);
    this.pointLight.position.set(0, 10, 0);
    this.game.scene.add(this.pointLight);

    // Directional light
    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    this.dirLight.position.set(20, 45, 15);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.bias = -0.0005;
    this.game.scene.add(this.dirLight);

    // Create central physical Wardrobe box
    this.buildWardrobeBlock();

    // Spawning some basic physical layout obby stairs
    this.createStaticStep(new THREE.Vector3(-12, 3, -12), new THREE.Vector3(4, 1.2, 4), 0x1c1735);
    this.createStaticStep(new THREE.Vector3(-12, 5.2, -18), new THREE.Vector3(4, 1.2, 4), 0x1c1735);
    this.createStaticStep(new THREE.Vector3(-6, 7.4, -22), new THREE.Vector3(4, 1.2, 4), 0xff007f);
    
    this.createStaticStep(new THREE.Vector3(12, 4, 12), new THREE.Vector3(6, 1, 6), 0x100825);
  }

  buildWardrobeBlock() {
    // Large futuristic double closet in center
    const w = 2.4;
    const h = 3.6;
    const d = 1.4;
    
    // Main frame mesh
    const frameGeom = new THREE.BoxGeometry(w, h, d);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x151126,
      roughness: 0.5,
      metalness: 0.8
    });
    this.wardrobeMesh = new THREE.Mesh(frameGeom, frameMat);
    this.wardrobeMesh.position.set(0, h/2 + 1, -2);
    this.wardrobeMesh.castShadow = true;
    this.wardrobeMesh.receiveShadow = true;
    this.game.scene.add(this.wardrobeMesh);

    // Glowing Neon sliding doors
    const doorGeom = new THREE.BoxGeometry(w * 0.82, h * 0.82, 0.15);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      emissive: 0xff007f,
      emissiveIntensity: 0.9,
      roughness: 0.1
    });
    const door = new THREE.Mesh(doorGeom, doorMat);
    door.position.set(0, 0, d/2 + 0.04);
    this.wardrobeMesh.add(door);

    // Hanger decoration icon inside door panel
    const decalGeom = new THREE.TorusGeometry(0.3, 0.08, 6, 12);
    const decal = new THREE.Mesh(decalGeom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    decal.position.set(0, 0, d/2 + 0.13);
    this.wardrobeMesh.add(decal);

    // Physics body
    const shape = new CANNON.Box(new CANNON.Vec3(w/2, h/2, d/2));
    this.wardrobeBody = new CANNON.Body({
      mass: 0,
      shape: shape,
      material: this.groundMaterial
    });
    this.wardrobeBody.position.set(0, h/2 + 1, -2);
    this.game.physicsWorld.addBody(this.wardrobeBody);
  }

  createStaticStep(position, size, colorHex) {
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.6,
      metalness: 0.2
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.game.scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(size.x/2, size.y/2, size.z/2));
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      material: this.groundMaterial
    });
    body.position.copy(position);
    this.game.physicsWorld.addBody(body);

    this.staticObstacles.push({ mesh, body });
  }

  applyThemeSettings(theme) {
    // Remove old asteroids
    this.cosmicAsteroids.forEach(a => this.game.scene.remove(a));
    this.cosmicAsteroids = [];

    // Redraw lighting and background fog to match selection
    if (theme === "neon") {
      this.game.scene.background.setHex(0x070412);
      this.game.scene.fog.color.setHex(0x070412);
      this.game.scene.fog.density = 0.015;

      this.pointLight.color.setHex(0x00f0ff);
      this.dirLight.color.setHex(0xffd0f0);
      
      // Update platform grid lines
      this.game.scene.remove(this.gridHelper);
      this.gridHelper = new THREE.GridHelper(56, 28, 0xff007f, 0x18103c);
      this.gridHelper.position.y = 1.01;
      this.game.scene.add(this.gridHelper);

      // Redoor wardrobe
      this.wardrobeMesh.children[0].material.color.setHex(0xff007f);
      this.wardrobeMesh.children[0].material.emissive.setHex(0xff007f);

    } else if (theme === "space") {
      this.game.scene.background.setHex(0x020106);
      this.game.scene.fog.color.setHex(0x020106);
      this.game.scene.fog.density = 0.006;

      this.pointLight.color.setHex(0xffaa00);
      this.dirLight.color.setHex(0xfff5d0);

      this.game.scene.remove(this.gridHelper);
      this.gridHelper = new THREE.GridHelper(56, 28, 0xffd700, 0x2b1c03);
      this.gridHelper.position.y = 1.01;
      this.game.scene.add(this.gridHelper);

      this.wardrobeMesh.children[0].material.color.setHex(0xffd700);
      this.wardrobeMesh.children[0].material.emissive.setHex(0xffd700);

      // Generate floating cosmic background stones/asteroids
      for(let i = 0; i < 15; i++) {
        const size = 1.5 + Math.random() * 4.5;
        const stone = new THREE.Mesh(
          new THREE.BoxGeometry(size, size, size),
          new THREE.MeshStandardMaterial({ color: 0x221a2f, roughness: 0.9 })
        );
        // Distribute in sky
        stone.position.set(
          (Math.random() - 0.5) * 120,
          25 + Math.random() * 45,
          (Math.random() - 0.5) * 120
        );
        stone.rotation.set(Math.random(), Math.random(), Math.random());
        this.game.scene.add(stone);
        this.cosmicAsteroids.push(stone);
      }

    } else if (theme === "volcano") {
      this.game.scene.background.setHex(0x0a0303);
      this.game.scene.fog.color.setHex(0x0a0303);
      this.game.scene.fog.density = 0.024; // dense smoke

      this.pointLight.color.setHex(0xff1100);
      this.dirLight.color.setHex(0xff4500);

      this.game.scene.remove(this.gridHelper);
      this.gridHelper = new THREE.GridHelper(56, 28, 0xff3300, 0x240707);
      this.gridHelper.position.y = 1.01;
      this.game.scene.add(this.gridHelper);

      this.wardrobeMesh.children[0].material.color.setHex(0xff3300);
      this.wardrobeMesh.children[0].material.emissive.setHex(0xff3300);
    }
  }

  getGridIntersection(raycaster) {
    const targets = [];
    this.staticObstacles.forEach(o => targets.push(o.mesh));
    this.blocks.forEach(b => targets.push(b.mesh));
    targets.push(this.wardrobeMesh); // also align blocks against wardrobe container sides!

    const intersects = raycaster.intersectObjects(targets);

    if (intersects.length > 0) {
      const intersect = intersects[0];
      const point = intersect.point;
      const normal = intersect.face.normal;

      const newPos = new THREE.Vector3()
        .copy(point)
        .add(normal.clone().multiplyScalar(this.gridSize / 2));

      newPos.x = Math.round(newPos.x / this.gridSize) * this.gridSize;
      newPos.y = Math.round(newPos.y / this.gridSize) * this.gridSize;
      newPos.z = Math.round(newPos.z / this.gridSize) * this.gridSize;

      if (newPos.y < 0.5) newPos.y = 1;

      return { position: newPos, intersectedMesh: intersect.object };
    }
    return null;
  }

  placeBlock(pos, type, networkSync = true) {
    const id = `block-${Math.random().toString(36).substr(2, 9)}`;
    this.placeBlockSync(pos, type, id);

    if (networkSync) {
      this.game.network.broadcastBlockPlace(pos, type, id);
    }
    return id;
  }

  placeBlockSync(pos, type, id) {
    if (this.blocks.has(id)) return;

    const size = this.gridSize;
    let geom, mat, shape, mass = 0;

    if (type === "crate") {
      geom = new THREE.BoxGeometry(size, size, size);
      mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8, metalness: 0.1 });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      mass = 4.0;
    } else if (type === "neon-block") {
      geom = new THREE.BoxGeometry(size, size, size);
      mat = new THREE.MeshStandardMaterial({
        color: 0xff007f,
        emissive: 0xff007f,
        emissiveIntensity: 0.6,
        roughness: 0.2
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      mass = 0;
    } else if (type === "bounce") {
      geom = new THREE.BoxGeometry(size, size * 0.5, size);
      mat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.8,
        roughness: 0.2
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size * 0.25, size / 2));
      mass = 0;
    } else if (type === "lava") {
      geom = new THREE.BoxGeometry(size, size, size);
      mat = new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff3300,
        emissiveIntensity: 1.0,
        roughness: 0.4
      });
      shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      mass = 0;
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
    this.game.spawnPlacementParticles(pos, type === "lava" ? 0xff3300 : 0x00f0ff, 10);
  }

  deleteBlockAtIntersection(raycaster) {
    const targets = [];
    this.blocks.forEach(b => targets.push(b.mesh));

    const intersects = raycaster.intersectObjects(targets);
    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      for (const [id, block] of this.blocks.entries()) {
        if (block.mesh === mesh) {
          this.deleteBlockSync(id);
          this.game.network.broadcastBlockDelete(id);
          break;
        }
      }
    }
  }

  deleteBlockSync(id) {
    const block = this.blocks.get(id);
    if (block) {
      this.game.scene.remove(block.mesh);
      block.mesh.geometry.dispose();
      block.mesh.material.dispose();
      this.game.physicsWorld.removeBody(block.body);

      this.game.spawnPlacementParticles(block.mesh.position, 0xff0055, 8);
      this.blocks.delete(id);
    }
  }

  update() {
    this.blocks.forEach(b => {
      if (b.body.mass > 0) {
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
      }
    });

    // Check triggers & Void resets
    this.checkZones();

    // Orbit cosmic asteroids slowly in space background
    if (this.cosmicAsteroids.length > 0) {
      const speed = 0.0003;
      this.cosmicAsteroids.forEach((a, index) => {
        a.rotation.y += 0.005;
        a.rotation.x += 0.002;
        // Orbit math around scene origin
        const radius = Math.sqrt(a.position.x * a.position.x + a.position.z * a.position.z);
        const theta = Math.atan2(a.position.z, a.position.x) + speed * (index % 2 === 0 ? 1 : -1);
        a.position.x = radius * Math.cos(theta);
        a.position.z = radius * Math.sin(theta);
      });
    }
  }

  checkZones() {
    const players = [this.game.localPlayer];
    this.game.peerPlayers.forEach(p => players.push(p));

    players.forEach(player => {
      if (!player || !player.body) return;

      const pPos = player.body.position;

      // Void reset
      if (pPos.y < -20) {
        this.resetPlayer(player);
        return;
      }

      // Check wardrobe block proximity trigger
      if (player === this.game.localPlayer) {
        const wPos = this.wardrobeBody.position;
        const dist = Math.sqrt(
          (pPos.x - wPos.x)*(pPos.x - wPos.x) + 
          (pPos.z - wPos.z)*(pPos.z - wPos.z)
        );
        
        const isNearNow = dist < 3.2 && Math.abs(pPos.y - wPos.y) < 2.0;

        if (isNearNow !== this.isNearWardrobe) {
          this.isNearWardrobe = isNearNow;
          this.game.toggleWardrobeTrigger(this.isNearWardrobe);
        }
      }

      this.blocks.forEach(block => {
        const bPos = block.body.position;
        const dx = Math.abs(pPos.x - bPos.x);
        const dz = Math.abs(pPos.z - bPos.z);
        const dy = pPos.y - bPos.y;

        if (block.type === "bounce") {
          if (dx < 1.2 && dz < 1.2 && dy > 0.3 && dy < 1.6) {
            player.body.velocity.y = 15.5; // launch!
            this.game.spawnPlacementParticles(bPos, 0x00f0ff, 12);
          }
        } else if (block.type === "lava") {
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
    this.game.spawnPlacementParticles(new THREE.Vector3(0, 5, 0), 0xff007f, 15);
    
    if (player === this.game.localPlayer) {
      this.game.network.appendSystemMessage("💥 Respawned. Watch out for hazards!");
    }
  }

  clearPlacedBlocks() {
    const ids = Array.from(this.blocks.keys());
    ids.forEach(id => this.deleteBlockSync(id));
  }
}
