// Builds the 3D scenery: the sky and light, the ground of all seven
// islands, the sea, plants and rocks, the dock, the furniture in the house
// and the treasure chests, plus the solid shapes bodies bump into.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const Zones = WS.Zones;
  const { lambert, soft, basic, add, ball, mergeSmooth, shadeByHeight } = WS.Gfx;

  const lerp = (a, b, t) => a + (b - a) * t;
  const WHITE = 0xffffff; // instanced meshes take their colour from each instance
  const TALL = 1e6;       // "too tall to ever stand on"

  // Sky, light and fog for each time of day.
  const PALETTES = {
    day: { top: 0x4a9be0, horizon: 0xffe9c4, sun: 0xfff0d2, sunPower: 0.62, skyLight: 0xe6f1ff, groundLight: 0x8f9c68, hemi: 0.5, elev: 0.8, turn: 5.5, stars: 0, fogNear: 140, fogFar: 760, cloud: 0xffffff, cloudGlow: 0x9a9aa8, water: 0x2aa3b5 },
    dusk: { top: 0x43478a, horizon: 0xff9e72, sun: 0xffb078, sunPower: 0.62, skyLight: 0xd6c8f2, groundLight: 0x8c7684, hemi: 0.64, elev: 0.26, turn: 4.9, stars: 0.12, fogNear: 120, fogFar: 660, cloud: 0xffb9a0, cloudGlow: 0x8a6a78, water: 0x3b7f9e },
    night: { top: 0x0a1030, horizon: 0x24346a, sun: 0xa9bcff, sunPower: 0.5, skyLight: 0x97a8ea, groundLight: 0x3a4468, hemi: 0.78, elev: 0.95, turn: 0.9, stars: 1, fogNear: 90, fogFar: 520, cloud: 0x5a6aa0, cloudGlow: 0x1a2140, water: 0x1c3f6c },
  };

  // ---------- sky and light ----------

  function createSky(scene) {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -60;
    cam.right = cam.top = 60;
    cam.near = 10;
    cam.far = 340;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.5;
    scene.add(sun);
    scene.add(sun.target);
    scene.fog = new THREE.Fog(0xffffff, 80, 380);
    const sunDir = new THREE.Vector3(0, 1, 0);

    const uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1100, 24, 12),
      new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { float h = clamp(normalize(vDir).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.5)), 1.0); }',
      })
    );
    dome.renderOrder = -10;
    scene.add(dome);
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 12), basic(0xffffff, { fog: false }));
    scene.add(sunDisc);

    const rng = Zones.mulberry32(77);
    const starPositions = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      const a = rng() * Math.PI * 2, y = 0.08 + rng() * 0.92, r = Math.sqrt(1 - y * y);
      starPositions.set([Math.cos(a) * r * 1040, y * 1040, Math.sin(a) * r * 1040], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(stars);

    const clouds = [];
    const cloudMat = soft(0xffffff, { emissive: 0x9a9aa8, fog: false });
    const puff = ball(1, 2);
    for (let i = 0; i < 34; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < puffs; k++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const s = 10 + rng() * 10;
        m.scale.set(s * 1.5, s * 0.6, s);
        m.position.set((k - puffs / 2) * 14 + rng() * 5, rng() * 4, rng() * 9);
        cloud.add(m);
      }
      cloud.position.set((rng() * 2 - 1) * 1100, 120 + rng() * 80, (rng() * 2 - 1) * 1100);
      cloud.userData.speed = 1.2 + rng() * 1.6;
      scene.add(cloud);
      clouds.push(cloud);
    }

    const cA = new THREE.Color(), cB = new THREE.Color();
    const mix = (a, b, k) => cA.setHex(a).lerp(cB.setHex(b), k);
    const waterColor = new THREE.Color();

    // Blends two palettes: k = 0 is all `a`, k = 1 is all `b`.
    function setPalette(a, b, k) {
      uniforms.top.value.copy(mix(a.top, b.top, k));
      uniforms.horizon.value.copy(mix(a.horizon, b.horizon, k));
      scene.fog.color.copy(uniforms.horizon.value);
      scene.fog.near = lerp(a.fogNear, b.fogNear, k);
      scene.fog.far = lerp(a.fogFar, b.fogFar, k);
      sun.color.copy(mix(a.sun, b.sun, k));
      sun.intensity = lerp(a.sunPower, b.sunPower, k);
      sunDisc.material.color.copy(sun.color);
      hemi.color.copy(mix(a.skyLight, b.skyLight, k));
      hemi.groundColor.copy(mix(a.groundLight, b.groundLight, k));
      hemi.intensity = lerp(a.hemi, b.hemi, k);
      stars.material.opacity = lerp(a.stars, b.stars, k);
      cloudMat.color.copy(mix(a.cloud, b.cloud, k));
      cloudMat.emissive.copy(mix(a.cloudGlow, b.cloudGlow, k));
      waterColor.copy(mix(a.water, b.water, k));
      const elev = lerp(a.elev, b.elev, k), turn = lerp(a.turn, b.turn, k);
      sunDir.set(Math.cos(elev) * Math.sin(turn), Math.sin(elev), Math.cos(elev) * Math.cos(turn));
    }

    // The overworld's sky for a mood from 0 (day) through 1 (dusk) to 2 (night).
    function setMood(m) {
      if (m <= 1) setPalette(PALETTES.day, PALETTES.dusk, Math.max(0, m));
      else setPalette(PALETTES.dusk, PALETTES.night, Math.min(1, m - 1));
    }

    function update(dt, time, focus, camera) {
      sun.target.position.set(focus.x, focus.y, focus.z);
      sun.position.set(focus.x + sunDir.x * 150, focus.y + sunDir.y * 150, focus.z + sunDir.z * 150);
      dome.position.copy(camera.position);
      stars.position.copy(camera.position);
      sunDisc.position.set(camera.position.x + sunDir.x * 1020, camera.position.y + sunDir.y * 1020, camera.position.z + sunDir.z * 1020);
      for (const cloud of clouds) {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x > 1150) cloud.position.x = -1150;
      }
    }

    // Under water the sky is swapped for blue-green murk.
    const murk = new THREE.Color(0x1b7f95);
    function setUnder(on) {
      dome.visible = sunDisc.visible = stars.visible = !on;
      for (const cloud of clouds) cloud.visible = !on;
      scene.background = on ? murk : null;
    }

    return { sun, setPalette, setMood, setUnder, update, waterColor, murk };
  }

  // ---------- ground ----------

  const hexes = (list) => list.map((h) => new THREE.Color(h));
  const GROUND = {
    meadow: hexes([0x8ccb5c, 0x70b552]), forest: hexes([0x55974f, 0x437f49]), desert: hexes([0xe8c982, 0xd9b267]),
    snow: hexes([0xf5f8fc, 0xdde7f2]), swamp: hexes([0x64864a, 0x527145]), blight: hexes([0x5f5769, 0x4b4556]),
    bloom: hexes([0x9ad86a, 0x86c95e]),
  };
  const ROCK = { desert: hexes([0xc08f5a, 0xab7c4c]), snow: hexes([0x8d99a8, 0xa3aebb]), blight: hexes([0x3f3a48, 0x4d4758]), other: hexes([0x8e8a86, 0xa7a199]) };
  const PATH = { desert: new THREE.Color(0xc79b62), snow: new THREE.Color(0xc5cfda), blight: new THREE.Color(0x72687a), other: new THREE.Color(0xb49163) };
  const SAND = hexes([0xecdaa6, 0xdcc78f]), MUD = hexes([0x6f6a4a, 0x5d5a40]);
  const WET = new THREE.Color(0xc9b684), SEABED = new THREE.Color(0x8fa48c), EMBER = new THREE.Color(0xff6a2a), SCORCH = new THREE.Color(0x2e2830);
  const SNOW_SHADE = new THREE.Color(0xb9cfe6), ASH = new THREE.Color(0x8a8490);
  const tone = new THREE.Color();

  // The colour of the ground at a point. Nothing here has a hard edge: grass
  // fades into sand, sand into the seabed, meadow into woods, and paths and
  // bare rock are blended in by how close or how steep the ground is.
  function groundColor(out, zone, x, z, h, ny) {
    if (h <= -5.99) return out.copy(SEABED);
    const fine = Zones.noise(x * 0.23, z * 0.23, 5);
    const broad = Zones.noise(x * 0.05 + 9, z * 0.05 + 3, 6);
    const pair = (p, t) => tone.copy(p[0]).lerp(p[1], t);
    const island = Zones.nearestIsland(x, z).island;
    const biome = island.biome;
    if (island.id === 'home') {
      // Meadow in the east, woods in the west, with a ragged edge between.
      out.copy(pair(GROUND.meadow, broad * 0.7 + fine * 0.3));
      out.lerp(pair(GROUND.forest, fine), Zones.woodsOnHome(x + (fine - 0.5) * 18, z + (broad - 0.5) * 18));
    } else {
      out.copy(pair(GROUND[biome], biome === 'bloom' ? broad * 0.7 + fine * 0.3 : fine));
    }
    // Wide, slow patches of lighter and darker ground, so no field is one flat colour.
    const drift = Zones.fbm(x * 0.013 + 50, z * 0.013 + 20, 2, 31);
    out.multiplyScalar(0.9 + drift * 0.2);
    if (biome === 'snow') out.lerp(SNOW_SHADE, Zones.smooth(0.995, 0.9, ny) * 0.55);       // blue in the hollows and on slopes
    if (biome === 'blight') out.lerp(ASH, Zones.smooth(0.36, 0.62, drift) * (0.45 + fine * 0.35)); // drifts of pale ash
    if (island.id === 'ash') {
      // The volcano: scorched slopes and a glowing crater.
      const d = Zones.dist(x, z, Zones.VOLCANO.x, Zones.VOLCANO.z);
      out.lerp(SCORCH, Zones.smooth(Zones.VOLCANO.r, Zones.VOLCANO.crater, d) * 0.6);
      out.lerp(EMBER, Zones.smooth(Zones.VOLCANO.crater * 0.8, 4, d) * (0.6 + fine * 0.4));
    }
    out.lerp(pair(ROCK[biome] || ROCK.other, fine), Zones.smooth(0.86, 0.68, ny));                    // bare rock where it is steep
    if (h > 0.4) out.lerp(PATH[biome] || PATH.other, Zones.smooth(4.4, 1.3, Zones.distToPaths(zone.def.paths, x, z)) * 0.92);
    out.lerp(pair(biome === 'swamp' ? MUD : SAND, fine), Zones.smooth(2.1, 0.9, h));                  // the beach
    out.lerp(WET, Zones.smooth(0.5, -0.2, h));                                                        // the waterline
    return out.lerp(SEABED, Zones.smooth(-0.8, -5, h));                                               // and down into the deep
  }

  // The ground is one grid of heights drawn as 64 smaller meshes, so only the
  // pieces in view are sent to the graphics card. Corners are shared between
  // triangles, which is what makes the hills shade smoothly and the colours
  // blend.
  function buildGround(zone, group) {
    const { heights, cells, step, half } = zone.terrain;
    const n = cells + 1, CH = 64;
    const H = (i, j) => heights[Math.max(0, Math.min(cells, j)) * n + Math.max(0, Math.min(cells, i))];
    const colors = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3);
    const color = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // The slope here, from the heights either side.
        const sx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), sz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
        const len = Math.hypot(sx, 1, sz);
        const o = (j * n + i) * 3;
        normals[o] = -sx / len;
        normals[o + 1] = 1 / len;
        normals[o + 2] = -sz / len;
        groundColor(color, zone, i * step - half, j * step - half, heights[j * n + i], 1 / len);
        colors[o] = color.r;
        colors[o + 1] = color.g;
        colors[o + 2] = color.b;
      }
    }
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let cj = 0; cj < cells; cj += CH) {
      for (let ci = 0; ci < cells; ci += CH) {
        let flat = true;
        for (let j = cj; j <= cj + CH && flat; j++) for (let i = ci; i <= ci + CH; i++) if (heights[j * n + i] !== -6) { flat = false; break; }
        const span = flat ? CH : 1; // open sea needs only one big square
        const side = CH / span + 1;
        const pos = new Float32Array(side * side * 3), nor = new Float32Array(side * side * 3), col = new Float32Array(side * side * 3);
        const index = [];
        for (let b = 0; b < side; b++) {
          for (let a = 0; a < side; a++) {
            const i = ci + a * span, j = cj + b * span, from = (j * n + i) * 3, to = (b * side + a) * 3;
            pos[to] = i * step - half;
            pos[to + 1] = heights[j * n + i];
            pos[to + 2] = j * step - half;
            for (let k = 0; k < 3; k++) {
              nor[to + k] = normals[from + k];
              col[to + k] = colors[from + k];
            }
            if (a < side - 1 && b < side - 1) {
              // Two triangles, split the same way Zones.buildTerrain reads heights.
              const p = b * side + a;
              index.push(p, p + side, p + 1, p + 1, p + side, p + side + 1);
            }
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geometry.setIndex(index);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
  }

  // ---------- plants and rocks ----------

  const PATCH = 128;      // instanced things are grouped into squares this wide
  const CLOSE = 55;       // patches nearer than this are drawn with their full shape

  // Draws many copies of one shape. The copies are split into patches of
  // land so that patches out of view, or lost in the fog, cost nothing.
  // place(dummy, color, item) positions and tints one copy.
  // more.sight: small things need not be drawn from further off than this.
  // more.far: a simpler shape to draw the patch with when it is not close.
  function instanced(view, geometry, material, items, place, castShadow, more) {
    const sight = (more && more.sight) || Infinity, farGeometry = more && more.far;
    const share = (source) => {
      // Each patch shares the shape's data but keeps its own bounds.
      const shape = new THREE.BufferGeometry();
      shape.setIndex(source.index);
      for (const name of Object.keys(source.attributes)) shape.setAttribute(name, source.attributes[name]);
      return shape;
    };
    const patches = new Map();
    for (const item of items) {
      const key = Math.floor(item.x / PATCH) + ',' + Math.floor(item.z / PATCH);
      if (!patches.has(key)) patches.set(key, []);
      patches.get(key).push(item);
    }
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    geometry.computeBoundingSphere();
    for (const list of patches.values()) {
      const shape = share(geometry);
      const mesh = new THREE.InstancedMesh(shape, material, list.length);
      const box = new THREE.Box3();
      let reach = 0;
      list.forEach((item, i) => {
        place(dummy, color, item);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color);
        box.expandByPoint(dummy.position);
        reach = Math.max(reach, Math.max(dummy.scale.x, dummy.scale.y, dummy.scale.z));
      });
      shape.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      shape.boundingSphere.radius += reach * (geometry.boundingSphere.radius + geometry.boundingSphere.center.length());
      mesh.castShadow = castShadow !== false;
      mesh.receiveShadow = true;
      view.group.add(mesh);
      let far = null;
      if (farGeometry) {
        // The same copies, drawn with the simpler shape. Too far off to need shadows.
        const simple = share(farGeometry);
        simple.boundingSphere = shape.boundingSphere;
        far = new THREE.InstancedMesh(simple, material, list.length);
        far.instanceMatrix = mesh.instanceMatrix;
        far.instanceColor = mesh.instanceColor;
        far.castShadow = false;
        far.receiveShadow = true;
        far.visible = false;
        view.group.add(far);
      }
      view.patches.push({ mesh, far, sphere: shape.boundingSphere, sight });
    }
  }

  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 8);
  const painted = () => soft(WHITE, { vertexColors: true });

  function scatter(view, layout) {
    const grid = view.grid;
    // Every shape is smooth-shaded, and painted darker low down and lighter
    // on top so it has some depth before any light falls on it.
    // Trees have two shapes: a round, detailed one for close by, and a
    // simple one with the same outline for further off.
    const trunk = (sides) => shadeByHeight(new THREE.CylinderGeometry(0.2, 0.34, 1.9, sides, 1, true).translate(0, 0.95, 0), 0.8, 1.06);
    const trunkGeo = trunk(8), trunkFar = trunk(5);
    const pineOf = (sides) => {
      const tier = (r, h, y) => shadeByHeight(new THREE.ConeGeometry(r, h, sides).translate(0, y, 0), 0.68, 1.14);
      return mergeSmooth([tier(1.55, 2.3, 2.5), tier(1.2, 2.0, 3.7), tier(0.8, 1.8, 4.8)]);
    };
    const pineGeo = pineOf(16), pineFar = pineOf(7);
    const roundOf = (detail) => shadeByHeight(mergeSmooth([
      ball(1.55, detail).scale(1, 0.9, 1).translate(0, 3.0, 0),
      ball(1.0, detail - 1).translate(0.9, 2.5, 0.3),
      ball(0.9, detail - 1).translate(-0.8, 2.7, -0.4),
    ]), 0.66, 1.14);
    const roundGeo = roundOf(3), roundFar = roundOf(1);
    const cactusOf = (around) => {
      const arm = (r, len, x, y, z, lean) => {
        const g = new THREE.CapsuleGeometry(r, len, 3, around);
        if (lean) g.rotateZ(lean);
        return g.translate(x, y, z);
      };
      return shadeByHeight(mergeSmooth([
        arm(0.32, 2.1, 0, 1.4, 0),
        arm(0.18, 0.5, 0.46, 1.35, 0, Math.PI / 2),
        arm(0.18, 0.7, 0.7, 1.78, 0),
        arm(0.18, 0.45, -0.44, 0.95, 0, Math.PI / 2),
        arm(0.18, 0.5, -0.66, 1.26, 0),
      ]), 0.78, 1.1);
    };
    const cactusGeo = cactusOf(10), cactusFar = cactusOf(5);
    const deadGeo = shadeByHeight(mergeSmooth([
      cyl(0.12, 0.3, 3.3, 7).translate(0, 1.65, 0),
      cyl(0.05, 0.1, 1.5, 6).rotateZ(-0.9).translate(0.6, 2.4, 0),
      cyl(0.05, 0.1, 1.3, 6).rotateZ(1.0).translate(-0.5, 1.9, 0.1),
      cyl(0.04, 0.08, 1.0, 6).rotateX(0.9).translate(0, 2.9, 0.4),
    ]), 0.75, 1.1);
    const C = (h) => new THREE.Color(h);
    const pine = [C(0x2f7d4f), C(0x45a05a)], snowy = [C(0xdfeaf2), C(0xa9c9c0)], leaf = [C(0x5fae4a), C(0x93cf55)];
    const blossom = [C(0xf7b4cf), C(0xffdcea)], amber = C(0xe7a23c), bark = [C(0x7a5536), C(0x94694a)];
    const cactus = [C(0x4f9a5a), C(0x72b86c)], dead = [C(0x6a5a4c), C(0x4f443c)];
    const setTree = (d, t) => {
      d.position.set(t.x, t.y - 0.2, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.scale);
    };
    const of = (...types) => layout.trees.filter((t) => types.includes(t.type));
    instanced(view, trunkGeo, painted(), of('pine', 'round', 'snowpine', 'blossom'), (d, c, t) => { setTree(d, t); c.copy(bark[0]).lerp(bark[1], t.tint); }, true, { far: trunkFar });
    instanced(view, pineGeo, painted(), of('pine', 'snowpine'), (d, c, t) => {
      setTree(d, t);
      const pair = t.type === 'snowpine' ? snowy : pine;
      c.copy(pair[0]).lerp(pair[1], t.tint);
    }, true, { far: pineFar });
    instanced(view, roundGeo, painted(), of('round', 'blossom'), (d, c, t) => {
      setTree(d, t);
      if (t.type === 'blossom') c.copy(blossom[0]).lerp(blossom[1], t.tint);
      else if (t.tint > 0.9) c.copy(amber);
      else c.copy(leaf[0]).lerp(leaf[1], t.tint / 0.9);
    }, true, { far: roundFar });
    instanced(view, cactusGeo, painted(), of('cactus'), (d, c, t) => { setTree(d, t); d.position.y = t.y - 0.1; c.copy(cactus[0]).lerp(cactus[1], t.tint); }, true, { far: cactusFar });
    instanced(view, deadGeo, painted(), of('dead'), (d, c, t) => { setTree(d, t); c.copy(dead[0]).lerp(dead[1], t.tint); });
    for (const t of layout.trees) {
      grid.add({ kind: 'cyl', x: t.x, z: t.z, r: (t.type === 'dead' ? 0.3 : 0.42) * t.scale, y0: -50, y1: TALL, on: true });
    }

    // Rocks: a ball pushed in and out a little so no two sides look alike.
    const rockGeo = ball(1, 2);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
      const k = 1 + (Zones.noise(x * 1.6 + y * 2.9 + 4, z * 1.6 - y * 2.1 + 8, 91) - 0.5) * 0.5;
      rp.setXYZ(i, x * k, y * k, z * k);
    }
    shadeByHeight(rockGeo, 0.7, 1.1);
    const rockTints = {
      desert: [C(0xc49a62), C(0xd8b27a)],
      snow: [C(0xa3aebb), C(0xc3ccd6)], blight: [C(0x4a4454), C(0x625a6e)], other: [C(0x8b8782), C(0xb0aaa1)],
    };
    instanced(view, rockGeo, painted(), layout.rocks, (d, c, r) => {
      d.position.set(r.x, r.y + r.scale * r.squash * 0.3, r.z);
      d.rotation.set(0, r.turn, 0);
      d.scale.set(r.scale, r.scale * r.squash, r.scale);
      const pair = rockTints[r.biome] || rockTints.other;
      c.copy(pair[0]).lerp(pair[1], (r.turn / 6.3) % 1);
    });
    for (const r of layout.rocks) {
      grid.add({ kind: 'cyl', x: r.x, z: r.z, r: r.scale * 0.8, y0: -50, y1: r.y + r.scale * r.squash * 1.05, on: true });
    }

    const blade = (h, lean, x, z) => new THREE.ConeGeometry(0.09, h, 5).rotateZ(lean).translate(x, h / 2 - 0.02, z);
    const tuftGeo = shadeByHeight(mergeSmooth([blade(0.6, 0, 0, 0), blade(0.45, 0.5, -0.16, 0.05), blade(0.5, -0.45, 0.17, -0.04)]), 0.7, 1.2);
    const tuft = [C(0x5fa648), C(0x9bd565)], dry = [C(0xb9a55a), C(0xcdbb72)], reed = [C(0x4a6b3e), C(0x6a8a4c)];
    instanced(view, tuftGeo, painted(), layout.tufts.filter((t) => t.kind < 2), (d, c, t) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.biome === 'swamp' ? t.scale * 1.5 : t.scale);
      const pair = t.biome === 'desert' ? dry : t.biome === 'swamp' ? reed : tuft;
      c.copy(pair[0]).lerp(pair[1], t.scale - 0.7);
    }, false, { sight: 150 });
    // Flowers: a dark stem and a round head in the flower's own colour.
    const petals = [0xffd84a, 0xff8fb0, 0xffffff, 0xb99cff].map(C);
    const flowerGeo = mergeSmooth([
      shadeByHeight(cyl(0.025, 0.025, 0.4, 5).translate(0, 0.2, 0), [0.2, 0.45, 0.2], [0.25, 0.5, 0.25]),
      shadeByHeight(ball(0.14, 1).scale(1, 0.8, 1).translate(0, 0.46, 0), 0.85, 1.15),
    ]);
    instanced(view, flowerGeo, painted(), layout.tufts.filter((t) => t.kind >= 2 && t.biome !== 'desert'), (d, c, t) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.scale);
      c.copy(petals[Math.floor(t.turn * 7) % petals.length]);
    }, false, { sight: 120 });

    // The lake: lily pads lying on the water, some in flower, and reeds with
    // brown heads standing in the shallows.
    const padGeo = new THREE.CircleGeometry(0.62, 20, 0.3, 5.7).rotateX(-Math.PI / 2);
    const padPaint = new Float32Array(padGeo.attributes.position.count * 3).fill(0.82);
    padPaint.set([1.25, 1.25, 1.25], 0); // lighter in the middle
    padGeo.setAttribute('color', new THREE.BufferAttribute(padPaint, 3));
    const pad = [C(0x3f8f4a), C(0x63ad52)];
    instanced(view, padGeo, soft(WHITE, { vertexColors: true, side: THREE.DoubleSide }), layout.pads, (d, c, p) => {
      d.position.set(p.x, 0.07, p.z);
      d.rotation.set(0, p.turn, 0);
      d.scale.setScalar(p.scale);
      c.copy(pad[0]).lerp(pad[1], (p.turn / 6.3) % 1);
    }, false, { sight: 220 });
    const lilyGeo = mergeSmooth([
      shadeByHeight(ball(0.2, 1).scale(1, 0.55, 1).translate(0, 0.1, 0), [1, 0.78, 0.86], [1, 1, 1]),
      shadeByHeight(ball(0.08, 1).translate(0, 0.19, 0), [1, 0.8, 0.2], [1, 0.9, 0.3]),
    ]);
    instanced(view, lilyGeo, painted(), layout.pads.filter((p) => p.flower), (d, c, p) => {
      d.position.set(p.x + 0.1 * p.scale, 0.07, p.z - 0.08 * p.scale);
      d.rotation.set(0, p.turn, 0);
      d.scale.setScalar(p.scale);
      c.set(WHITE);
    }, false, { sight: 140 });
    const stalk = (h, lean, x, z) => [
      shadeByHeight(cyl(0.025, 0.04, h, 5).rotateZ(lean).translate(x - Math.sin(lean) * h / 2, h / 2, z), [0.3, 0.48, 0.22], [0.5, 0.7, 0.34]),
      shadeByHeight(new THREE.CapsuleGeometry(0.06, 0.26, 3, 8).rotateZ(lean).translate(x - Math.sin(lean) * (h - 0.25), h - 0.25, z), [0.36, 0.24, 0.14], [0.46, 0.31, 0.18]),
    ];
    const reedGeo = mergeSmooth([...stalk(2.0, 0, 0, 0), ...stalk(1.6, 0.13, 0.2, 0.08), ...stalk(1.75, -0.1, -0.18, -0.1)]);
    instanced(view, reedGeo, painted(), layout.reeds, (d, c, r) => {
      d.position.set(r.x, r.y - 0.1, r.z);
      d.rotation.set(0, r.turn, 0);
      d.scale.setScalar(r.scale);
      c.set(WHITE);
    }, false, { sight: 220 });
  }

  // ---------- the sea ----------

  // The sea is pale and clear in the shallows and deep blue further out, with
  // slow swells that catch the sun.
  function addSea(view, size) {
    const heightAt = view.zone.heightAt;
    const geo = new THREE.PlaneGeometry(size, size, 220, 220).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, normal = geo.attributes.normal;
    const paint = new Float32Array(pos.count * 4);
    const swell = new Float32Array(pos.count); // how big the waves are here: small in the shallows, almost still on the lake
    const lake = Zones.LAKE;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const deep = Zones.smooth(0.3, 5.2, -heightAt(x, z));
      paint.set([lerp(1.7, 0.74, deep), lerp(1.42, 0.82, deep), lerp(1.26, 0.96, deep), lerp(0.42, 0.88, deep)], i * 4);
      swell[i] = (0.35 + 0.65 * deep) * (1 - 0.85 * Zones.smooth(lake.r + 60, lake.r + 25, Zones.dist(x, z, lake.x, lake.z)));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(paint, 4));
    // Two-sided, so a diver looking up sees the surface.
    const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      color: 0x2aa3b5, vertexColors: true, transparent: true, side: THREE.DoubleSide, specular: 0x8fb8c4, shininess: 70,
    }));
    mesh.receiveShadow = true;
    view.group.add(mesh);
    view.tickers.push((dt, time) => {
      const p = pos.array, nn = normal.array;
      const a = time * 0.9, b = time * 1.25;
      for (let i = 0, n = 0; i < p.length; i += 3, n++) {
        const u = p[i] * 0.045 + a, v = p[i + 2] * 0.06 + b, k = swell[n];
        p[i + 1] = (Math.sin(u) * 0.14 + Math.sin(v) * 0.11) * k;
        // The slope of the swell, steepened so the light picks it out.
        const sx = Math.cos(u) * 0.05 * k, sz = Math.cos(v) * 0.053 * k;
        const len = Math.hypot(sx, 1, sz);
        nn[i] = -sx / len;
        nn[i + 1] = 1 / len;
        nn[i + 2] = -sz / len;
      }
      pos.needsUpdate = true;
      normal.needsUpdate = true;
    });
    return mesh;
  }

  // ---------- the reef ----------

  // Coral, sponges and weed on the seabed. All for show: nothing to bump into.
  function buildReef(view) {
    const corals = view.zone.layout.corals;
    const glowing = () => soft(WHITE, { vertexColors: true, emissive: 0x2c2c2c });
    const arm = (r, len, x, y, z, lean, tip) => {
      const g = new THREE.CapsuleGeometry(r, len, 2, 7);
      if (lean) g.rotateZ(lean);
      if (tip) g.rotateY(tip);
      return g.translate(x, y, z);
    };
    // Paler towards the tips, the way living coral is.
    const branch = shadeByHeight(mergeSmooth([
      arm(0.11, 0.8, 0, 0.5, 0), arm(0.07, 0.55, 0.3, 0.85, 0, -0.75), arm(0.07, 0.5, -0.28, 0.72, 0.05, 0.8),
      arm(0.06, 0.45, 0.05, 1.0, 0.24, 0.7, 1.6), arm(0.06, 0.4, -0.06, 0.95, -0.22, -0.7, 1.4),
    ]), 0.72, 1.35);
    const brain = shadeByHeight(ball(0.55, 2).scale(1, 0.7, 1).translate(0, 0.3, 0), 0.7, 1.2);
    const frond = (h, lean, x, z) => new THREE.ConeGeometry(0.1, h, 6).rotateZ(lean).translate(x, h / 2, z);
    const weed = shadeByHeight(mergeSmooth([frond(1.9, 0, 0, 0), frond(1.4, 0.25, -0.25, 0.1), frond(1.6, -0.2, 0.22, -0.1)]), 0.6, 1.3);
    // Table coral: a wide plate on a short stalk.
    const table = shadeByHeight(mergeSmooth([cyl(0.1, 0.16, 0.5, 8).translate(0, 0.25, 0), ball(0.7, 2).scale(1, 0.16, 1).translate(0, 0.55, 0)]), 0.7, 1.25);
    const bright = [0xff6f91, 0xff9a3c, 0xb388ff, 0xffd84a, 0x4fd6c8, 0xff5a5a].map((h) => new THREE.Color(h));
    const green = [0x3fae6a, 0x2f8f6f, 0x6fcf7a].map((h) => new THREE.Color(h));
    const set = (d, c, k, palette) => {
      d.position.set(k.x, k.y - 0.05, k.z);
      d.rotation.set(0, k.turn, 0);
      d.scale.setScalar(k.scale);
      c.copy(palette[k.tint % palette.length]);
    };
    [branch, brain, weed, table].forEach((shape, kind) => {
      // Coral is only seen through clear water close by, or from under the sea.
      instanced(view, shape, glowing(), corals.filter((k) => k.kind === kind), (d, c, k) => set(d, c, k, kind === 2 ? green : bright), false, { sight: 95 });
    });
  }

  // ---------- the dock ----------

  function buildDock(view) {
    const d = view.zone.layout.dock;
    const wood = lambert(0x8a5f3c), post = soft(0x5f4129);
    const len = d.z1 - d.z0;
    add(view.group, new THREE.BoxGeometry(2.4, 0.22, len), wood, d.x, d.top - 0.11, (d.z0 + d.z1) / 2);
    for (let z = d.z0 + 1; z < d.z1; z += 4) {
      for (const side of [-1.1, 1.1]) add(view.group, cyl(0.16, 0.16, 4.2, 10), post, d.x + side, d.top - 1.6, z);
    }
    add(view.group, cyl(0.14, 0.14, 1.2, 10), post, d.x + 1.1, d.top + 0.5, d.z1 - 0.4);
    view.grid.add({ kind: 'box', x0: d.x - 1.2, x1: d.x + 1.2, z0: d.z0, z1: d.z1, y0: -50, y1: d.top, on: true });
  }

  // ---------- inside the house ----------

  // Stairs, the fire, and furniture. The walls and floors are blocks, placed
  // by the game from the same plan.
  function furnish(view, plan) {
    const g = view.group, grid = view.grid;
    const wood = lambert(0x8a5f3c), woodDark = lambert(0x5f4129), cloth = lambert(0xc94f43), linen = lambert(0xf2ecdc);
    const solid = (x0, x1, z0, z1, top) => grid.add({ kind: 'box', x0, x1, z0, z1, y0: -50, y1: top, on: true });

    for (const s of plan.stairs) {
      const h = s.top - plan.ground;
      add(g, new THREE.BoxGeometry(1, h, 1), wood, (s.x0 + s.x1) / 2, plan.ground + h / 2, (s.z0 + s.z1) / 2);
      grid.add({ kind: 'box', x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, y0: -50, y1: s.top, on: true });
    }

    // The fire in the hearth, with logs and a warm glow.
    const f = plan.fire;
    for (let i = 0; i < 3; i++) add(g, cyl(0.1, 0.1, 0.8, 10), soft(0x5f4129), f.x, f.y + 0.12, f.z).rotation.set(Math.PI / 2, 0, i * 1.05);
    const flame = add(g, new THREE.ConeGeometry(0.3, 0.8, 12), basic(0xff9a3c), f.x, f.y + 0.55, f.z, false);
    const core = add(g, new THREE.ConeGeometry(0.16, 0.5, 12), basic(0xffe07a), f.x, f.y + 0.45, f.z, false);
    const glow = WS.Actors.glowSprite(0xff9a3c, 4.5);
    glow.position.set(f.x + 0.4, f.y + 0.7, f.z);
    g.add(glow);
    const light = new THREE.PointLight(0xffa860, 0.5, 14, 1.5);
    light.position.set(f.x + 1, f.y + 1.2, f.z);
    g.add(light);
    view.tickers.push((dt, time) => {
      flame.scale.set(1 + Math.sin(time * 13) * 0.12, 1 + Math.sin(time * 9) * 0.22, 1 + Math.cos(time * 11) * 0.12);
      core.scale.y = 1 + Math.sin(time * 16) * 0.25;
      light.intensity = 0.5 + Math.sin(time * 10) * 0.06;
    });
    add(g, new THREE.BoxGeometry(2.6, 0.05, 3.2), cloth, f.x + 2.3, f.y + 0.03, f.z, false);       // a rug by the fire

    // Table, two chairs and a note.
    const t = plan.table;
    add(g, new THREE.BoxGeometry(1.5, 0.12, 2.2), wood, t.x, t.y + 0.85, t.z);
    for (const [dx, dz] of [[0.6, 0.95], [-0.6, 0.95], [0.6, -0.95], [-0.6, -0.95]]) add(g, new THREE.BoxGeometry(0.12, 0.8, 0.12), woodDark, t.x + dx, t.y + 0.4, t.z + dz);
    add(g, new THREE.BoxGeometry(0.4, 0.02, 0.55), linen, t.x - 0.1, t.y + 0.93, t.z + 0.2, false).rotation.y = 0.3;
    solid(t.x - 0.75, t.x + 0.75, t.z - 1.1, t.z + 1.1, t.y + 0.9);
    // The snorkel mask lies on the table until it is taken.
    view.mask = WS.Actors.makeMask();
    view.mask.position.set(plan.mask.x, t.y + 1.0, plan.mask.z);
    view.mask.rotation.set(-1.2, 0.5, 0);
    g.add(view.mask);
    for (const side of [-1, 1]) {
      const cx = t.x + side * 1.35;
      add(g, new THREE.BoxGeometry(0.6, 0.1, 0.6), wood, cx, t.y + 0.5, t.z);
      add(g, new THREE.BoxGeometry(0.1, 0.7, 0.6), wood, cx + side * 0.25, t.y + 0.85, t.z);
      for (const [dx, dz] of [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]]) add(g, new THREE.BoxGeometry(0.08, 0.5, 0.08), woodDark, cx + dx, t.y + 0.25, t.z + dz);
      solid(cx - 0.3, cx + 0.3, t.z - 0.3, t.z + 0.3, t.y + 0.55);
    }
    // A bookshelf.
    const b = plan.shelf;
    add(g, new THREE.BoxGeometry(0.5, 2.3, 1.8), woodDark, b.x, b.y + 1.15, b.z);
    [0xd9432f, 0x3f7fd0, 0x2f8f6f, 0xf2c23a, 0x8a4f9e, 0xe07a52].forEach((color, i) => {
      add(g, new THREE.BoxGeometry(0.34, 0.42, 0.2), lambert(color), b.x - 0.12, b.y + 0.7 + Math.floor(i / 3) * 0.7, b.z - 0.5 + (i % 3) * 0.5, false);
    });
    solid(b.x - 0.3, b.x + 0.3, b.z - 0.9, b.z + 0.9, b.y + 2.3);

    // Upstairs: a bed, a wardrobe and another rug.
    const bed = plan.bed;
    add(g, new THREE.BoxGeometry(1.6, 0.4, 2.6), woodDark, bed.x, bed.y + 0.2, bed.z);
    add(g, new THREE.BoxGeometry(1.5, 0.22, 2.5), linen, bed.x, bed.y + 0.5, bed.z);
    add(g, new THREE.BoxGeometry(1.52, 0.1, 1.6), cloth, bed.x, bed.y + 0.62, bed.z - 0.4);
    add(g, new THREE.BoxGeometry(1.0, 0.16, 0.5), lambert(0xffffff), bed.x, bed.y + 0.68, bed.z + 0.9);
    add(g, new THREE.BoxGeometry(1.6, 1.0, 0.14), woodDark, bed.x, bed.y + 0.5, bed.z + 1.3);
    solid(bed.x - 0.8, bed.x + 0.8, bed.z - 1.3, bed.z + 1.3, bed.y + 0.62);
    const w = plan.wardrobe;
    add(g, new THREE.BoxGeometry(1.8, 2.3, 0.7), wood, w.x, w.y + 1.15, w.z);
    add(g, new THREE.BoxGeometry(0.06, 2.0, 0.04), woodDark, w.x, w.y + 1.15, w.z - 0.37, false);
    solid(w.x - 0.9, w.x + 0.9, w.z - 0.35, w.z + 0.35, w.y + 2.3);
    add(g, new THREE.BoxGeometry(3, 0.05, 2.2), lambert(0x3f7fd0), bed.x - 3.4, bed.y + 0.03, bed.z, false);
  }

  // Builds the scenery for the world (from Zones.buildZone). Nothing is added
  // to the scene here: the caller adds `group`.
  function buildZoneView(zone, plan) {
    const view = {
      id: zone.def.id,
      zone,
      group: new THREE.Group(),
      grid: WS.Physics.makeGrid(),
      tickers: [],
      chests: [],
      patches: [],   // instanced patches, hidden when they are out of sight
      sea: null,
    };
    buildGround(zone, view.group);
    scatter(view, zone.layout);
    view.sea = addSea(view, zone.def.size + 1400);
    buildReef(view);
    buildDock(view);
    furnish(view, plan);
    for (const c of zone.layout.chests) {
      const chest = WS.Actors.makeChest();
      chest.group.position.set(c.x, c.y, c.z);
      view.group.add(chest.group);
      view.grid.add({ kind: 'cyl', x: c.x, z: c.z, r: 0.8, y0: -50, y1: c.y + 0.95, on: true });
      view.chests.push(Object.assign({ target: 0 }, c, chest));
    }
    view.tickers.push((dt) => {
      for (const c of view.chests) c.lid.rotation.x += (c.target - c.lid.rotation.x) * Math.min(1, dt * 7);
    });
    // The height of the land at a point, ignoring blocks.
    view.surfaceAt = (x, z) => WS.Physics.groundAt({ heightAt: zone.heightAt, grid: view.grid, store: null }, x, z, 1e4);
    view.tick = (dt, time) => {
      for (const t of view.tickers) t(dt, time);
    };
    // Hides every patch of trees, rocks and coral further off than can be seen.
    view.cull = (eye, sight) => {
      for (const patch of view.patches) {
        const d = patch.sphere.distanceToPoint(eye);
        const seen = d < sight && d < patch.sight;
        patch.mesh.visible = seen && (!patch.far || d < CLOSE);
        if (patch.far) patch.far.visible = seen && d >= CLOSE;
      }
    };
    return view;
  }

  WS.World = { PALETTES, createSky, buildZoneView };
})();
