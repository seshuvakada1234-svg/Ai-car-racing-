import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";

export interface AnimalController {
  update: (elapsedSec: number) => void;
}

export function buildAnimals(scene: THREE.Scene, trackHelper: TrackGeometryHelper): AnimalController {
  const animalsGroup = new THREE.Group();
  animalsGroup.name = "farm_animals_scenery";

  // Materials Config
  const cowWhiteMat = new THREE.MeshStandardMaterial({ color: "#fbfbfb", roughness: 0.8 });
  const cowPatchMat = new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.85 });
  const sheepWoolMat = new THREE.MeshStandardMaterial({ color: "#eae6df", roughness: 0.95 });
  const blackFaceMat = new THREE.MeshStandardMaterial({ color: "#252627", roughness: 0.9 });
  const legWoodMat = new THREE.MeshStandardMaterial({ color: "#1f1a14", roughness: 0.9 });
  const birdMat = new THREE.MeshBasicMaterial({ color: "#334155", side: THREE.DoubleSide });

  // 1. PROCEDURAL ALPINE SHEEP GENERATOR (Zone 7 pastoral plains & meadows)
  const sheepCount = 14;
  const sheepRefs: { group: THREE.Group; scale: number; grazeSpeed: number; timeOffset: number }[] = [];

  const createProceduralSheep = (): THREE.Group => {
    const sheep = new THREE.Group();

    // Fluffy body
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), sheepWoolMat);
    body.position.y = 0.65;
    body.scale.set(1.1, 1.0, 1.4);
    body.castShadow = false;
    sheep.add(body);

    // Cute black head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 6), blackFaceMat);
    head.position.set(0, 0.95, 0.8);
    sheep.add(head);

    // Fluffy wool hat on head
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.16, 5, 5), sheepWoolMat);
    hat.position.set(0, 1.15, 0.74);
    sheep.add(hat);

    // Four stick legs
    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.55, 4);
    const legPositions = [
      [-0.32, 0.28, 0.4],
      [0.32, 0.28, 0.4],
      [-0.32, 0.28, -0.4],
      [0.32, 0.28, -0.4],
    ];
    legPositions.forEach((pos) => {
      const leg = new THREE.Mesh(legGeo, legWoodMat);
      leg.position.set(pos[0], pos[1], pos[2]);
      leg.castShadow = false;
      sheep.add(leg);
    });

    return sheep;
  };

  // Spawn Sheep near Zone 7 pastures (progress 0.72 to 0.77)
  for (let s = 0; s < sheepCount; s++) {
    const u = 0.72 + (s / sheepCount) * 0.05 + Math.random() * 0.005;
    const pt = trackHelper.curve.getPointAt(u % 1.0);
    const tangent = trackHelper.curve.getTangentAt(u % 1.0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const roadWidth = trackHelper.getRoadWidthAt(u % 1.0);

    const side = s % 2 === 0 ? 1 : -1;
    const offset = roadWidth / 2 + 6.0 + Math.random() * 22.0;
    const spawnPt = new THREE.Vector3().copy(pt).addScaledVector(normal, side * offset);
    spawnPt.y = getTerrainHeight(spawnPt.x, spawnPt.z, trackHelper);

    const inst = createProceduralSheep();
    inst.position.copy(spawnPt);
    inst.rotation.y = Math.random() * Math.PI * 2;
    inst.scale.set(0.9 + Math.random() * 0.25, 0.9 + Math.random() * 0.25, 0.9 + Math.random() * 0.25);
    animalsGroup.add(inst);

    sheepRefs.push({
      group: inst,
      scale: inst.scale.y,
      grazeSpeed: 0.8 + Math.random() * 1.5,
      timeOffset: Math.random() * 100,
    });
  }

  // 2. PROCEDURAL HOLSTEIN COWS GENERATOR (Zone 7 grass valleys)
  const cowRefs: { group: THREE.Group; tail: THREE.Mesh; chewTimer: number; scale: number }[] = [];
  const cowCount = 8;

  const createProceduralCow = (): { group: THREE.Group; tail: THREE.Mesh } => {
    const cow = new THREE.Group();

    // Cow rectangular main torso
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 2.2), cowWhiteMat);
    body.position.y = 1.1;
    body.castShadow = false;
    body.receiveShadow = false;
    cow.add(body);

    // Decorative black paint patches on dairy cow torso (using overlay meshes to look pristine!)
    const patchGeo1 = new THREE.BoxGeometry(1.13, 0.5, 0.6);
    const patch1 = new THREE.Mesh(patchGeo1, cowPatchMat);
    patch1.position.set(-0.01, 1.4, 0.5);
    cow.add(patch1);

    const patchGeo2 = new THREE.BoxGeometry(1.13, 0.6, 0.5);
    const patch2 = new THREE.Mesh(patchGeo2, cowPatchMat);
    patch2.position.set(0.01, 1.1, -0.6);
    cow.add(patch2);

    // Heavy square head
    const head = new THREE.Group();
    head.position.set(0, 1.55, 1.3);

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.65), cowWhiteMat);
    skull.position.set(0, 0, 0.1);
    skull.castShadow = false;
    head.add(skull);

    // Pink muzzle snout block
    const snout = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.26, 0.35),
      new THREE.MeshStandardMaterial({ color: "#ffb3c1", roughness: 0.9 }),
    );
    snout.position.set(0, -0.15, 0.5);
    head.add(snout);

    // White/black ears
    const earGeo = new THREE.BoxGeometry(0.35, 0.1, 0.1);
    const earL = new THREE.Mesh(earGeo, cowPatchMat);
    earL.position.set(-0.35, 0.15, -0.1);
    earL.rotation.z = -0.25;
    const earR = new THREE.Mesh(earGeo, cowPatchMat);
    earR.position.set(0.35, 0.15, -0.1);
    earR.rotation.z = 0.25;
    head.add(earL, earR);

    cow.add(head);

    // Stout cylinder legs
    const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.9, 5);
    const legPositions = [
      [-0.42, 0.45, 0.78],
      [0.42, 0.45, 0.78],
      [-0.42, 0.45, -0.78],
      [0.42, 0.45, -0.78],
    ];
    legPositions.forEach((pos) => {
      const leg = new THREE.Mesh(legGeo, cowPatchMat);
      leg.position.set(pos[0], pos[1], pos[2]);
      leg.castShadow = false;
      cow.add(leg);
    });

    // Thin realistic wagging tail
    const tailMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 4), legWoodMat);
    tailMesh.position.set(0, 1.3, -1.15);
    tailMesh.rotation.x = -0.35; // hangs down slanted
    cow.add(tailMesh);

    return { group: cow, tail: tailMesh };
  };

  // Spawn Cows across Zone 7 pastures (progress 0.70 to 0.74 closer to the village boundary)
  for (let c = 0; c < cowCount; c++) {
    const u = 0.7 + (c / cowCount) * 0.04 + Math.random() * 0.005;
    const pt = trackHelper.curve.getPointAt(u % 1.0);
    const tangent = trackHelper.curve.getTangentAt(u % 1.0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const roadWidth = trackHelper.getRoadWidthAt(u % 1.0);

    const side = c % 2 === 0 ? -1 : 1;
    const offset = roadWidth / 2 + 5.0 + Math.random() * 16.0;
    const spawnPt = new THREE.Vector3().copy(pt).addScaledVector(normal, side * offset);
    spawnPt.y = getTerrainHeight(spawnPt.x, spawnPt.z, trackHelper);

    const { group, tail } = createProceduralCow();
    group.position.copy(spawnPt);
    group.rotation.y = Math.random() * Math.PI * 2;
    group.scale.set(1.4, 1.4, 1.4); // Cows are noble massive beasts!
    animalsGroup.add(group);

    cowRefs.push({
      group,
      tail,
      chewTimer: Math.random() * Math.PI,
      scale: 1.4,
    });
  }

  // 3. SOARING FLOCK OF GOLDEN EAGLES / ALPS GULLS (Flying over Waterfall Pass)
  const birdRefs: {
    mesh: THREE.Mesh;
    wingL: THREE.Mesh;
    wingR: THREE.Mesh;
    center: THREE.Vector3;
    radius: number;
    speed: number;
    angle: number;
    altitude: number;
  }[] = [];
  const birdCount = 12;

  const createProceduralBird = (): { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh } => {
    const birdGroup = new THREE.Group();

    // Feathered slim fuselage
    const bodyGeo = new THREE.ConeGeometry(0.16, 1.2, 4);
    bodyGeo.rotateX(Math.PI / 2); // align forward flying
    const body = new THREE.Mesh(bodyGeo, birdMat);
    birdGroup.add(body);

    const wingGeo = new THREE.PlaneGeometry(1.2, 0.34);
    // Left wing
    const wingL = new THREE.Mesh(wingGeo, birdMat);
    wingL.position.set(-0.6, 0.0, -0.1);
    wingL.rotation.y = 0.15;
    birdGroup.add(wingL);

    // Right wing
    const wingR = new THREE.Mesh(wingGeo, birdMat);
    wingR.position.set(0.6, 0.0, -0.1);
    wingR.rotation.y = -0.15;
    birdGroup.add(wingR);

    return { group: birdGroup, wingL, wingR };
  };

  // Center the birds' circular thermal air current circling over the Waterfall Gorge Lake & Bridge sector!
  const flockCenter = new THREE.Vector3(trackHelper.waterfallPos.x + 350, 100, trackHelper.waterfallPos.z + 200);

  for (let b = 0; b < birdCount; b++) {
    const { group, wingL, wingR } = createProceduralBird();

    const angle = (b / birdCount) * Math.PI * 2 + Math.random() * 0.3;
    const radius = 60 + Math.random() * 50;
    const speed = 0.55 + Math.random() * 0.35;
    const altitude = 40 + Math.random() * 35; // height offset above the gorge bridge level

    animalsGroup.add(group);

    birdRefs.push({
      mesh: group as any,
      wingL,
      wingR,
      center: flockCenter,
      radius,
      speed,
      angle,
      altitude,
    });
  }

  scene.add(animalsGroup);

  // Return the update animation loop
  return {
    update: (elapsedSec: number) => {
      // 1. Animate Sheep (Breathing & Head-Bobbing grazing movement)
      sheepRefs.forEach((s) => {
        s.timeOffset += elapsedSec * s.grazeSpeed;

        // Periodic grazing cycles (sin wave translates head downward)
        const cycle = Math.sin(s.timeOffset);
        if (cycle > 0.45) {
          // Bob the whole body down to chew grass
          s.group.rotation.x = (cycle - 0.45) * 0.38;
        } else {
          s.group.rotation.x = 0;
        }

        // Tiny gentle breathing micro-pulse
        const breath = 1.0 + Math.sin(s.timeOffset * 2.2) * 0.02;
        s.group.scale.set(s.scale * breath, s.scale * (2.0 - breath) * 0.5, s.scale);
      });

      // 2. Animate Cows (Head-chewing mastication & wagging tail)
      cowRefs.forEach((c) => {
        c.chewTimer += elapsedSec * 2.8;

        // Tail wagging animation
        const tailWag = Math.sin(c.chewTimer * 1.8) * 0.45;
        c.tail.rotation.z = tailWag;

        // Gentle heavy cow side-swaying
        c.group.rotation.z = Math.sin(c.chewTimer * 0.4) * 0.03;
      });

      // 3. Animate Alpine Circling Birds (Fly in circular thermal orbit & flap wings)
      birdRefs.forEach((b) => {
        b.angle += b.speed * elapsedSec;

        // Circular coordinates
        const fx = b.center.x + Math.cos(b.angle) * b.radius;
        const fz = b.center.z + Math.sin(b.angle) * b.radius;
        // Thermal drafts cause slow altitude undulations based on angle
        const fy = b.center.y + b.altitude + Math.sin(b.angle * 2) * 8.0;

        b.mesh.position.set(fx, fy, fz);

        // Turn bird heading facing along circles
        b.mesh.rotation.y = -b.angle - Math.PI / 2;
        b.mesh.rotation.z = -0.15; // banking angle of gliders in turns!

        // Wing flapping rate fluctuates on flight speeds
        const flap = Math.sin(b.angle * 28.0) * 0.52;
        b.wingL.rotation.z = flap;
        b.wingR.rotation.z = -flap;
      });
    },
  };
}
