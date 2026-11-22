// Characters and things: the explorer, night monsters, wild animals, weapons,
// hearts, meat, the boat, treasure chests, blaster bolts and sparkles.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const { lambert, basic, add, glowTexture, glyphTexture } = WS.Gfx;

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
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

  // A blocky person standing with their feet at y = 0 and facing +z.
  // `look` picks colours and extras: hat, scarf, pack, lantern.
  function makeFigure(look) {
    const o = Object.assign({ coat: 0x3f7fd0, legs: 0x3a4a63, skin: 0xf0c49a, hair: 0x6b4226, boots: 0x5f4129, hat: 'hair' }, look);
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
    } else if (o.hat === 'cap') {
      add(head, box(0.56, 0.2, 0.54), hatMat, 0, 0.6, 0);
      add(head, box(0.5, 0.06, 0.3), hatMat, 0, 0.52, 0.36);
    } else if (o.hat === 'brim') {
      add(head, new THREE.CylinderGeometry(0.62, 0.62, 0.06, 10), hatMat, 0, 0.53, 0);
      add(head, new THREE.CylinderGeometry(0.26, 0.32, 0.3, 8), hatMat, 0, 0.7, 0);
      add(head, box(0.06, 0.34, 0.04), lambert(0xf2c23a), 0.2, 0.86, 0, false).rotation.z = -0.3;
    }
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

    // Whatever is held points forward out of the right hand.
    const hand = new THREE.Group();
    hand.position.set(0, -0.55, 0.12);
    armR.add(hand);

    const figure = { group, torso, head, armL, armR, legL, legR, hand, phase: 0, light: null };
    if (o.lantern) {
      // A little lantern on the belt, so nights are never pitch black.
      const lantern = new THREE.Group();
      lantern.position.set(0.3, 0.72, 0.26);
      add(lantern, box(0.14, 0.18, 0.14), basic(0xffd27a), 0, 0, 0, false);
      lantern.add(glowSprite(0xffc56a, 1.1));
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
      add(g, new THREE.CylinderGeometry(0.04, 0.055, 1.3, 5).rotateX(Math.PI / 2), woodMat, 0, 0, 0.55);
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

  // A hopping blob.
  function makeBlob(sp, color) {
    const tint = color || sp.color;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(sp.scale);
    group.add(inner);
    const rest = shade(tint, sp.glow ? 0.5 : 0.14);
    const mat = lambert(tint, { emissive: rest });
    const body = add(inner, new THREE.IcosahedronGeometry(0.75, 1), mat, 0, 0.62, 0);
    body.scale.y = 0.85;
    const eyeMat = basic(bright(tint) ? 0x26303c : 0xfdf6c8);
    add(inner, new THREE.SphereGeometry(0.12, 6, 5), eyeMat, 0.25, 0.8, 0.6, false);
    add(inner, new THREE.SphereGeometry(0.12, 6, 5), eyeMat, -0.25, 0.8, 0.6, false);
    const crest = lambert(shade(tint, 0.62));
    add(inner, new THREE.ConeGeometry(0.13, 0.42, 5), crest, 0.32, 1.22, 0).rotation.z = -0.45;
    add(inner, new THREE.ConeGeometry(0.13, 0.42, 5), crest, -0.32, 1.22, 0).rotation.z = 0.45;
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
    const mat = lambert(tint, { emissive: rest });
    const darkMat = lambert(shade(tint, 0.62));
    add(inner, box(1.15, 1.1, 0.8), mat, 0, 1.35, 0);
    add(inner, box(0.8, 0.6, 0.1), lambert(shade(tint, 1.25)), 0, 1.25, 0.41, false);
    add(inner, box(0.62, 0.5, 0.6), mat, 0, 2.05, 0.12);
    const eyeMat = basic(sp.glow ? 0xfff0a0 : 0xffd84a);
    add(inner, box(0.13, 0.1, 0.04), eyeMat, 0.16, 2.1, 0.43, false);
    add(inner, box(0.13, 0.1, 0.04), eyeMat, -0.16, 2.1, 0.43, false);
    add(inner, new THREE.ConeGeometry(0.12, 0.45, 5), darkMat, 0.36, 2.4, 0.1).rotation.z = -0.5;
    add(inner, new THREE.ConeGeometry(0.12, 0.45, 5), darkMat, -0.36, 2.4, 0.1).rotation.z = 0.5;
    function limb(x, y, w, h, d, fist) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      add(pivot, box(w, h, d), darkMat, 0, -h / 2, 0);
      if (fist) add(pivot, box(w + 0.12, 0.4, d + 0.12), mat, 0, -h - 0.1, 0.02);
      inner.add(pivot);
      return pivot;
    }
    const armL = limb(0.78, 1.82, 0.36, 1.2, 0.4, true);
    const armR = limb(-0.78, 1.82, 0.36, 1.2, 0.4, true);
    const legL = limb(0.32, 0.82, 0.42, 0.82, 0.46, false);
    const legR = limb(-0.32, 0.82, 0.42, 0.82, 0.46, false);
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
    const mat = lambert(tint, { emissive: rest, transparent: true, opacity: 0.8 });
    add(inner, new THREE.IcosahedronGeometry(0.55, 1), mat, 0, 0, 0);
    add(inner, new THREE.IcosahedronGeometry(0.3, 0), basic(0xffffff), 0, 0, 0, false);
    const eyeMat = basic(0x26303c);
    add(inner, new THREE.SphereGeometry(0.08, 6, 5), eyeMat, 0.17, 0.08, 0.5, false);
    add(inner, new THREE.SphereGeometry(0.08, 6, 5), eyeMat, -0.17, 0.08, 0.5, false);
    for (let i = 0; i < 3; i++) {
      add(inner, new THREE.TetrahedronGeometry(0.2 - i * 0.045, 0), mat, 0, -0.1 - i * 0.1, -0.6 - i * 0.34, false);
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

  // A four-legged animal (or a chicken) facing +z with its feet at y = 0.
  function makeAnimal(sp) {
    const kind = sp.name.toLowerCase();
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(sp.scale);
    group.add(inner);
    const rest = shade(sp.color, 0.1);
    const mat = lambert(sp.color, { emissive: rest });
    const dark = lambert(kind === 'sheep' ? 0x3a3a3a : shade(sp.color, 0.6));
    const legs = [];
    const leg = (x, z, h, m) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, h, z);
      add(pivot, box(0.16, h, 0.16), m, 0, -h / 2, 0);
      inner.add(pivot);
      legs.push(pivot);
    };
    if (kind === 'chicken') {
      add(inner, box(0.5, 0.5, 0.62), mat, 0, 0.62, 0);
      add(inner, box(0.3, 0.34, 0.3), mat, 0, 1.0, 0.3);
      add(inner, box(0.1, 0.16, 0.2), lambert(0xd9432f), 0, 1.24, 0.3, false);
      add(inner, box(0.12, 0.1, 0.18), lambert(0xf2b23a), 0, 0.98, 0.52, false);
      add(inner, box(0.4, 0.3, 0.2), mat, 0, 0.8, -0.38).rotation.x = -0.5;
      const yellow = lambert(0xf2b23a);
      leg(0.13, 0, 0.38, yellow);
      leg(-0.13, 0, 0.38, yellow);
    } else {
      const tall = kind === 'deer' ? 0.72 : 0.5;
      const fat = kind === 'sheep' ? 0.9 : kind === 'deer' ? 0.56 : 0.74;
      add(inner, box(fat, kind === 'sheep' ? 0.78 : 0.62, 1.25), mat, 0, tall + 0.33, 0);
      const head = add(inner, box(0.44, 0.44, 0.5), kind === 'sheep' ? dark : mat, 0, tall + 0.58, 0.82);
      const eye = basic(0x1c1c22);
      add(head, box(0.06, 0.08, 0.04), eye, 0.23, 0.06, 0.12, false);
      add(head, box(0.06, 0.08, 0.04), eye, -0.23, 0.06, 0.12, false);
      if (kind === 'cow') {
        add(inner, box(0.76, 0.3, 0.5), lambert(0xf6f1e6), 0, tall + 0.5, -0.2, false);
        add(head, box(0.34, 0.2, 0.14), lambert(0xf0b8b0), 0, -0.1, 0.28, false);
        add(head, box(0.08, 0.2, 0.08), lambert(0xe9e2cf), 0.2, 0.3, 0, false);
        add(head, box(0.08, 0.2, 0.08), lambert(0xe9e2cf), -0.2, 0.3, 0, false);
      } else if (kind === 'pig') {
        add(head, box(0.22, 0.16, 0.12), lambert(0xd98a94), 0, -0.06, 0.3, false);
      } else if (kind === 'deer') {
        head.position.y += 0.3;
        add(inner, box(0.2, 0.5, 0.22), mat, 0, tall + 0.7, 0.6).rotation.x = 0.5;
        add(head, box(0.05, 0.5, 0.05), lambert(0xe9e2cf), 0.16, 0.42, -0.05, false).rotation.z = -0.4;
        add(head, box(0.05, 0.5, 0.05), lambert(0xe9e2cf), -0.16, 0.42, -0.05, false).rotation.z = 0.4;
      }
      for (const [x, z] of [[0.24, 0.42], [-0.24, 0.42], [0.24, -0.42], [-0.24, -0.42]]) leg(x, z, tall, dark);
    }
    return { group, inner, mat, rest, legs, radius: 0.6 * sp.scale, height: 1.2 * sp.scale };
  }

  // A fish, modelled around its middle so it can swim just under the surface.
  function makeFish(sp, color) {
    const tint = color || sp.color;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const rest = shade(tint, 0.35);
    const mat = lambert(tint, { emissive: rest });
    add(inner, box(0.2, 0.34, 0.7), mat, 0, 0, 0);
    add(inner, box(0.06, 0.4, 0.3), lambert(shade(tint, 0.7)), 0, 0, -0.5).rotation.x = 0.78;
    add(inner, box(0.22, 0.08, 0.08), basic(0x1c1c22), 0, 0.06, 0.26, false);
    return { group, inner, mat, rest, legs: [], radius: 0.55, height: 0.5 };
  }

  // ---------- pickups ----------

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

  // A shark, modelled around its middle like the fish.
  function makeShark(sp) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const rest = shade(sp.color, 0.2);
    const mat = lambert(sp.color, { emissive: rest });
    add(inner, box(0.75, 0.7, 2.4), mat, 0, 0, 0);
    add(inner, box(0.55, 0.5, 0.8), mat, 0, -0.02, 1.5);
    add(inner, box(0.6, 0.2, 2.2), lambert(0xeef2f4), 0, -0.3, 0.1, false);
    add(inner, new THREE.ConeGeometry(0.36, 0.8, 4), mat, 0, 0.7, 0).scale.set(0.22, 1, 1);
    add(inner, box(0.4, 0.4, 0.9), mat, 0, 0, -1.5);
    add(inner, box(0.08, 1.1, 0.5), mat, 0, 0.1, -2.05).rotation.x = 0.3;
    for (const side of [-1, 1]) {
      add(inner, box(0.7, 0.07, 0.45), mat, side * 0.6, -0.2, 0.5).rotation.z = side * -0.4;
      add(inner, box(0.05, 0.1, 0.1), basic(0x101014), side * 0.29, 0.08, 1.7, false);
    }
    return { group, inner, mat, rest, legs: [], radius: 0.95, height: 0.8 };
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
    add(tilt, new THREE.IcosahedronGeometry(0.3, 1), lambert(0xb5563c, { emissive: 0x4a1c10 }), 0, 0.18, 0).scale.set(0.9, 1.2, 0.9);
    add(tilt, new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6), lambert(0xf2ecdc), 0, -0.25, 0);
    add(tilt, new THREE.SphereGeometry(0.1, 6, 5), lambert(0xf2ecdc), 0, -0.5, 0);
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
