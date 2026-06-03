import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Programmatic Humanoid Mannequin Constructor
export class HumanoidAvatar {
  constructor(charType, colorHex, outfit = {}) {
    this.charType = charType; // "K" (Male) or "R" (Female)
    this.colorHex = parseInt(colorHex);
    this.outfit = outfit; // { head: "none", torso: "none", legs: "none", feet: "none" }

    this.group = new THREE.Group();
    
    // Core references for joints/clothing sub-meshes
    this.head = null;
    this.torso = null;
    this.pelvis = null;
    
    this.leftArm = null;
    this.rightArm = null;
    this.leftLeg = null;
    this.rightLeg = null;
    
    this.leftFoot = null;
    this.rightFoot = null;

    // Subgroups for clothes
    this.clothesGroup = new THREE.Group();
    this.group.add(this.clothesGroup);

    this.buildBody();
    this.applyWardrobe();
  }

  buildBody() {
    const isMale = this.charType === "K";
    
    // Adjust scale details based on K vs R
    const scale = isMale ? 1.1 : 0.98;
    this.group.scale.set(scale, scale, scale);

    // Mannequin core plastic skin material
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe6e2fa,
      roughness: 0.6,
      metalness: 0.1
    });

    // 1. Torso
    const torsoW = isMale ? 1.2 : 0.9;
    const torsoH = isMale ? 1.4 : 1.25;
    const torsoD = isMale ? 0.7 : 0.55;
    const torsoGeom = new THREE.BoxGeometry(torsoW, torsoH, torsoD);
    this.torso = new THREE.Mesh(torsoGeom, skinMat);
    this.torso.position.y = 0.8;
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.group.add(this.torso);

    // 2. Head
    const headGeom = new THREE.BoxGeometry(0.65, 0.65, 0.65);
    this.head = new THREE.Mesh(headGeom, skinMat);
    this.head.position.y = 1.7;
    this.head.castShadow = true;
    this.group.add(this.head);

    // Cute mannequin facial eyes plate
    const eyePlateGeom = new THREE.BoxGeometry(0.55, 0.15, 0.05);
    const eyePlateMat = new THREE.MeshBasicMaterial({ color: 0x1f1f2e });
    const eyePlate = new THREE.Mesh(eyePlateGeom, eyePlateMat);
    eyePlate.position.set(0, 1.75, 0.31);
    this.group.add(eyePlate);

    // 3. Pelvis / Hip joint
    const pelvisGeom = new THREE.BoxGeometry(torsoW * 0.9, 0.3, torsoD * 0.95);
    this.pelvis = new THREE.Mesh(pelvisGeom, skinMat);
    this.pelvis.position.y = 0.05;
    this.group.add(this.pelvis);

    // 4. Arms
    const armW = 0.28;
    const armH = 1.1;
    const armD = 0.28;
    const armGeom = new THREE.BoxGeometry(armW, armH, armD);
    
    // Left Arm
    this.leftArm = new THREE.Mesh(armGeom, skinMat);
    this.leftArm.castShadow = true;
    // Pivot at shoulder
    this.leftArm.position.set(-torsoW / 2 - armW / 2 - 0.05, 0.6, 0);
    this.group.add(this.leftArm);

    // Right Arm
    this.rightArm = new THREE.Mesh(armGeom, skinMat);
    this.rightArm.castShadow = true;
    this.rightArm.position.set(torsoW / 2 + armW / 2 + 0.05, 0.6, 0);
    this.group.add(this.rightArm);

    // 5. Legs
    const legW = 0.32;
    const legH = 1.2;
    const legD = 0.32;
    const legGeom = new THREE.BoxGeometry(legW, legH, legD);

    // Left Leg
    this.leftLeg = new THREE.Mesh(legGeom, skinMat);
    this.leftLeg.castShadow = true;
    this.leftLeg.position.set(-torsoW * 0.28, -0.6, 0);
    this.group.add(this.leftLeg);

    // Right Leg
    this.rightLeg = new THREE.Mesh(legGeom, skinMat);
    this.rightLeg.castShadow = true;
    this.rightLeg.position.set(torsoW * 0.28, -0.6, 0);
    this.group.add(this.rightLeg);
  }

  applyWardrobe() {
    // Clear old visual clothes
    while(this.clothesGroup.children.length > 0){
      const child = this.clothesGroup.children[0];
      this.clothesGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const clothColor = this.colorHex;
    const clothMat = new THREE.MeshStandardMaterial({
      color: clothColor,
      emissive: clothColor,
      emissiveIntensity: 0.15,
      roughness: 0.5,
      metalness: 0.2
    });

    const isMale = this.charType === "K";
    const torsoW = isMale ? 1.2 : 0.9;
    const torsoH = isMale ? 1.4 : 1.25;

    // --- BOTTOM: Footwear / Shoes ---
    if (this.outfit.feet && this.outfit.feet !== "none") {
      const feetGeom = new THREE.BoxGeometry(0.42, 0.25, 0.55);
      
      const leftShoe = new THREE.Mesh(feetGeom, clothMat);
      leftShoe.position.set(-torsoW * 0.28, -1.2, 0.08);
      leftShoe.castShadow = true;
      this.clothesGroup.add(leftShoe);

      const rightShoe = new THREE.Mesh(feetGeom, clothMat);
      rightShoe.position.set(torsoW * 0.28, -1.2, 0.08);
      rightShoe.castShadow = true;
      this.clothesGroup.add(rightShoe);

      // Special hover rings particles/emissive effect
      if (this.outfit.feet === "rings") {
        clothMat.emissiveIntensity = 0.8; // increase neon glow
        // add secondary rings
        const ringGeom = new THREE.TorusGeometry(0.3, 0.06, 6, 16);
        const lRing = new THREE.Mesh(ringGeom, clothMat);
        lRing.rotation.x = Math.PI / 2;
        lRing.position.set(-torsoW * 0.28, -1.28, 0.08);
        this.clothesGroup.add(lRing);

        const rRing = new THREE.Mesh(ringGeom, clothMat);
        rRing.rotation.x = Math.PI / 2;
        rRing.position.set(torsoW * 0.28, -1.28, 0.08);
        this.clothesGroup.add(rRing);
      }
    }

    // --- LEGS: Pants / Legwear ---
    if (this.outfit.legs && this.outfit.legs !== "none") {
      const legW = 0.38;
      let legH = 0.8;
      const legD = 0.38;

      if (this.outfit.legs === "pants") {
        legH = 1.0;
      } else if (this.outfit.legs === "shorts") {
        legH = 0.55;
      }

      // Left leg garment
      const lLegGarment = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), clothMat);
      lLegGarment.position.set(-torsoW * 0.28, -0.5, 0);
      lLegGarment.castShadow = true;
      this.clothesGroup.add(lLegGarment);

      // Right leg garment
      const rLegGarment = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), clothMat);
      rLegGarment.position.set(torsoW * 0.28, -0.5, 0);
      rLegGarment.castShadow = true;
      this.clothesGroup.add(rLegGarment);

      // Female R Skirt addition
      if (this.outfit.legs === "skirt") {
        const skirtGeom = new THREE.ConeGeometry(0.9, 0.7, 16);
        const skirt = new THREE.Mesh(skirtGeom, clothMat);
        skirt.position.set(0, -0.15, 0);
        skirt.castShadow = true;
        this.clothesGroup.add(skirt);
      }
    }

    // --- TORSO: Jackets / Tops ---
    if (this.outfit.torso && this.outfit.torso !== "none") {
      const vestGeom = new THREE.BoxGeometry(torsoW + 0.1, torsoH * 0.95, 0.8);
      const vest = new THREE.Mesh(vestGeom, clothMat);
      vest.position.set(0, 0.8, 0);
      vest.castShadow = true;
      this.clothesGroup.add(vest);

      // Sleeve cuffs representation
      if (this.outfit.torso === "jacket" || this.outfit.torso === "hoodie") {
        const sleeveGeom = new THREE.BoxGeometry(0.36, 0.8, 0.36);
        
        const lSleeve = new THREE.Mesh(sleeveGeom, clothMat);
        lSleeve.position.set(-torsoW / 2 - 0.28 / 2 - 0.05, 0.75, 0);
        lSleeve.castShadow = true;
        this.clothesGroup.add(lSleeve);

        const rSleeve = new THREE.Mesh(sleeveGeom, clothMat);
        rSleeve.position.set(torsoW / 2 + 0.28 / 2 + 0.05, 0.75, 0);
        rSleeve.castShadow = true;
        this.clothesGroup.add(rSleeve);

        if (this.outfit.torso === "hoodie") {
          // Sphere behind neck representing the hood
          const hoodSph = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 8), clothMat);
          hoodSph.position.set(0, 1.4, -0.3);
          this.clothesGroup.add(hoodSph);
        }
      }
    }

    // --- TOP: Headwear / Accessories ---
    if (this.outfit.head && this.outfit.head !== "none") {
      if (this.outfit.head === "visor") {
        const visorGeom = new THREE.BoxGeometry(0.72, 0.15, 0.72);
        const visorMat = new THREE.MeshStandardMaterial({
          color: clothColor,
          emissive: clothColor,
          emissiveIntensity: 1.5,
          transparent: true,
          opacity: 0.9
        });
        const visor = new THREE.Mesh(visorGeom, visorMat);
        visor.position.set(0, 1.75, 0.05);
        this.clothesGroup.add(visor);
      } else if (this.outfit.head === "helmet") {
        // Starry spacesuit dome enclosing head
        const helmetGeom = new THREE.SphereGeometry(0.55, 16, 16);
        const helmetMat = new THREE.MeshStandardMaterial({
          color: clothColor,
          emissive: clothColor,
          emissiveIntensity: 0.3,
          transparent: true,
          opacity: 0.45,
          roughness: 0.1,
          metalness: 0.9
        });
        const helmet = new THREE.Mesh(helmetGeom, helmetMat);
        helmet.position.set(0, 1.7, 0);
        this.clothesGroup.add(helmet);
      } else if (this.outfit.head === "cap") {
        // Cap cap base
        const capBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), clothMat);
        capBase.position.set(0, 1.96, 0);
        this.clothesGroup.add(capBase);

        // Cap visor bill pointing front
        const capVisor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.4), clothMat);
        capVisor.position.set(0, 1.9, 0.45);
        this.clothesGroup.add(capVisor);
      }
    }
  }

  // Running walk swinging cycle
  animateWalk(isMoving) {
    if (isMoving) {
      const speedFactor = 0.015;
      const angle = Math.sin(Date.now() * speedFactor) * 0.55;

      this.leftLeg.rotation.x = angle;
      this.rightLeg.rotation.x = -angle;

      this.leftArm.rotation.x = -angle * 0.8;
      this.rightArm.rotation.x = angle * 0.8;
      
      // Keep torso bobbing slightly
      this.torso.position.y = 0.8 + Math.sin(Date.now() * speedFactor * 2) * 0.04;
      this.head.position.y = 1.7 + Math.sin(Date.now() * speedFactor * 2) * 0.04;
    } else {
      // Return smoothly to rest pose
      this.leftLeg.rotation.x *= 0.82;
      this.rightLeg.rotation.x *= 0.82;

      this.leftArm.rotation.x *= 0.82;
      this.rightArm.rotation.x *= 0.82;

      this.torso.position.y = 0.8;
      this.head.position.y = 1.7;
    }
  }
}

