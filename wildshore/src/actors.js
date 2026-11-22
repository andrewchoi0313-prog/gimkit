// Characters and things: the explorer, night monsters, wild animals, weapons,
// hearts, meat, the boat, treasure chests, blaster bolts and sparkles.
// Living things are built from smooth rounded shapes; made things (the boat,
// chests, weapons) keep their straight edges.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const { lambert, soft, basic, add, ball, shadeByHeight, glowTexture, glyphTexture } = WS.Gfx;

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const pill = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 12);   // a rod with rounded ends
  const cone = (r, h) => new THREE.ConeGeometry(r, h, 12);

  const UNIT = ball(1, 2);
  const SMALL = ball(1, 1); // eyes, noses and other little things
  // Bodies are painted darker underneath and lighter on top.
  const BODY = shadeByHeight(ball(1, 3), 0.72, 1.14);

  // Adds a ball stretched to (sx, sy, sz) at (x, y, z). Painted materials
  // get the painted ball: without paint they would draw black.
  function orb(parent, material, sx, sy, sz, x, y, z, castShadow) {
    const small = Math.max(sx, sy, sz) < 0.13;
    const m = add(parent, material.vertexColors ? BODY : small ? SMALL : UNIT, material, x, y, z, castShadow);
    m.scale.set(sx, sy, sz);
    return m;
  }
  let glowMap = null;
  const glow = () => glowMap || (glowMap = glowTexture());

  function glowSprite(color, size) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.setScalar(size);
    return sprite;
  }

  // A darker (k < 1) or lighter (k > 1) version of a colour.
  function shade(hex, k) {
    const c = new THREE.Color(hex);
    return c.setRGB(Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k)).getHex();
  }

  // ---------- people ----------

  // A rounded person standing with their feet at y = 0 and facing +z.
  // `look` picks colours and extras: hat, scarf, pack, lantern.
  function makeFigure(look) {
    const o = Object.assign({ coat: 0x3f7fd0, legs: 0x3a4a63, skin: 0xf0c49a, hair: 0x6b4226, boots: 0x5f4129, hat: 'hair' }, look);
    const group = new THREE.Group();
    const coat = soft(o.coat);
    const skin = soft(o.skin);
    const dark = soft(0x2a2a33);

    const torso = add(group, pill(0.28, 0.2), coat, 0, 0.99, 0);
    torso.scale.set(1.15, 1, 0.8);
    const head = new THREE.Group();
    head.position.set(0, 1.36, 0);
    group.add(head);
    orb(head, skin, 0.29, 0.29, 0.28, 0, 0.27, 0);
    orb(head, dark, 0.045, 0.055, 0.03, 0.11, 0.3, 0.262, false);
    orb(head, dark, 0.045, 0.055, 0.03, -0.11, 0.3, 0.262, false);
    const hatMat = soft(o.hatColor || o.hair);
    if (o.hat === 'cap') {
      orb(head, hatMat, 0.31, 0.2, 0.3, 0, 0.42, -0.01);
      orb(head, hatMat, 0.2, 0.035, 0.2, 0, 0.4, 0.3);       // the peak
    } else {
      orb(head, hatMat, 0.31, 0.24, 0.3, 0, 0.36, -0.04);    // hair
    }
    if (o.scarf) add(group, new THREE.TorusGeometry(0.2, 0.075, 8, 18).rotateX(Math.PI / 2), soft(o.scarf), 0, 1.36, 0).scale.set(1.1, 1, 0.85);
    if (o.pack) orb(group, soft(o.pack), 0.25, 0.3, 0.16, 0, 1.02, -0.3);

    function limb(x, y, r, len, mat, tipMat, foot) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      add(pivot, pill(r, len - 2 * r), mat, 0, -len / 2, 0);
      if (foot) orb(pivot, tipMat, r + 0.02, 0.1, r + 0.07, 0, -len + 0.06, 0.04);
      else orb(pivot, tipMat, r + 0.01, r + 0.01, r + 0.01, 0, -len + 0.04, 0);
      group.add(pivot);
      return pivot;
    }
    const boots = soft(o.boots);
    const armL = limb(0.42, 1.3, 0.1, 0.6, coat, skin, false);
    const armR = limb(-0.42, 1.3, 0.1, 0.6, coat, skin, false);
    const legL = limb(0.16, 0.62, 0.12, 0.62, soft(o.legs), boots, true);
    const legR = limb(-0.16, 0.62, 0.12, 0.62, soft(o.legs), boots, true);

    // Whatever is held points forward out of the right hand.
    const hand = new THREE.Group();
    hand.position.set(0, -0.55, 0.12);
    armR.add(hand);

    const figure = { group, torso, head, armL, armR, legL, legR, hand, phase: 0, light: null, glow: null };
    if (o.lantern) {
      // A little lantern on the belt, so nights are never pitch black.
      const lantern = new THREE.Group();
      lantern.position.set(0.3, 0.72, 0.26);
      add(lantern, pill(0.07, 0.08), basic(0xffd27a), 0, 0, 0, false);
      figure.glow = glowSprite(0xffc56a, 1.1);
      lantern.add(figure.glow);
      figure.light = new THREE.PointLight(0xffc56a, 0.25, 13, 1.5);
      figure.light.position.set(0, 0.9, 0.5);
      lantern.add(figure.light);
      group.add(lantern);
    }
    return figure;
  }

  // Moves a figure's arms and legs.
  // pose: { speed, airborne, time, armed, aim, swing: -1 or 0..1 through a swing }
  function animateFigure(f, dt, pose) {
    const moving = pose.speed > 0.05;
    if (moving) f.phase += dt * (5 + pose.speed * 6);
    const s = Math.sin(f.phase);
    const reach = Math.min(1, pose.speed) * 0.8;
    let legL = s * reach, legR = -s * reach;
    let armL = -s * reach * 0.8;
    let armR = pose.aim ? -1.5 : pose.armed ? -1.0 + s * reach * 0.12 : s * reach * 0.8;
    if (pose.airborne) {
      legL = 0.55;
      legR = -0.35;
      armL = -1.3;
      if (!pose.armed) armR = -1.3;
    }
    let quick = 16;
    if (pose.swing >= 0) {
      const k = pose.swing;
      if (pose.aim) {
        armR = -1.5 - Math.sin(Math.min(1, k * 2.5) * Math.PI) * 0.35; // a kick from the blaster
      } else {
        // Wind up over the shoulder, then sweep down in front.
        armR = k < 0.28 ? -1.05 - (k / 0.28) * 1.55 : -2.6 + Math.min(1, (k - 0.28) / 0.34) * 2.45;
      }
      quick = 40;
    }
    const ease = Math.min(1, dt * quick), slow = Math.min(1, dt * 14);
    f.legL.rotation.x += (legL - f.legL.rotation.x) * slow;
    f.legR.rotation.x += (legR - f.legR.rotation.x) * slow;
    f.armL.rotation.x += (armL - f.armL.rotation.x) * slow;
    f.armR.rotation.x += (armR - f.armR.rotation.x) * ease;
    const bob = moving ? Math.abs(s) * 0.05 * Math.min(1, pose.speed) : 0;
    f.torso.position.y = 0.99 + bob;
    f.head.position.y = 1.36 + (moving ? bob : Math.sin(pose.time * 2) * 0.012);
  }

  function makeMarker() {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture('!'), color: 0xffc857, depthWrite: false }));
    sprite.scale.setScalar(1.7);
    return sprite;
  }

  // ---------- weapons ----------

  // Every weapon is modelled pointing along +z from the grip.
  function makeWeapon(kind) {
    const g = new THREE.Group();
    const woodMat = lambert(0x7a5230);
    const steel = lambert(0xdfe7ef, { emissive: 0x30363c });
    if (kind === 'stick') {
      add(g, new THREE.CylinderGeometry(0.04, 0.055, 1.3, 10).rotateX(Math.PI / 2), soft(0x7a5230), 0, 0, 0.55);
      add(g, box(0.05, 0.05, 0.22), woodMat, 0.06, 0.03, 0.8).rotation.y = 0.6;
    } else if (kind === 'sword') {
      add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.34, 5).rotateX(Math.PI / 2), woodMat, 0, 0, 0.05);
      add(g, box(0.44, 0.08, 0.08), lambert(0xd9a531), 0, 0, 0.26);
      add(g, box(0.12, 0.04, 1.0), steel, 0, 0, 0.8);
      add(g, new THREE.ConeGeometry(0.075, 0.2, 4).rotateX(Math.PI / 2), steel, 0, 0, 1.4).scale.set(1, 0.4, 1);
    } else if (kind === 'axe') {
      add(g, new THREE.CylinderGeometry(0.045, 0.055, 1.3, 5).rotateX(Math.PI / 2), woodMat, 0, 0, 0.55);
      add(g, box(0.07, 0.5, 0.36), steel, 0, 0.2, 1.02);
      add(g, box(0.05, 0.62, 0.1), steel, 0, 0.2, 1.22);
    } else {
      add(g, box(0.14, 0.2, 0.55), lambert(0x2f6f78), 0, 0.02, 0.3);
      add(g, box(0.1, 0.22, 0.12), lambert(0x1f3f46), 0, -0.16, 0.1);
      add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.36, 6).rotateX(Math.PI / 2), lambert(0x3d4654), 0, 0.04, 0.72);
      add(g, new THREE.SphereGeometry(0.07, 8, 6), basic(0x8ff6ff), 0, 0.04, 0.92, false);
      add(g, box(0.16, 0.05, 0.3), basic(0x8ff6ff), 0, 0.14, 0.3, false);
    }
    return g;
  }

  // A weapon lying in the world, standing on end and glowing so it is seen.
  function makeWeaponPickup(kind) {
    const g = new THREE.Group();
    const model = makeWeapon(kind);
    model.rotation.x = -Math.PI / 2;
    model.position.y = -0.6;
    model.scale.setScalar(1.25);
    g.add(model);
    g.add(glowSprite(kind === 'blaster' ? 0x8ff6ff : 0xffe08a, kind === 'blaster' ? 4.2 : 3));
    return g;
  }

  function makeBolt() {
    const g = new THREE.Group();
    add(g, box(0.12, 0.12, 0.8), basic(0xbffaff), 0, 0, 0, false);
    g.add(glowSprite(0x6ff0ff, 1.8));
    g.visible = false;
    return g;
  }

  // ---------- monsters ----------

  const bright = (hex) => {
    const c = new THREE.Color(hex);
    return c.r * 0.3 + c.g * 0.6 + c.b * 0.1 > 0.7;
  };
  const body = (color, rest, extra) => soft(color, Object.assign({ emissive: rest, vertexColors: true }, extra || {}));

  // Round eyes with dark pupils, looking forward.
  function eyes(parent, y, z, apart, size, white) {
    for (const side of [1, -1]) {
      orb(parent, basic(white), size, size, size * 0.7, side * apart, y, z, false);
      orb(parent, basic(0x15151c), size * 0.5, size * 0.5, size * 0.4, side * apart, y, z + size * 0.5, false);
    }
  }

  // A hopping blob.
  function makeBlob(sp, color) {
    const tint = color || sp.color;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(sp.scale);
    group.add(inner);
    const rest = shade(tint, sp.glow ? 0.5 : 0.14);
    const mat = body(tint, rest);
    const m = add(inner, BODY, mat, 0, 0.62, 0);
    m.scale.set(0.75, 0.64, 0.75);
    eyes(inner, 0.82, 0.62, 0.25, 0.14, bright(tint) ? 0xdfe8ee : 0xfdf6c8);
    const crest = soft(shade(tint, 0.62));
    add(inner, cone(0.13, 0.42), crest, 0.32, 1.2, 0).rotation.z = -0.45;
    add(inner, cone(0.13, 0.42), crest, -0.32, 1.2, 0).rotation.z = 0.45;
    if (sp.glow) inner.add(glowSprite(tint, 2.6)).position.y = 0.7;
    return { group, inner, mat, rest, radius: 0.72 * sp.scale, height: 1.3 * sp.scale };
  }

  // A heavy two-legged brute that walks up and slams its fists down.
  function makeBrute(sp, color) {
    const tint = color || sp.color;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(sp.scale);
    group.add(inner);
    const rest = shade(tint, sp.glow ? 0.35 : 0.08);
    const mat = body(tint, rest);
    const darkMat = soft(shade(tint, 0.62));
    const chest = add(inner, BODY, mat, 0, 1.35, 0);
    chest.scale.set(0.66, 0.64, 0.48);
    orb(inner, soft(shade(tint, 1.25)), 0.4, 0.36, 0.12, 0, 1.22, 0.4, false);   // a paler belly
    orb(inner, mat, 0.34, 0.3, 0.33, 0, 2.05, 0.12);
    eyes(inner, 2.1, 0.4, 0.15, 0.085, sp.glow ? 0xfff0a0 : 0xffd84a);
    add(inner, cone(0.12, 0.45), darkMat, 0.34, 2.38, 0.1).rotation.z = -0.5;
    add(inner, cone(0.12, 0.45), darkMat, -0.34, 2.38, 0.1).rotation.z = 0.5;
    function limb(x, y, r, len, fist) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      add(pivot, pill(r, len - 2 * r), darkMat, 0, -len / 2, 0);
      if (fist) orb(pivot, mat, r + 0.09, r + 0.07, r + 0.11, 0, -len - 0.08, 0.02);
      inner.add(pivot);
      return pivot;
    }
    const armL = limb(0.8, 1.82, 0.19, 1.2, true);
    const armR = limb(-0.8, 1.82, 0.19, 1.2, true);
    const legL = limb(0.32, 0.82, 0.22, 0.82, false);
    const legR = limb(-0.32, 0.82, 0.22, 0.82, false);
    return { group, inner, mat, rest, armL, armR, legL, legR, radius: 0.72 * sp.scale, height: 2.4 * sp.scale };
  }

  // A floating light that swoops.
  function makeWisp(sp, color) {
    const tint = color || sp.color;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(sp.scale);
    group.add(inner);
    const rest = shade(tint, 0.55);
    const mat = soft(tint, { emissive: rest, transparent: true, opacity: 0.8 });
    orb(inner, mat, 0.55, 0.55, 0.55, 0, 0, 0);
    orb(inner, basic(0xffffff), 0.3, 0.3, 0.3, 0, 0, 0, false);
    eyes(inner, 0.08, 0.5, 0.17, 0.085, 0x26303c);
    for (let i = 0; i < 3; i++) {
      const r = 0.22 - i * 0.05;
      orb(inner, mat, r, r, r, 0, -0.1 - i * 0.1, -0.6 - i * 0.34, false);   // a fading tail
    }
    inner.add(glowSprite(tint, 3.2));
    return { group, inner, mat, rest, radius: 0.6 * sp.scale, height: 1.1 * sp.scale };
  }

  function makeMonster(sp, color) {
    if (sp.body === 'animal') return makeAnimal(sp);
    if (sp.body === 'fish') return makeFish(sp, color);
    if (sp.body === 'shark') return makeShark(sp);
    if (sp.body === 'brute') return makeBrute(sp, color);
    if (sp.body === 'wisp') return makeWisp(sp, color);
    return makeBlob(sp, color);
  }

  // ---------- wild animals ----------

  // A four-legged animal (or a chicken) facing +z with its feet at y = 0,
  // built from soft rounded shapes.
  function makeAnimal(sp) {
    const kind = sp.name.toLowerCase();
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(sp.scale);
    group.add(inner);
    const rest = shade(sp.color, 0.1);
    const mat = body(sp.color, rest);
    const dark = soft(kind === 'sheep' ? 0x3a3a3a : shade(sp.color, 0.6));
    const cream = soft(0xf2ecdc);
    const legs = [];
    const leg = (x, z, h, r, m) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, h, z);
      add(pivot, pill(r, h - 2 * r), m, 0, -h / 2, 0);
      inner.add(pivot);
      legs.push(pivot);
    };
    const trunk = (sx, sy, sz, y) => {
      const m = add(inner, BODY, mat, 0, y, 0);
      m.scale.set(sx, sy, sz);
    };
    const four = (dx, dz, h, r, m) => { for (const [x, z] of [[dx, dz], [-dx, dz], [dx, -dz], [-dx, -dz]]) leg(x, z, h, r, m); };
    const dots = (y, z, apart) => { for (const side of [1, -1]) orb(inner, basic(0x15151c), 0.04, 0.045, 0.03, side * apart, y, z, false); };

    if (kind === 'chicken') {
      trunk(0.27, 0.27, 0.34, 0.6);
      orb(inner, mat, 0.16, 0.17, 0.16, 0, 0.98, 0.26);
      for (let i = 0; i < 3; i++) orb(inner, soft(0xd9432f), 0.045, 0.06, 0.055, 0, 1.17 - i * 0.015, 0.33 - i * 0.08, false);   // the comb
      orb(inner, soft(0xd9432f), 0.035, 0.06, 0.035, 0, 0.86, 0.38, false);
      add(inner, cone(0.06, 0.16).rotateX(Math.PI / 2), soft(0xf2b23a), 0, 0.97, 0.45, false);
      orb(inner, mat, 0.05, 0.2, 0.2, 0, 0.82, -0.36).rotation.x = -0.6;                                                       // tail feathers
      for (const side of [1, -1]) orb(inner, soft(shade(sp.color, 0.9)), 0.07, 0.17, 0.24, side * 0.24, 0.62, -0.02, false);    // wings
      dots(1.02, 0.4, 0.08);
      leg(0.11, 0, 0.36, 0.03, soft(0xf2b23a));
      leg(-0.11, 0, 0.36, 0.03, soft(0xf2b23a));
    } else if (kind === 'sheep') {
      trunk(0.48, 0.44, 0.7, 0.9);
      for (const [x, y, z] of [[0.24, 1.2, 0.3], [-0.24, 1.2, 0.3], [0.2, 1.24, -0.2], [-0.22, 1.22, -0.25], [0, 1.28, 0.02], [0, 1.0, -0.62]]) orb(inner, mat, 0.24, 0.22, 0.26, x, y, z);   // woolly tufts
      orb(inner, dark, 0.19, 0.21, 0.25, 0, 1.02, 0.78);
      for (const side of [1, -1]) orb(inner, dark, 0.1, 0.05, 0.06, side * 0.22, 1.12, 0.7, false);
      for (const side of [1, -1]) orb(inner, basic(0xf4f1e6), 0.035, 0.04, 0.03, side * 0.1, 1.08, 0.99, false);
      four(0.24, 0.4, 0.5, 0.075, dark);
    } else if (kind === 'cow') {
      trunk(0.43, 0.42, 0.74, 0.96);
      orb(inner, cream, 0.3, 0.22, 0.34, 0.2, 1.16, -0.1, false);                 // white patches
      orb(inner, cream, 0.22, 0.24, 0.26, -0.28, 0.98, 0.3, false);
      orb(inner, mat, 0.22, 0.22, 0.27, 0, 1.14, 0.86);
      orb(inner, soft(0xf0b8b0), 0.17, 0.12, 0.13, 0, 1.06, 1.08, false);         // muzzle
      for (const side of [1, -1]) {
        add(inner, cone(0.045, 0.2), cream, side * 0.17, 1.4, 0.82, false).rotation.z = side * -0.5;
        orb(inner, mat, 0.1, 0.05, 0.06, side * 0.26, 1.24, 0.8, false);
      }
      add(inner, pill(0.025, 0.45), dark, 0, 0.9, -0.76).rotation.x = 0.25;        // tail
      dots(1.2, 1.06, 0.12);
      four(0.25, 0.45, 0.56, 0.085, dark);
    } else if (kind === 'pig') {
      trunk(0.4, 0.36, 0.62, 0.7);
      orb(inner, mat, 0.26, 0.25, 0.26, 0, 0.82, 0.64);
      add(inner, new THREE.CylinderGeometry(0.1, 0.11, 0.12, 12).rotateX(Math.PI / 2), soft(0xd98a94), 0, 0.78, 0.92, false);
      for (const side of [1, -1]) add(inner, cone(0.08, 0.16), soft(0xd98a94), side * 0.16, 1.06, 0.6, false).rotation.z = side * -0.4;
      add(inner, new THREE.TorusGeometry(0.07, 0.022, 6, 12), soft(0xd98a94), 0, 0.82, -0.64, false);   // a curly tail
      dots(0.9, 0.87, 0.11);
      four(0.22, 0.34, 0.36, 0.08, dark);
    } else {
      // A deer: slender, long-legged, with antlers.
      trunk(0.29, 0.31, 0.66, 1.1);
      orb(inner, cream, 0.2, 0.12, 0.5, 0, 0.9, 0, false);                         // pale belly
      add(inner, pill(0.11, 0.42), soft(sp.color, { emissive: rest }), 0, 1.5, 0.62).rotation.x = 0.55;   // neck
      orb(inner, mat, 0.15, 0.16, 0.24, 0, 1.82, 0.84);
      orb(inner, soft(0x2a2a33), 0.05, 0.04, 0.04, 0, 1.78, 1.07, false);
      for (const side of [1, -1]) {
        add(inner, pill(0.022, 0.42), cream, side * 0.13, 2.14, 0.74, false).rotation.z = side * -0.35;
        add(inner, pill(0.018, 0.2), cream, side * 0.24, 2.26, 0.78, false).rotation.z = side * -1.0;
        orb(inner, mat, 0.09, 0.045, 0.05, side * 0.19, 1.92, 0.76, false);
      }
      orb(inner, cream, 0.09, 0.1, 0.08, 0, 1.2, -0.66, false);
      dots(1.88, 1.03, 0.09);
      four(0.17, 0.45, 0.8, 0.055, dark);
    }
    return { group, inner, mat, rest, legs, radius: 0.6 * sp.scale, height: 1.2 * sp.scale };
  }

  // A fish, modelled around its middle so it can swim just under the surface.
  const FISH = shadeByHeight(ball(1, 2), 1.28, 0.86);   // pale belly, darker back
  function makeFish(sp, color) {
    const tint = color || sp.color;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const rest = shade(tint, 0.35);
    const mat = body(tint, rest);
    add(inner, FISH, mat, 0, 0, 0).scale.set(0.13, 0.2, 0.4);
    const fin = soft(shade(tint, 0.7));
    orb(inner, fin, 0.03, 0.2, 0.15, 0, 0, -0.5);            // tail
    orb(inner, fin, 0.025, 0.1, 0.16, 0, 0.19, -0.02, false); // back fin
    for (const side of [1, -1]) orb(inner, basic(0x15151c), 0.03, 0.035, 0.03, side * 0.1, 0.05, 0.24, false);
    return { group, inner, mat, rest, legs: [], radius: 0.55, height: 0.5 };
  }

  // A shark: a long grey body with a white belly, a tall back fin and a
  // crescent tail.
  const SHARK = shadeByHeight(ball(1, 2), [1.75, 1.7, 1.65], [0.92, 0.94, 0.98]);
  function makeShark(sp) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const rest = shade(sp.color, 0.2);
    const mat = body(sp.color, rest);
    const fin = soft(shade(sp.color, 0.85), { emissive: rest });
    add(inner, SHARK, mat, 0, 0, 0.1).scale.set(0.44, 0.42, 1.5);
    add(inner, cone(0.27, 1.1).rotateX(-Math.PI / 2), fin, 0, 0.02, -1.55);                 // the body narrows to the tail
    add(inner, cone(0.34, 0.8), fin, 0, 0.62, 0.05).scale.set(0.2, 1, 1);                   // back fin
    add(inner, cone(0.26, 0.85), fin, 0, 0.3, -2.2).scale.set(0.16, 1, 1);                  // tail, upper
    const lower = add(inner, cone(0.2, 0.55), fin, 0, -0.26, -2.15);
    lower.scale.set(0.16, 1, 1);
    lower.rotation.x = Math.PI;
    for (const side of [1, -1]) {
      const flipper = add(inner, cone(0.2, 0.7), fin, side * 0.56, -0.16, 0.45);
      flipper.scale.set(1, 1, 0.2);
      flipper.rotation.z = side * -1.9;
      orb(inner, basic(0x101014), 0.04, 0.045, 0.04, side * 0.3, 0.08, 1.15, false);
    }
    orb(inner, soft(0x2a2a33), 0.2, 0.02, 0.1, 0, -0.2, 1.2, false);                       // a grim mouth
    return { group, inner, mat, rest, legs: [], radius: 0.95, height: 0.8 };
  }

  // ---------- pickups ----------

  function makeHeart() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.42);
    shape.bezierCurveTo(-0.75, 0.05, -0.4, 0.58, 0, 0.22);
    shape.bezierCurveTo(0.4, 0.58, 0.75, 0.05, 0, -0.42);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 14 }).translate(0, 0, -0.07);
    const group = new THREE.Group();
    add(group, geometry, soft(0xf0605d, { emissive: 0x6a1414 }), 0, 0, 0);
    return group;
  }

  // A snorkel mask: a glass face-plate with a tube.
  function makeMask() {
    const g = new THREE.Group();
    add(g, box(0.5, 0.2, 0.08), basic(0x8fe9ff), 0, 0, 0, false);
    add(g, box(0.56, 0.26, 0.05), lambert(0x1f3f46), 0, 0, -0.03, false);
    add(g, box(0.06, 0.5, 0.06), lambert(0xff8a3c), 0.3, 0.2, -0.05, false);
    return g;
  }

  // A drumstick: what a hunted animal leaves behind.
  function makeMeat() {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.z = 0.6;
    orb(tilt, soft(0xb5563c, { emissive: 0x4a1c10 }), 0.27, 0.36, 0.27, 0, 0.18, 0);
    add(tilt, new THREE.CylinderGeometry(0.06, 0.06, 0.45, 10), soft(0xf2ecdc), 0, -0.25, 0);
    orb(tilt, soft(0xf2ecdc), 0.1, 0.1, 0.1, 0, -0.5, 0);
    group.add(tilt);
    group.add(glowSprite(0xffc890, 2.2));
    return group;
  }

  // A rowing boat with its bow towards +z, floating with the waterline at y = 0.
  function makeBoat() {
    const g = new THREE.Group();
    const wood = lambert(0x8a5f3c), dark = lambert(0x5f4129);
    add(g, box(1.7, 0.25, 4.2), wood, 0, 0.05, 0);
    add(g, box(0.2, 0.8, 4.4), dark, 0.9, 0.4, 0);
    add(g, box(0.2, 0.8, 4.4), dark, -0.9, 0.4, 0);
    add(g, box(1.4, 0.8, 0.2), dark, 0, 0.4, -2.15);
    add(g, box(1.0, 0.8, 0.5), dark, 0, 0.4, 2.3);
    add(g, box(0.5, 0.7, 0.5), dark, 0, 0.42, 2.7);
    add(g, box(1.7, 0.12, 0.45), wood, 0, 0.5, -0.5);
    add(g, box(1.7, 0.12, 0.45), wood, 0, 0.5, 1.0);
    const oar = (side) => {
      const o = add(g, box(2.4, 0.08, 0.14), lambert(0xc9a368), side * 1.7, 0.72, 0.1);
      o.rotation.z = side * -0.25;
      add(o, box(0.5, 0.06, 0.34), lambert(0xc9a368), side * 1.3, 0, 0, false);
      return o;
    };
    return { group: g, oars: [oar(1), oar(-1)] };
  }

  // A treasure chest whose lid swings open.
  function makeChest() {
    const group = new THREE.Group();
    const gold = lambert(0xe2b23a, { emissive: 0x3d2a00 });
    add(group, box(1.3, 0.6, 0.85), lambert(0x8a5f3c), 0, 0.3, 0);
    add(group, box(1.36, 0.1, 0.9), gold, 0, 0.6, 0, false);
    const lid = new THREE.Group();
    lid.position.set(0, 0.62, -0.42);
    add(lid, box(1.3, 0.34, 0.85), lambert(0x5f4129), 0, 0.17, 0.42);
    add(lid, box(0.22, 0.3, 0.1), gold, 0, 0.1, 0.86, false);
    group.add(lid);
    const halo = glowSprite(0xffe08a, 4);
    halo.position.y = 1.2;
    group.add(halo);
    return { group, lid, halo };
  }

  // A fixed pool of little shards of colour for bursts and sparkles.
  function makeParticles(scene, count) {
    const geometry = new THREE.TetrahedronGeometry(0.17, 0);
    const pool = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geometry, basic(0xffffff, { transparent: true }));
      m.visible = false;
      scene.add(m);
      pool.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, gravity: 0, size: 1 });
    }
    let next = 0;

    function burst(x, y, z, color, amount, speed, life, gravity, size) {
      for (let i = 0; i < amount; i++) {
        const p = pool[next];
        next = (next + 1) % count;
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.5 + Math.random() * 0.7);
        p.vx = Math.cos(a) * v;
        p.vz = Math.sin(a) * v;
        p.vy = (Math.random() * 1.2 - 0.2) * v;
        p.gravity = gravity === undefined ? 9 : gravity;
        p.max = p.life = life * (0.7 + Math.random() * 0.6);
        p.size = size || 1;
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
        p.m.scale.setScalar((0.5 + k) * p.size);
      }
    }

    return { burst, update };
  }

  WS.Actors = {
    shade, glowSprite, makeFigure, animateFigure, makeMarker, makeWeapon, makeWeaponPickup, makeBolt,
    makeMonster, makeHeart, makeMeat, makeMask, makeBoat, makeChest, makeParticles,
  };
})();
