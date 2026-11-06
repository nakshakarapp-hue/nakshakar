import * as THREE from 'three';

/**
 * The player: an original character, 1.70 m (5 ft 7 in) tall, in a pink hooded jacket and joggers. Built from smooth
 * tapered shapes on a small joint rig, in true human proportions. Feet are at the group's origin, and
 * the model faces along +z.
 */
export interface Character {
  group: THREE.Group;
  /** speed: metres per second over the ground. airborne: in a jump or a fall. */
  animate(dt: number, speed: number, airborne: boolean): void;
  dispose(): void;
}

/** Height of the top of the head, in metres. */
export const CHARACTER_HEIGHT = 1.7;

export function createCharacter(castShadow: boolean): Character {
  const materials: THREE.Material[] = [];
  const mat = (color: string, roughness = 0.8, glow = 0.1) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0,
      emissive: color,
      emissiveIntensity: glow,
    });
    materials.push(m);
    return m;
  };
  const skin = mat('#b5794f', 0.62, 0.08);
  const skinShade = mat('#9c6541', 0.7, 0.05);
  const jacket = mat('#f2569c');
  const jacketDark = mat('#c93a7c');
  const lining = mat('#2b2530');
  const trim = mat('#f7f4f6', 0.7);
  const pants = mat('#e0468d');
  const pantsDark = mat('#b52f6f');
  const shoe = mat('#f1f1ef', 0.55);
  const sole = mat('#2a2b2f', 0.9);
  const accent = mat('#f2569c', 0.6);
  const hair = mat('#17120f', 0.55, 0.02);
  const eyeWhite = mat('#f4f1ec', 0.3, 0.1);
  const iris = mat('#2d1c12', 0.25, 0.02);
  const lip = mat('#8c4f3d', 0.6, 0.05);

  const geometries: THREE.BufferGeometry[] = [];
  const add = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    parent.add(mesh);
    return mesh;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  /** A limb segment hanging down from its joint: wider at the top, rounded at both ends. */
  const limb = (
    parent: THREE.Object3D,
    top: number,
    bottom: number,
    length: number,
    material: THREE.Material,
    z = 1,
  ) => {
    const g = new THREE.Group();
    parent.add(g);
    add(g, new THREE.CylinderGeometry(top, bottom, length, 16), material, 0, -length / 2, 0);
    add(g, new THREE.SphereGeometry(top, 16, 10), material);
    add(g, new THREE.SphereGeometry(bottom, 16, 10), material, 0, -length, 0);
    g.scale.z = z;
    return g;
  };
  /** A body section turned from a side profile, then flattened front to back like a real torso. */
  const turned = (
    parent: THREE.Object3D,
    profile: [number, number][],
    material: THREE.Material,
    depth: number,
  ) => {
    const geometry = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      24,
    );
    geometry.computeVertexNormals();
    const mesh = add(parent, geometry, material);
    mesh.scale.z = depth;
    return mesh;
  };

  const group = new THREE.Group();
  const hips = joint(group, 0, 0.9, 0);

  // Pelvis, with a waistband.
  turned(
    hips,
    [
      [0, -0.1],
      [0.095, -0.095],
      [0.145, -0.05],
      [0.15, 0],
      [0.14, 0.05],
      [0.125, 0.1],
      [0, 0.1],
    ],
    pants,
    0.68,
  );

  // Torso in a hooded jacket: broad across the chest, narrower at the waist.
  const spine = joint(hips, 0, 0.09, 0);
  turned(
    spine,
    [
      [0, -0.075],
      [0.158, -0.075],
      [0.166, -0.04],
      [0.158, 0.03],
      [0.166, 0.12],
      [0.186, 0.22],
      [0.204, 0.3],
      [0.2, 0.345],
      [0.16, 0.395],
      [0.085, 0.44],
      [0, 0.445],
    ],
    jacket,
    0.68,
  );
  // Ribbed hem and cuffs of the jacket, zip, pockets.
  const hem = add(spine, new THREE.TorusGeometry(0.16, 0.015, 8, 28), jacketDark, 0, -0.062, 0);
  hem.rotation.x = Math.PI / 2;
  hem.scale.y = 0.69;
  add(spine, new THREE.BoxGeometry(0.012, 0.44, 0.012), trim, 0, 0.17, 0.133);
  for (const side of [-1, 1]) {
    const pocket = add(spine, new THREE.BoxGeometry(0.1, 0.085, 0.02), jacketDark, side * 0.08, 0.03, 0.106);
    pocket.rotation.z = side * 0.22;
    pocket.rotation.y = side * 0.32;
    add(spine, new THREE.CylinderGeometry(0.0045, 0.0045, 0.11, 6), trim, side * 0.028, 0.325, 0.135);
  }
  // Hood lying on the shoulders, open at the neck.
  const hood = add(spine, new THREE.SphereGeometry(0.11, 18, 12), jacketDark, 0, 0.405, -0.07);
  hood.scale.set(1.1, 0.5, 0.7);
  const collar = add(spine, new THREE.TorusGeometry(0.066, 0.019, 10, 22), jacket, 0, 0.44, 0.006);
  collar.rotation.x = Math.PI / 2 + 0.2;
  add(spine, new THREE.SphereGeometry(0.05, 12, 8), lining, 0, 0.44, 0.04).scale.set(1, 0.5, 0.6);

  // Neck and head. The head is about one eighth of the height, as on a grown person.
  const neck = joint(spine, 0, 0.44, 0);
  add(neck, new THREE.CylinderGeometry(0.048, 0.056, 0.1, 14), skin, 0, 0.035, 0.004);
  const head = joint(neck, 0, 0.075, 0.008);
  const skull = add(head, new THREE.SphereGeometry(1, 24, 18), skin, 0, 0.1, -0.004);
  skull.scale.set(0.086, 0.105, 0.098);
  const jaw = add(head, new THREE.SphereGeometry(1, 20, 14), skin, 0, 0.048, 0.016);
  jaw.scale.set(0.066, 0.06, 0.07);
  for (const side of [-1, 1]) {
    // Eyes set in the face rather than stuck on it.
    add(head, new THREE.SphereGeometry(0.017, 12, 8), skinShade, side * 0.033, 0.107, 0.079).scale.set(
      1.3,
      0.75,
      0.4,
    );
    add(head, new THREE.SphereGeometry(0.0125, 12, 10), eyeWhite, side * 0.033, 0.106, 0.081).scale.set(
      1.15,
      0.72,
      0.65,
    );
    add(head, new THREE.SphereGeometry(0.0072, 10, 8), iris, side * 0.033, 0.106, 0.0875);
    const brow = add(head, new THREE.BoxGeometry(0.03, 0.005, 0.008), hair, side * 0.034, 0.127, 0.0875);
    brow.rotation.z = side * -0.1;
    const ear = add(head, new THREE.SphereGeometry(0.019, 10, 8), skin, side * 0.087, 0.098, -0.006);
    ear.scale.set(0.42, 1.15, 0.72);
  }
  const nose = add(head, new THREE.SphereGeometry(0.0145, 10, 8), skin, 0, 0.083, 0.098);
  nose.scale.set(0.85, 1.25, 0.95);
  add(head, new THREE.BoxGeometry(0.008, 0.03, 0.012), skin, 0, 0.098, 0.092);
  const mouth = add(head, new THREE.SphereGeometry(0.019, 10, 6), lip, 0, 0.05, 0.08);
  mouth.scale.set(1.1, 0.26, 0.42);

  // Short hair: close at the sides, fuller on top and swept forward.
  const hairCap = add(
    head,
    new THREE.SphereGeometry(0.1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hair,
    0,
    0.106,
    -0.009,
  );
  hairCap.scale.set(0.925, 1.02, 1.03);
  const back = add(head, new THREE.SphereGeometry(0.086, 16, 12), hair, 0, 0.09, -0.03);
  back.scale.set(1.0, 1.05, 0.92);
  for (const [x, y, z, s] of [
    [0, 0.178, 0.04, 0.052],
    [0.038, 0.176, 0.05, 0.036],
    [-0.038, 0.175, 0.05, 0.036],
    [0.014, 0.17, 0.072, 0.032],
    [-0.02, 0.168, 0.074, 0.03],
    [0.05, 0.172, 0.006, 0.036],
    [-0.05, 0.171, 0.004, 0.036],
  ] as const) {
    const tuft = add(head, new THREE.SphereGeometry(s, 10, 8), hair, x, y, z);
    tuft.scale.y = 0.5;
  }

  // Arms: shoulder, elbow and wrist.
  const arm = (side: number) => {
    const shoulder = joint(spine, side * 0.206, 0.325, 0);
    add(shoulder, new THREE.SphereGeometry(0.067, 14, 10), jacket).scale.set(1, 0.85, 0.95);
    limb(shoulder, 0.064, 0.05, 0.27, jacket, 0.96);
    add(shoulder, new THREE.BoxGeometry(0.006, 0.24, 0.03), trim, side * 0.06, -0.14, 0);
    const elbow = joint(shoulder, 0, -0.275, 0);
    limb(elbow, 0.05, 0.039, 0.235, jacket, 0.94);
    const cuff = add(elbow, new THREE.CylinderGeometry(0.042, 0.042, 0.026, 14), jacketDark, 0, -0.238, 0);
    cuff.scale.z = 0.9;
    const wrist = joint(elbow, 0, -0.252, 0);
    const palm = add(wrist, new THREE.SphereGeometry(1, 12, 10), skin, 0, -0.038, 0.002);
    palm.scale.set(0.021, 0.045, 0.039);
    const fingers = add(wrist, new THREE.SphereGeometry(1, 12, 8), skin, 0, -0.085, 0.006);
    fingers.scale.set(0.015, 0.03, 0.034);
    const thumb = add(
      wrist,
      new THREE.CapsuleGeometry(0.0095, 0.028, 4, 8),
      skin,
      -side * 0.012,
      -0.043,
      0.038,
    );
    thumb.rotation.x = 0.55;
    return { shoulder, elbow, wrist };
  };
  const armL = arm(-1);
  const armR = arm(1);

  // Legs: hip, knee and ankle, with a stripe down the outside and low sneakers.
  const leg = (side: number) => {
    const hip = joint(hips, side * 0.09, -0.035, 0);
    limb(hip, 0.098, 0.068, 0.41, pants, 0.98);
    add(hip, new THREE.BoxGeometry(0.008, 0.38, 0.028), trim, side * 0.084, -0.2, 0);
    const knee = joint(hip, 0, -0.41, 0);
    limb(knee, 0.068, 0.05, 0.385, pants, 0.98);
    add(knee, new THREE.BoxGeometry(0.008, 0.34, 0.022), trim, side * 0.06, -0.18, 0);
    const band = add(knee, new THREE.CylinderGeometry(0.053, 0.056, 0.03, 14), pantsDark, 0, -0.375, 0);
    band.scale.z = 0.98;
    const ankle = joint(knee, 0, -0.395, 0);
    // Foot, heel to toe, with a raised sole.
    const upper = add(ankle, new THREE.SphereGeometry(1, 16, 10), shoe, 0, -0.022, 0.05);
    upper.scale.set(0.05, 0.046, 0.112);
    add(ankle, new THREE.CylinderGeometry(0.044, 0.05, 0.05, 12), shoe, 0, -0.008, -0.012);
    // Rounded like the shoe above them: a square edge here reads as a plank under the foot.
    add(ankle, new THREE.SphereGeometry(1, 16, 8), sole, 0, -0.058, 0.05).scale.set(0.05, 0.012, 0.113);
    add(ankle, new THREE.SphereGeometry(1, 16, 8), trim, 0, -0.046, 0.05).scale.set(0.052, 0.009, 0.115);
    add(ankle, new THREE.BoxGeometry(0.098, 0.018, 0.05), accent, 0, -0.018, 0.012);
    for (let i = 0; i < 3; i++) {
      add(ankle, new THREE.BoxGeometry(0.04, 0.004, 0.009), trim, 0, 0.012 - i * 0.006, 0.07 + i * 0.028);
    }
    return { hip, knee, ankle };
  };
  const legL = leg(-1);
  const legR = leg(1);

  group.scale.setScalar(CHARACTER_HEIGHT / 1.68);

  // Relaxed arms hang a little out from the body, elbows slightly bent.
  armL.shoulder.rotation.z = -0.085;
  armR.shoulder.rotation.z = 0.085;

  let phase = 0;
  let idle = 0;
  let stride = 0;
  let lookAt = 0;
  let lookGoal = 0;
  let lookTimer = 3;
  // Arms trail the legs a little, as real arms do, rather than moving in lockstep.
  let armSwing = 0;
  const STAND = 0.9;

  const animate = (dt: number, speed: number, airborne: boolean) => {
    const running = speed > 2.8;
    stride += ((speed > 0.1 ? Math.min(1, speed / 3.6) + 0.35 : 0) - stride) * Math.min(1, dt * 8);
    phase += dt * (running ? 8.8 : 7.0) * (speed > 0.1 ? Math.max(0.55, speed / (running ? 4 : 1.9)) : 0);
    idle += dt;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const amount = Math.min(1, stride);
    const still = 1 - amount;
    const breath = Math.sin(idle * 1.5);

    if (airborne) {
      const k = Math.min(1, dt * 12);
      legL.hip.rotation.x += (-0.65 - legL.hip.rotation.x) * k;
      legL.knee.rotation.x += (0.95 - legL.knee.rotation.x) * k;
      legR.hip.rotation.x += (0.25 - legR.hip.rotation.x) * k;
      legR.knee.rotation.x += (0.5 - legR.knee.rotation.x) * k;
      armL.shoulder.rotation.x += (0.7 - armL.shoulder.rotation.x) * k;
      armR.shoulder.rotation.x += (-0.8 - armR.shoulder.rotation.x) * k;
      armL.elbow.rotation.x = -0.6;
      armR.elbow.rotation.x = -0.6;
      hips.position.y = STAND;
      spine.rotation.x = 0.05;
      return;
    }
    // A leg swings from the hip, bends at the knee as it travels forward, lands heel first and rolls
    // off the toe.
    const swing = (running ? 0.85 : 0.55) * amount;
    legL.hip.rotation.x = s * swing;
    legR.hip.rotation.x = -s * swing;
    legL.knee.rotation.x = Math.max(0, -c) * (running ? 1.3 : 0.9) * amount + 0.05 + still * 0.03;
    legR.knee.rotation.x = Math.max(0, c) * (running ? 1.3 : 0.9) * amount + 0.05;
    const heel = (hipAngle: number, kneeAngle: number) =>
      -hipAngle * 0.35 - kneeAngle * 0.25 + Math.max(0, hipAngle) * 0.25 * amount;
    legL.ankle.rotation.x = heel(legL.hip.rotation.x, legL.knee.rotation.x);
    legR.ankle.rotation.x = heel(legR.hip.rotation.x, legR.knee.rotation.x);

    armSwing += (s - armSwing) * Math.min(1, dt * 9);
    const arms = swing * (running ? 0.9 : 0.7);
    armL.shoulder.rotation.x = -armSwing * arms + still * breath * 0.01;
    armR.shoulder.rotation.x = armSwing * arms - still * breath * 0.01;
    // Elbows bend more on the forward swing.
    armL.elbow.rotation.x = -0.18 - amount * (running ? 0.95 : 0.3) - Math.max(0, armSwing) * 0.18 * amount;
    armR.elbow.rotation.x = -0.18 - amount * (running ? 0.95 : 0.3) - Math.max(0, -armSwing) * 0.18 * amount;
    armL.shoulder.rotation.z = -0.085 - amount * 0.03;
    armR.shoulder.rotation.z = 0.085 + amount * 0.03;

    // Weight moves over the foot that is down: the hips drop, tilt and sway a little each step.
    hips.position.y = STAND - 0.014 * amount + Math.abs(c) * 0.028 * amount + breath * 0.003 * still;
    hips.position.x = s * 0.018 * amount + Math.sin(idle * 0.35) * 0.006 * still;
    hips.rotation.y = s * 0.1 * amount;
    hips.rotation.z = -s * 0.045 * amount;
    spine.rotation.y = -s * 0.16 * amount;
    spine.rotation.z = s * 0.03 * amount;
    spine.rotation.x = (running ? 0.2 : 0.05) * amount + breath * 0.012 * still;
    spine.scale.set(1 + breath * 0.006 * still, 1, 1 + breath * 0.01 * still);

    // Standing still, the character glances around now and then instead of staring ahead.
    lookTimer -= dt;
    if (lookTimer <= 0) {
      lookGoal = still > 0.8 ? (Math.random() - 0.5) * 0.9 : 0;
      lookTimer = 2.5 + Math.random() * 3;
    }
    if (still < 0.8) lookGoal = 0;
    lookAt += (lookGoal - lookAt) * Math.min(1, dt * 2.5);
    head.rotation.y = lookAt - spine.rotation.y * 0.5;
    head.rotation.x = -spine.rotation.x * 0.6 + still * Math.sin(idle * 0.7) * 0.02;
    head.rotation.z = -spine.rotation.z * 0.8;
  };

  return {
    group,
    animate,
    dispose() {
      materials.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
    },
  };
}