export class LocalPlayer {
  constructor(game, camera, initialPos) {
    this.game = game;
    this.camera = camera;

    this.speed = 10;
    this.jumpForce = 8.5;
    this.keys = { w: false, a: false, s: false, d: false, space: false };

    // Setup physical sphere center
    const radius = 1.0;
    this.shape = new CANNON.Sphere(radius);
    this.body = new CANNON.Body({
      mass: 75,
      shape: this.shape,
      material: this.game.world.groundMaterial,
      fixedRotation: true,
      linearDamping: 0.2
    });
    this.body.position.copy(initialPos);
    this.game.physicsWorld.addBody(this.body);

    // Setup 3D mesh avatar
    this.avatar = new HumanoidAvatar(
      this.game.localMannequinType,
      this.game.localOutfitColor,
      this.game.localWardrobeOutfit
    );
    this.game.scene.add(this.avatar.group);

    // Rigging third-person orbit follow camera
    this.cameraDistance = 8.5;
    this.cameraTheta = 0;
    this.cameraPhi = Math.PI / 6;

    this.initControls();
  }

  updateMannequin(charType, colorHex, outfit) {
    this.game.scene.remove(this.avatar.group);
    this.avatar = new HumanoidAvatar(charType, colorHex, outfit);
    this.game.scene.add(this.avatar.group);
  }

