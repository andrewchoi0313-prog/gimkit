// Characters and collectables: the explorer, the islanders, gloomlings,
// coins, hearts, shards, the key, and the sparkle effects.
(function () {
  'use strict';

  const BI = (window.BI = window.BI || {});
  const { lambert, basic, add, glowTexture, glyphTexture } = BI.Gfx;

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  let glowMap = null;
  const glow = () => glowMap || (glowMap = glowTexture());

  function glowSprite(color, size) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.setScalar(size);
    return sprite;
  }

  // A blocky person standing with their feet at y = 0 and facing +z.
  // `look` picks colours and extras: hat, beard, scarf, pack, staff, rod.
  function makeFigure(look) {
    const o = Object.assign({ coat: 0x1f8f8a, legs: 0x3a4a63, skin: 0xf0c49a, hair: 0xb9793a, boots: 0x5f4129, hat: 'hair' }, look);
    const group = new THREE.Group();
    const coat = lambert(o.coat);
    const skin = lambert(o.skin);
    const dark = lambert(0x2a2a33);

    const torso = add(group, box(0.66, 0.74, 0.42), coat, 0, 0.99, 0);
    const head = new THREE.Group();
    head.position.set(0, 1.36, 0);
    group.add(head);
    add(head, box(0.52, 0.52, 0.5), skin, 0, 0.26, 0);
    add(head, box(0.08, 0.1, 0.03), dark, 0.12, 0.3, 0.26, false);
    add(head, box(0.08, 0.1, 0.03), dark, -0.12, 0.3, 0.26, false);

    const hatMat = lambert(o.hatColor || o.hair);
    if (o.hat === 'hair') {
      add(head, box(0.58, 0.18, 0.56), hatMat, 0, 0.58, -0.01);
      add(head, box(0.58, 0.34, 0.14), hatMat, 0, 0.4, -0.24);
    } else if (o.hat === 'souwester') {
      add(head, box(0.56, 0.2, 0.54), hatMat, 0, 0.6, 0);
      add(head, box(0.8, 0.07, 0.95), hatMat, 0, 0.5, -0.08);
    } else if (o.hat === 'brim') {
      add(head, new THREE.CylinderGeometry(0.62, 0.62, 0.06, 10), hatMat, 0, 0.53, 0);
      add(head, new THREE.CylinderGeometry(0.26, 0.32, 0.3, 8), hatMat, 0, 0.7, 0);
    } else if (o.hat === 'beanie') {
      add(head, box(0.56, 0.24, 0.54), hatMat, 0, 0.6, 0);
      add(head, new THREE.IcosahedronGeometry(0.11, 0), lambert(0xf6efdc), 0, 0.8, 0);
    } else if (o.hat === 'bucket') {
      add(head, new THREE.CylinderGeometry(0.3, 0.44, 0.3, 8), hatMat, 0, 0.62, 0);
    }
    if (o.beard) add(head, box(0.42, 0.26, 0.12), lambert(0xf2f0ea), 0, 0.06, 0.24);
    if (o.scarf) add(group, box(0.7, 0.15, 0.48), lambert(o.scarf), 0, 1.36, 0);
    if (o.pack) add(group, box(0.5, 0.56, 0.24), lambert(o.pack), 0, 1.02, -0.32);

    function limb(x, y, w, h, d, mat, tipMat) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      add(pivot, box(w, h, d), mat, 0, -h / 2, 0);
      add(pivot, box(w + 0.02, 0.2, d + 0.06), tipMat, 0, -h + 0.1, 0.02);
      group.add(pivot);
      return pivot;
    }
    const boots = lambert(o.boots);
    const armL = limb(0.44, 1.3, 0.2, 0.6, 0.22, coat, skin);
    const armR = limb(-0.44, 1.3, 0.2, 0.6, 0.22, coat, skin);
    const legL = limb(0.17, 0.62, 0.24, 0.62, 0.26, lambert(o.legs), boots);
    const legR = limb(-0.17, 0.62, 0.24, 0.62, 0.26, lambert(o.legs), boots);

    const figure = { group, torso, head, armL, armR, legL, legR, phase: 0, lantern: null, holds: null };

    if (o.staff) {
      // The lantern staff sticks forward out of the right hand.
      add(armR, new THREE.CylinderGeometry(0.045, 0.045, 1.7, 5).rotateX(Math.PI / 2), lambert(0x6a4a30), 0, -0.55, 0.72);
      const lantern = new THREE.Group();
      lantern.position.set(0, -0.55, 1.6);
      add(lantern, box(0.24, 0.3, 0.24), basic(0xffd27a), 0, 0, 0, false);
      add(lantern, box(0.3, 0.06, 0.3), lambert(0x3d4654), 0, 0.18, 0, false);
      add(lantern, box(0.3, 0.06, 0.3), lambert(0x3d4654), 0, -0.18, 0, false);
      const halo = glowSprite(0xffc56a, 1.6);
      lantern.add(halo);
      const light = new THREE.PointLight(0xffc56a, 0.22, 11, 1.5);
      lantern.add(light);
      armR.add(lantern);
      figure.lantern = { group: lantern, halo, light };
      figure.holds = 'staff';
    }
    if (o.rod) {
      add(armR, new THREE.CylinderGeometry(0.025, 0.035, 2.6, 5).rotateX(Math.PI / 2), lambert(0x6a4a30), 0, -0.55, 1.2);
      figure.holds = 'rod';
    }
    return figure;
  }

  // Moves a figure's arms and legs.
  // pose: { speed: 0..1.5, airborne, swing: -1 or 0..1 through a staff swing }
  function animateFigure(f, dt, pose) {
    const moving = pose.speed > 0.05;
    if (moving) f.phase += dt * (5 + pose.speed * 6);
    const s = Math.sin(f.phase);
    const reach = Math.min(1, pose.speed) * 0.8;
    let legL = s * reach;
    let legR = -s * reach;
    let armL = -s * reach * 0.8;
    let armR = f.holds ? -1.05 + s * reach * 0.12 : s * reach * 0.8;
    if (pose.airborne) {
      legL = 0.55;
      legR = -0.35;
      armL = -1.3;
      if (!f.holds) armR = -1.3;
    }
    let quick = 16;
    if (pose.swing >= 0) {
      // Wind up over the shoulder, then sweep down in front.
      const k = pose.swing;
      armR = k < 0.28 ? -1.05 - (k / 0.28) * 1.55 : -2.6 + Math.min(1, (k - 0.28) / 0.34) * 2.45;
      quick = 40;
    }
    const ease = Math.min(1, dt * quick);
    const slow = Math.min(1, dt * 14);
    f.legL.rotation.x += (legL - f.legL.rotation.x) * slow;
    f.legR.rotation.x += (legR - f.legR.rotation.x) * slow;
    f.armL.rotation.x += (armL - f.armL.rotation.x) * slow;
    f.armR.rotation.x += (armR - f.armR.rotation.x) * ease;
    f.torso.position.y = 0.99 + (moving ? Math.abs(s) * 0.05 * Math.min(1, pose.speed) : 0);
    f.head.position.y = 1.36 + (moving ? Math.abs(s) * 0.05 * Math.min(1, pose.speed) : Math.sin(pose.time * 2) * 0.012);
  }

  function makeMarker() {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture('!'), color: 0xffc857, depthWrite: false }));
    sprite.scale.setScalar(1.7);
    return sprite;
  }

  // A hopping blob of shadow with pale eyes.
  function makeGloomling() {
    const group = new THREE.Group();
    const mat = lambert(0x3d2c61, { emissive: 0x1a0f2e });
    const body = add(group, new THREE.IcosahedronGeometry(0.75, 1), mat, 0, 0.62, 0);
    body.scale.y = 0.85;
    const eyeMat = basic(0xfdf6c8);
    add(group, new THREE.SphereGeometry(0.12, 6, 5), eyeMat, 0.25, 0.8, 0.6, false);
    add(group, new THREE.SphereGeometry(0.12, 6, 5), eyeMat, -0.25, 0.8, 0.6, false);
    const hornMat = lambert(0x2a1d45);
    add(group, new THREE.ConeGeometry(0.13, 0.42, 5), hornMat, 0.32, 1.22, 0).rotation.z = -0.45;
    add(group, new THREE.ConeGeometry(0.13, 0.42, 5), hornMat, -0.32, 1.22, 0).rotation.z = 0.45;
    return { group, body, mat };
  }

  function makeCoin() {
    const group = new THREE.Group();
    add(group, new THREE.CylinderGeometry(0.34, 0.34, 0.09, 12).rotateX(Math.PI / 2), lambert(0xffcf3f, { emissive: 0x4a3200 }), 0, 0, 0);
    return group;
  }

  function makeHeart() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.42);
    shape.bezierCurveTo(-0.75, 0.05, -0.4, 0.58, 0, 0.22);
    shape.bezierCurveTo(0.4, 0.58, 0.75, 0.05, 0, -0.42);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.09);
    const group = new THREE.Group();
    add(group, geometry, lambert(0xf0605d, { emissive: 0x6a1414 }), 0, 0, 0);
    return group;
  }

  // A lens shard, with a halo and a pillar of light so it shows from far away.
  function makeShard() {
    const group = new THREE.Group();
    const crystal = add(group, new THREE.OctahedronGeometry(0.5, 0), lambert(0xd8fbff, { emissive: 0x47c6d6 }), 0, 0, 0);
    crystal.scale.set(0.7, 1.45, 0.7);
    group.add(glowSprite(0x8ff0ff, 4.4));
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 80, 6, 1, true),
      basic(0x9ff3ff, { transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    pillar.position.y = 40;
    group.add(pillar);
    return { group, crystal, pillar };
  }

  function makeKey() {
    const group = new THREE.Group();
    const gold = lambert(0xf0c040, { emissive: 0x6a4a00 });
    add(group, new THREE.TorusGeometry(0.2, 0.065, 5, 10), gold, 0, 0.3, 0, false);
    add(group, box(0.09, 0.5, 0.09), gold, 0, -0.12, 0, false);
    add(group, box(0.2, 0.08, 0.09), gold, 0.1, -0.3, 0, false);
    add(group, box(0.15, 0.08, 0.09), gold, 0.08, -0.15, 0, false);
    return group;
  }

  // A fixed pool of little shards of colour for bursts and sparkles.
  function makeParticles(scene, count) {
    const geometry = new THREE.TetrahedronGeometry(0.17, 0);
    const pool = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geometry, basic(0xffffff, { transparent: true }));
      m.visible = false;
      scene.add(m);
      pool.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, gravity: 0 });
    }
    let next = 0;

    function burst(x, y, z, color, amount, speed, life, gravity) {
      for (let i = 0; i < amount; i++) {
        const p = pool[next];
        next = (next + 1) % count;
        const a = Math.random() * Math.PI * 2;
        const up = Math.random() * 1.2 - 0.2;
        const v = speed * (0.5 + Math.random() * 0.7);
        p.vx = Math.cos(a) * v;
        p.vz = Math.sin(a) * v;
        p.vy = up * v;
        p.gravity = gravity === undefined ? 9 : gravity;
        p.max = p.life = life * (0.7 + Math.random() * 0.6);
        p.m.material.color.setHex(color);
        p.m.position.set(x, y, z);
        p.m.visible = true;
      }
    }

    function update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.m.visible = false;
          continue;
        }
        p.vy -= p.gravity * dt;
        p.m.position.x += p.vx * dt;
        p.m.position.y += p.vy * dt;
        p.m.position.z += p.vz * dt;
        p.m.rotation.x += dt * 7;
        p.m.rotation.y += dt * 5;
        const k = p.life / p.max;
        p.m.material.opacity = Math.min(1, k * 1.6);
        p.m.scale.setScalar(0.5 + k);
      }
    }

    return { burst, update };
  }

  BI.Actors = { makeFigure, animateFigure, makeMarker, makeGloomling, makeCoin, makeHeart, makeShard, makeKey, makeParticles };
})();
