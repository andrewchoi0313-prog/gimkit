// Builds the 3D scenery: the sky and light, the ground of all seven
// islands, the sea, plants and rocks, the dock, the furniture in the house
// and the treasure chests, plus the solid shapes bodies bump into.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const Zones = WS.Zones;
  const { lambert, basic, add, merge } = WS.Gfx;

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
    const cloudMat = lambert(0xffffff, { emissive: 0x9a9aa8, fog: false });
    const puff = new THREE.IcosahedronGeometry(1, 0);
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
      scene.background = on ? murk : null;
    }

    return { sun, setPalette, setMood, setUnder, update, waterColor, murk };
  }

  // ---------- ground ----------

  const hexes = (list) => list.map((h) => new THREE.Color(h));
  const GROUND = {
    wet: hexes([0xc9b684, 0xc9b684]), sand: hexes([0xecdaa6, 0xdcc78f]), dirt: hexes([0xc09c6e, 0xa98659]),
    rock: hexes([0x8e8a86, 0xa7a199]), meadow: hexes([0x8ccb5c, 0x70b552]), forest: hexes([0x55974f, 0x437f49]),
    desert: hexes([0xe8c982, 0xd9b267]), desertRock: hexes([0xc08f5a, 0xab7c4c]), desertPath: hexes([0xcfa56c, 0xbf955c]),
    snow: hexes([0xf5f8fc, 0xdde7f2]), snowPath: hexes([0xcfd8e2, 0xbfcad6]), snowRock: hexes([0x8d99a8, 0xa3aebb]),
    swamp: hexes([0x64864a, 0x527145]), mud: hexes([0x6f6a4a, 0x5d5a40]),
    blight: hexes([0x5f5769, 0x4b4556]), blightPath: hexes([0x7a7080, 0x6a6072]),
    bloom: hexes([0x9ad86a, 0x86c95e]),
  };

  function groundColor(out, zone, x, z, h, ny) {
    const fine = Zones.noise(x * 0.23, z * 0.23, 5);
    const broad = Zones.noise(x * 0.05 + 9, z * 0.05 + 3, 6);
    const pick = (pair, t) => out.copy(pair[0]).lerp(pair[1], t);
    const onPath = Zones.distToPaths(zone.def.paths, x, z) < 1.6 + fine * 0.8;
    // Jitter the lookup a little so the edge of the woods is ragged.
    const biome = zone.biomeAt(x + (fine - 0.5) * 16, z + (broad - 0.5) * 16);
    if (h < 0.15) return pick(GROUND.wet, 0);
    if (biome === 'swamp') return pick(h < 1 ? GROUND.mud : GROUND.swamp, fine);
    if (h < 1.25) return pick(GROUND.sand, fine);
    if (onPath) return pick(biome === 'desert' ? GROUND.desertPath : biome === 'snow' ? GROUND.snowPath : biome === 'blight' ? GROUND.blightPath : GROUND.dirt, fine);
    if (ny < 0.72) return pick(biome === 'desert' ? GROUND.desertRock : biome === 'snow' ? GROUND.snowRock : GROUND.rock, fine);
    return pick(GROUND[biome], biome === 'meadow' ? broad * 0.7 + fine * 0.3 : fine);
  }

  function buildGround(zone) {
    const { heights, cells, step, half } = zone.terrain;
    const n = cells + 1;
    const positions = new Float32Array(cells * cells * 18);
    const colors = new Float32Array(cells * cells * 18);
    const color = new THREE.Color();
    let o = 0;
    function tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
      // Face normal, to tell steep rock from walkable ground.
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      groundColor(color, zone, (ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny / (Math.hypot(nx, ny, nz) || 1));
      positions.set([ax, ay, az, bx, by, bz, cx, cy, cz], o);
      for (let k = 0; k < 9; k += 3) colors.set([color.r, color.g, color.b], o + k);
      o += 9;
    }
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const x0 = i * step - half, x1 = x0 + step, z0 = j * step - half, z1 = z0 + step;
        const h00 = heights[j * n + i], h10 = heights[j * n + i + 1];
        const h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
        tri(x0, h00, z0, x0, h01, z1, x1, h10, z0);
        tri(x1, h10, z0, x0, h01, z1, x1, h11, z1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    return ground;
  }

  // ---------- plants and rocks ----------

  function instanced(group, geometry, material, items, place, castShadow) {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((item, i) => {
      place(dummy, color, item);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    });
    mesh.frustumCulled = false; // instances are spread over the whole zone
    mesh.castShadow = castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 6);

  function scatter(group, layout, grid) {
    const trunkGeo = cyl(0.2, 0.34, 1.9).translate(0, 0.95, 0);
    const pineGeo = merge([
      new THREE.ConeGeometry(1.55, 2.3, 7).translate(0, 2.5, 0),
      new THREE.ConeGeometry(1.2, 2.0, 7).translate(0, 3.7, 0),
      new THREE.ConeGeometry(0.8, 1.8, 7).translate(0, 4.8, 0),
    ]);
    const roundGeo = merge([
      new THREE.IcosahedronGeometry(1.55, 0).scale(1, 0.9, 1).translate(0, 3.0, 0),
      new THREE.IcosahedronGeometry(1.0, 0).translate(0.9, 2.5, 0.3),
      new THREE.IcosahedronGeometry(0.9, 0).translate(-0.8, 2.7, -0.4),
    ]);
    const cactusGeo = merge([
      cyl(0.3, 0.36, 2.7, 7).translate(0, 1.35, 0),
      new THREE.BoxGeometry(0.55, 0.22, 0.22).translate(0.42, 1.35, 0),
      cyl(0.18, 0.2, 0.95, 6).translate(0.68, 1.75, 0),
      new THREE.BoxGeometry(0.5, 0.22, 0.22).translate(-0.4, 0.95, 0),
      cyl(0.18, 0.2, 0.75, 6).translate(-0.64, 1.25, 0),
    ]);
    const deadGeo = merge([
      cyl(0.12, 0.3, 3.3, 5).translate(0, 1.65, 0),
      cyl(0.05, 0.1, 1.5, 4).rotateZ(-0.9).translate(0.6, 2.4, 0),
      cyl(0.05, 0.1, 1.3, 4).rotateZ(1.0).translate(-0.5, 1.9, 0.1),
      cyl(0.04, 0.08, 1.0, 4).rotateX(0.9).translate(0, 2.9, 0.4),
    ]);
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
    instanced(group, trunkGeo, lambert(WHITE), of('pine', 'round', 'snowpine', 'blossom'), (d, c, t) => { setTree(d, t); c.copy(bark[0]).lerp(bark[1], t.tint); });
    instanced(group, pineGeo, lambert(WHITE), of('pine', 'snowpine'), (d, c, t) => {
      setTree(d, t);
      const pair = t.type === 'snowpine' ? snowy : pine;
      c.copy(pair[0]).lerp(pair[1], t.tint);
    });
    instanced(group, roundGeo, lambert(WHITE), of('round', 'blossom'), (d, c, t) => {
      setTree(d, t);
      if (t.type === 'blossom') c.copy(blossom[0]).lerp(blossom[1], t.tint);
      else if (t.tint > 0.9) c.copy(amber);
      else c.copy(leaf[0]).lerp(leaf[1], t.tint / 0.9);
    });
    instanced(group, cactusGeo, lambert(WHITE), of('cactus'), (d, c, t) => { setTree(d, t); d.position.y = t.y - 0.1; c.copy(cactus[0]).lerp(cactus[1], t.tint); });
    instanced(group, deadGeo, lambert(WHITE), of('dead'), (d, c, t) => { setTree(d, t); c.copy(dead[0]).lerp(dead[1], t.tint); });
    for (const t of layout.trees) {
      grid.add({ kind: 'cyl', x: t.x, z: t.z, r: (t.type === 'dead' ? 0.3 : 0.42) * t.scale, y0: -50, y1: TALL, on: true });
    }

    const rockTints = {
      desert: [C(0xc49a62), C(0xd8b27a)],
      snow: [C(0xa3aebb), C(0xc3ccd6)], blight: [C(0x4a4454), C(0x625a6e)], other: [C(0x8b8782), C(0xb0aaa1)],
    };
    instanced(group, new THREE.IcosahedronGeometry(1, 0), lambert(WHITE), layout.rocks, (d, c, r) => {
      d.position.set(r.x, r.y + r.scale * r.squash * 0.3, r.z);
      d.rotation.set(0, r.turn, 0);
      d.scale.set(r.scale, r.scale * r.squash, r.scale);
      const pair = rockTints[r.biome] || rockTints.other;
      c.copy(pair[0]).lerp(pair[1], (r.turn / 6.3) % 1);
    });
    for (const r of layout.rocks) {
      grid.add({ kind: 'cyl', x: r.x, z: r.z, r: r.scale * 0.8, y0: -50, y1: r.y + r.scale * r.squash * 1.05, on: true });
    }

    const tuftGeo = merge([
      new THREE.ConeGeometry(0.1, 0.6, 4).translate(0, 0.3, 0),
      new THREE.ConeGeometry(0.09, 0.45, 4).rotateZ(0.5).translate(-0.16, 0.2, 0.05),
      new THREE.ConeGeometry(0.09, 0.5, 4).rotateZ(-0.45).translate(0.17, 0.22, -0.04),
    ]);
    const tuft = [C(0x5fa648), C(0x9bd565)], dry = [C(0xb9a55a), C(0xcdbb72)], reed = [C(0x4a6b3e), C(0x6a8a4c)];
    instanced(group, tuftGeo, lambert(WHITE), layout.tufts.filter((t) => t.kind < 2), (d, c, t) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.biome === 'swamp' ? t.scale * 1.5 : t.scale);
      const pair = t.biome === 'desert' ? dry : t.biome === 'swamp' ? reed : tuft;
      c.copy(pair[0]).lerp(pair[1], t.scale - 0.7);
    }, false);
    const petals = [0xffd84a, 0xff8fb0, 0xffffff, 0xb99cff].map(C);
    const flowerGeo = merge([cyl(0.025, 0.025, 0.4, 4).translate(0, 0.2, 0), new THREE.OctahedronGeometry(0.14, 0).translate(0, 0.46, 0)]);
    instanced(group, flowerGeo, lambert(WHITE), layout.tufts.filter((t) => t.kind >= 2 && t.biome !== 'desert'), (d, c, t) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.scale);
      c.copy(petals[Math.floor(t.turn * 7) % petals.length]);
    }, false);
  }

  // ---------- the sea ----------

  function addSea(view, size) {
    const geo = new THREE.PlaneGeometry(size, size, 150, 150).rotateX(-Math.PI / 2);
    // Two-sided, so a diver looking up sees the surface.
    const mesh = new THREE.Mesh(geo, lambert(0x2aa3b5, { transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    view.group.add(mesh);
    const pos = geo.attributes.position;
    view.tickers.push((dt, time) => {
      const a = pos.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] = Math.sin(a[i] * 0.045 + time * 0.9) * 0.14 + Math.sin(a[i + 2] * 0.06 + time * 1.25) * 0.11;
      }
      pos.needsUpdate = true;
    });
    return mesh;
  }

  // ---------- the reef ----------

  // Coral, sponges and weed on the seabed. All for show: nothing to bump into.
  function buildReef(view) {
    const corals = view.zone.layout.corals;
    const glowing = () => lambert(WHITE, { emissive: 0x3a3a3a });
    const branch = merge([
      cyl(0.08, 0.15, 1.0, 5).translate(0, 0.5, 0),
      cyl(0.05, 0.09, 0.75, 5).rotateZ(-0.7).translate(0.3, 0.8, 0),
      cyl(0.05, 0.09, 0.65, 5).rotateZ(0.8).translate(-0.28, 0.65, 0.05),
      cyl(0.04, 0.08, 0.55, 5).rotateX(0.8).translate(0, 0.95, 0.25),
    ]);
    const brain = new THREE.IcosahedronGeometry(0.55, 1).scale(1, 0.7, 1).translate(0, 0.3, 0);
    const weed = merge([
      new THREE.ConeGeometry(0.1, 1.9, 4).translate(0, 0.95, 0),
      new THREE.ConeGeometry(0.08, 1.4, 4).rotateZ(0.25).translate(-0.25, 0.7, 0.1),
      new THREE.ConeGeometry(0.08, 1.6, 4).rotateZ(-0.2).translate(0.22, 0.8, -0.1),
    ]);
    const bright = [0xff6f91, 0xff9a3c, 0xb388ff, 0xffd84a, 0x4fd6c8, 0xff5a5a].map((h) => new THREE.Color(h));
    const green = [0x3fae6a, 0x2f8f6f, 0x6fcf7a].map((h) => new THREE.Color(h));
    const set = (d, c, k, palette) => {
      d.position.set(k.x, k.y - 0.05, k.z);
      d.rotation.set(0, k.turn, 0);
      d.scale.setScalar(k.scale);
      c.copy(palette[k.tint % palette.length]);
    };
    instanced(view.group, branch, glowing(), corals.filter((k) => k.kind === 0), (d, c, k) => set(d, c, k, bright), false);
    instanced(view.group, brain, glowing(), corals.filter((k) => k.kind === 1), (d, c, k) => set(d, c, k, bright), false);
    instanced(view.group, weed, glowing(), corals.filter((k) => k.kind === 2), (d, c, k) => set(d, c, k, green), false);
  }

  // ---------- the dock ----------

  function buildDock(view) {
    const d = view.zone.layout.dock;
    const wood = lambert(0x8a5f3c), woodDark = lambert(0x5f4129);
    const len = d.z1 - d.z0;
    add(view.group, new THREE.BoxGeometry(2.4, 0.22, len), wood, d.x, d.top - 0.11, (d.z0 + d.z1) / 2);
    for (let z = d.z0 + 1; z < d.z1; z += 4) {
      for (const side of [-1.1, 1.1]) add(view.group, cyl(0.16, 0.16, 4.2, 6), woodDark, d.x + side, d.top - 1.6, z);
    }
    add(view.group, cyl(0.14, 0.14, 1.2, 6), woodDark, d.x + 1.1, d.top + 0.5, d.z1 - 0.4);
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
    for (let i = 0; i < 3; i++) add(g, cyl(0.1, 0.1, 0.8, 5), woodDark, f.x, f.y + 0.12, f.z).rotation.set(Math.PI / 2, 0, i * 1.05);
    const flame = add(g, new THREE.ConeGeometry(0.3, 0.8, 5), basic(0xff9a3c), f.x, f.y + 0.55, f.z, false);
    const core = add(g, new THREE.ConeGeometry(0.16, 0.5, 5), basic(0xffe07a), f.x, f.y + 0.45, f.z, false);
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
      sea: null,
    };
    view.group.add(buildGround(zone));
    scatter(view.group, zone.layout, view.grid);
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
    return view;
  }

  WS.World = { PALETTES, createSky, buildZoneView };
})();