  initControls() {
    window.addEventListener("keydown", (e) => this.handleKey(e, true));
    window.addEventListener("keyup", (e) => this.handleKey(e, false));

    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    window.addEventListener("mousedown", (e) => {
      if (e.target.closest(".hud-card") || e.target.closest("#lobby-manager") || e.target.closest("#toolbox") || e.target.closest("#mobile-overlay")) return;
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      this.cameraTheta -= dx * 0.006;
      this.cameraPhi = Math.max(0.05, Math.min(Math.PI / 2.1, this.cameraPhi + dy * 0.006));
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    window.addEventListener("wheel", (e) => {
      this.cameraDistance = Math.max(3.5, Math.min(18, this.cameraDistance + e.deltaY * 0.007));
    });
  }

  handleKey(e, isPressed) {
    // Prevent walking keys overriding if chat has focus
    if (document.activeElement.tagName === "INPUT") return;
    
    const key = e.key.toLowerCase();
    if (key === "w" || key === "arrowup") this.keys.w = isPressed;
    if (key === "a" || key === "arrowleft") this.keys.a = isPressed;
    if (key === "s" || key === "arrowdown") this.keys.s = isPressed;
    if (key === "d" || key === "arrowright") this.keys.d = isPressed;
    if (key === " ") this.keys.space = isPressed;
  }

  jump() {
    if (this.isGrounded()) {
      this.body.velocity.y = this.jumpForce;
      this.game.spawnPlacementParticles(this.body.position, this.game.localOutfitColor, 6);
    }
  }

  isGrounded() {
    const start = this.body.position;
    const end = new CANNON.Vec3(start.x, start.y - 1.2, start.z);

    const ray = new CANNON.Ray();
    ray.from = start;
    ray.to = end;

    let hits = false;
    this.game.physicsWorld.bodies.forEach(b => {
      if (b === this.body) return;
      const res = new CANNON.RaycastResult();
      if (ray.intersectBody(b, res)) {
        if (start.distanceTo(res.hitPointWorld) < 1.25) {
          hits = true;
        }
      }
    });

    if (start.y < 1.05 && start.y > 0.95) return true;
    return hits;
  }

  update() {
    let moveX = 0;
    let moveZ = 0;

    if (this.keys.w) moveZ -= 1;
    if (this.keys.s) moveZ += 1;
    if (this.keys.a) moveX -= 1;
    if (this.keys.d) moveX += 1;

    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    camFwd.y = 0;
    camFwd.normalize();

    const camRgt = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    camRgt.y = 0;
    camRgt.normalize();

    const targetMove = new THREE.Vector3()
      .addScaledVector(camFwd, moveZ)
      .addScaledVector(camRgt, moveX);

    const isMoving = targetMove.length() > 0.05;

    if (isMoving) {
      targetMove.normalize();
      this.body.velocity.x = targetMove.x * this.speed;
      this.body.velocity.z = targetMove.z * this.speed;

      const targetRot = Math.atan2(targetMove.x, targetMove.z);
      let diff = targetRot - this.avatar.group.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.avatar.group.rotation.y += diff * 0.16;
    } else {
      this.body.velocity.x *= 0.8;
      this.body.velocity.z *= 0.8;
    }

    if (this.keys.space) {
      this.jump();
      this.keys.space = false;
    }

    // Bob / swing limbs
    this.avatar.animateWalk(isMoving);

    // Sync mesh position
    // Center physical sphere maps to mannequin feet coordinates
    this.avatar.group.position.copy(this.body.position);
    this.avatar.group.position.y -= 0.25; // align base

    // Camera follow updates
    const cx = this.body.position.x + this.cameraDistance * Math.sin(this.cameraTheta) * Math.cos(this.cameraPhi);
    const cy = this.body.position.y + this.cameraDistance * Math.sin(this.cameraPhi);
    const cz = this.body.position.z + this.cameraDistance * Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi);

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.body.position.x, this.body.position.y + 0.6, this.body.position.z);
  }

  cleanup() {
    this.game.physicsWorld.removeBody(this.body);
    this.game.scene.remove(this.avatar.group);
  }
}

export class RemotePlayer {
  constructor(game, initialPos, charType, colorHex, outfit) {
    this.game = game;

    this.avatar = new HumanoidAvatar(charType, colorHex, outfit);
    this.avatar.group.position.copy(initialPos);
    this.game.scene.add(this.avatar.group);

    this.targetPos = new THREE.Vector3().copy(initialPos);
    this.targetRotY = 0;
    this.isMoving = false;
  }

  updateOutfit(charType, colorHex, outfit) {
    this.game.scene.remove(this.avatar.group);
    
    // Save rotation
    const rot = this.avatar.group.rotation.y;
    this.avatar = new HumanoidAvatar(charType, colorHex, outfit);
    this.avatar.group.rotation.y = rot;
    
    this.game.scene.add(this.avatar.group);
  }

  updateData(syncPacket) {
    this.targetPos.set(syncPacket.x, syncPacket.y, syncPacket.z);
    this.targetRotY = syncPacket.rotY;
    
    // Calculate if they are moving based on coordinate delta
    const delta = this.avatar.group.position.distanceTo(this.targetPos);
    this.isMoving = delta > 0.08;
  }

  update() {
    this.avatar.group.position.lerp(this.targetPos, 0.22);
    
    let diff = this.targetRotY - this.avatar.group.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.avatar.group.rotation.y += diff * 0.22;

    this.avatar.animateWalk(this.isMoving);
  }

  cleanup() {
    this.game.scene.remove(this.avatar.group);
  }
}
