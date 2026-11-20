// Builds the 3D scenery: the sky and light shared by every zone, and for
// each zone its ground, plants, rocks, portals and landmarks, plus the solid
// shapes bodies bump into.
(function () {
  'use strict';

  const RS = (window.RS = window.RS || {});
  const Zones = RS.Zones;
  const { lambert, basic, add, merge, glowTexture } = RS.Gfx;

  const lerp = (a, b, t) => a + (b - a) * t;
  const WHITE = 0xffffff; // instanced meshes take their colour from each instance
  const TALL = 1e6;       // "too tall to ever stand on"

  // Sky, light and fog for each time of day and each dimension.
  const PALETTES = {
    day: { top: 0x4a9be0, horizon: 0xffe9c4, sun: 0xfff0d2, sunPower: 0.62, skyLight: 0xe6f1ff, groundLight: 0x8f9c68, hemi: 0.5, elev: 0.8, turn: 5.5, stars: 0, fogNear: 110, fogFar: 520, cloud: 0xffffff, cloudGlow: 0x9a9aa8, water: 0x2aa3b5 },
    dusk: { top: 0x43478a, horizon: 0xff9e72, sun: 0xffb078, sunPower: 0.62, skyLight: 0xd6c8f2, groundLight: 0x8c7684, hemi: 0.64, elev: 0.26, turn: 4.9, stars: 0.12, fogNear: 90, fogFar: 460, cloud: 0xffb9a0, cloudGlow: 0x8a6a78, water: 0x3b7f9e },
    night: { top: 0x0a1030, horizon: 0x24346a, sun: 0xa9bcff, sunPower: 0.5, skyLight: 0x97a8ea, groundLight: 0x3a4468, hemi: 0.78, elev: 0.95, turn: 0.9, stars: 1, fogNear: 70, fogFar: 400, cloud: 0x5a6aa0, cloudGlow: 0x1a2140, water: 0x1c3f6c },
    ember: { top: 0x1c0909, horizon: 0xc2491c, sun: 0xffa060, sunPower: 0.5, skyLight: 0xffb89a, groundLight: 0x7a3a22, hemi: 0.72, elev: 0.9, turn: 1.0, stars: 0, fogNear: 50, fogFar: 300, cloud: 0x4a2a26, cloudGlow: 0x2a100c, water: 0xff7a1a },
    frost: { top: 0x8fb4e0, horizon: 0xeef5fc, sun: 0xffffff, sunPower: 0.45, skyLight: 0xeef4ff, groundLight: 0xa9b8cc, hemi: 0.66, elev: 0.6, turn: 5.5, stars: 0, fogNear: 22, fogFar: 170, cloud: 0xffffff, cloudGlow: 0xb0b8c8, water: 0xa9d6ee },
    cloud: { top: 0x3f86e6, horizon: 0xfff2d8, sun: 0xfff6dc, sunPower: 0.66, skyLight: 0xeaf4ff, groundLight: 0xb9c9a0, hemi: 0.56, elev: 0.85, turn: 5.2, stars: 0, fogNear: 140, fogFar: 620, cloud: 0xffffff, cloudGlow: 0xa8a8b4, water: 0xffffff },
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
    for (let i = 0; i < 16; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < puffs; k++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const s = 10 + rng() * 10;
        m.scale.set(s * 1.5, s * 0.6, s);
        m.position.set((k - puffs / 2) * 14 + rng() * 5, rng() * 4, rng() * 9);
        cloud.add(m);
      }
      cloud.position.set((rng() * 2 - 1) * 620, 110 + rng() * 70, (rng() * 2 - 1) * 620);
      cloud.userData.speed = 1.2 + rng() * 1.6;
      scene.add(cloud);
      clouds.push(cloud);
    }

    // Snow or embers drifting around the camera.
    const FLAKES = 520;
    const flakePos = new Float32Array(FLAKES * 3);
    for (let i = 0; i < FLAKES * 3; i++) flakePos[i] = (rng() - 0.5) * (i % 3 === 1 ? 30 : 70);
    const flakeGeo = new THREE.BufferGeometry();
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
    const flakeMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false });
    const flakes = new THREE.Points(flakeGeo, flakeMat);
    flakes.frustumCulled = false;
    flakes.visible = false;
    scene.add(flakes);
    let weather = null;

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

    function setWeather(kind) {
      weather = kind;
      flakes.visible = !!kind;
      flakeMat.color.setHex(kind === 'ember' ? 0xffa040 : 0xffffff);
      flakeMat.size = kind === 'ember' ? 0.16 : 0.24;
    }

    function update(dt, time, focus, camera) {
      sun.target.position.set(focus.x, focus.y, focus.z);
      sun.position.set(focus.x + sunDir.x * 150, focus.y + sunDir.y * 150, focus.z + sunDir.z * 150);
      dome.position.copy(camera.position);
      stars.position.copy(camera.position);
      sunDisc.position.set(camera.position.x + sunDir.x * 1020, camera.position.y + sunDir.y * 1020, camera.position.z + sunDir.z * 1020);
      for (const cloud of clouds) {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x > 660) cloud.position.x = -660;
      }
      if (weather) {
        // Flakes fall (or embers rise) and wrap round a box that follows the camera.
        const fall = weather === 'ember' ? 2.2 : -5.5, drift = weather === 'ember' ? 0.6 : 3.2;
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        for (let i = 0; i < FLAKES * 3; i += 3) {
          let x = flakePos[i] + (drift + Math.sin(time + i) * 0.8) * dt;
          let y = flakePos[i + 1] + fall * dt;
          let z = flakePos[i + 2] + Math.cos(time * 0.7 + i) * 0.6 * dt;
          if (x - cx > 35) x -= 70; else if (x - cx < -35) x += 70;
          if (y - cy > 15) y -= 30; else if (y - cy < -15) y += 30;
          if (z - cz > 35) z -= 70; else if (z - cz < -35) z += 70;
          flakePos[i] = x;
          flakePos[i + 1] = y;
          flakePos[i + 2] = z;
        }
        flakeGeo.attributes.position.needsUpdate = true;
      }
    }

    return { sun, setPalette, setMood, setWeather, update, waterColor };
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
    emberHot: hexes([0x8f3d1d, 0x6d2c16]), ember: hexes([0x41373a, 0x4f423f]), emberHigh: hexes([0x5f4f4b, 0x6b5a54]),
    emberDark: hexes([0x2c2628, 0x362e30]), ash: hexes([0x625758, 0x6e6263]),
    ice: hexes([0xa9d6ee, 0xc6e7f6]),
  };

  function groundColor(out, zone, x, z, h, ny) {
    const fine = Zones.noise(x * 0.23, z * 0.23, 5);
    const broad = Zones.noise(x * 0.05 + 9, z * 0.05 + 3, 6);
    const pick = (pair, t) => out.copy(pair[0]).lerp(pair[1], t);
    const id = zone.def.id;
    const onPath = Zones.distToPaths(zone.def.paths, x, z) < 1.6 + fine * 0.8;
    if (id === 'ember') {
      if (h < 0.55) return pick(GROUND.emberHot, fine);
      if (onPath) return pick(GROUND.ash, fine);
      if (ny < 0.7) return pick(GROUND.emberDark, fine);
      return pick(h > 11 + broad * 4 ? GROUND.emberHigh : GROUND.ember, fine);
    }
    if (id === 'frost') {
      if (zone.biomeAt(x, z) === 'ice') return pick(GROUND.ice, broad);
      if (ny < 0.7) return pick(GROUND.snowRock, fine);
      return pick(onPath ? GROUND.snowPath : GROUND.snow, fine);
    }
    // The overworld. Jitter the lookup a little so biome edges are ragged.
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
    instanced(group, trunkGeo, lambert(WHITE), of('pine', 'round', 'snowpine'), (d, c, t) => { setTree(d, t); c.copy(bark[0]).lerp(bark[1], t.tint); });
    instanced(group, pineGeo, lambert(WHITE), of('pine', 'snowpine'), (d, c, t) => {
      setTree(d, t);
      const pair = t.type === 'snowpine' ? snowy : pine;
      c.copy(pair[0]).lerp(pair[1], t.tint);
    });
    instanced(group, roundGeo, lambert(WHITE), of('round'), (d, c, t) => {
      setTree(d, t);
      if (t.biome === 'cloud') c.copy(blossom[0]).lerp(blossom[1], t.tint);
      else if (t.tint > 0.9) c.copy(amber);
      else c.copy(leaf[0]).lerp(leaf[1], t.tint / 0.9);
    });
    instanced(group, cactusGeo, lambert(WHITE), of('cactus'), (d, c, t) => { setTree(d, t); d.position.y = t.y - 0.1; c.copy(cactus[0]).lerp(cactus[1], t.tint); });
    instanced(group, deadGeo, lambert(WHITE), of('dead'), (d, c, t) => { setTree(d, t); c.copy(dead[0]).lerp(dead[1], t.tint); });
    for (const t of layout.trees) {
      grid.add({ kind: 'cyl', x: t.x, z: t.z, r: (t.type === 'dead' ? 0.3 : 0.42) * t.scale, y0: -50, y1: TALL, on: true });
    }

    const rockTints = {
      desert: [C(0xc49a62), C(0xd8b27a)], ember: [C(0x3a3033), C(0x58453f)], frost: [C(0x9fcfe8), C(0xd4eefa)],
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

  // ---------- portals ----------

  const SWIRL_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const SWIRL_FRAGMENT = [
    'uniform float time; uniform vec3 color; varying vec2 vUv;',
    'void main() {',
    '  vec2 p = vUv - 0.5; p.y *= 1.35;',
    '  float r = length(p); float a = atan(p.y, p.x);',
    '  float s = 0.5 + 0.5 * sin(a * 3.0 + r * 18.0 - time * 3.0);',
    '  float edge = smoothstep(0.56, 0.34, r);',
    '  gl_FragColor = vec4(mix(color * 0.5, color + 0.35, s), edge * (0.55 + 0.4 * s));',
    '}',
  ].join('\n');

  // A stone arch with a swirling doorway. Walk into the swirl to travel.
  function makePortal(view, def, y) {
    const stone = lambert(0x8f8a94), stoneDark = lambert(0x6d6874);
    const g = new THREE.Group();
    g.position.set(def.x, y, def.z);
    g.rotation.y = def.face;
    add(g, new THREE.BoxGeometry(5.4, 0.4, 2.6), stoneDark, 0, 0.05, 0);
    add(g, new THREE.BoxGeometry(0.95, 4.5, 0.95), stone, 1.8, 2.25, 0);
    add(g, new THREE.BoxGeometry(0.95, 4.5, 0.95), stone, -1.8, 2.25, 0);
    add(g, new THREE.BoxGeometry(4.9, 0.95, 1.05), stoneDark, 0, 4.9, 0);
    add(g, new THREE.BoxGeometry(0.7, 0.7, 1.15), basic(def.color), 0, 4.9, 0, false);
    const uniforms = { time: { value: 0 }, color: { value: new THREE.Color(def.color) } };
    const swirl = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 4.3),
      new THREE.ShaderMaterial({ uniforms, vertexShader: SWIRL_VERTEX, fragmentShader: SWIRL_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    swirl.position.y = 2.4;
    g.add(swirl);
    const halo = RS.Actors.glowSprite(def.color, 9);
    halo.position.y = 2.6;
    g.add(halo);
    view.group.add(g);
    const cos = Math.cos(def.face), sin = Math.sin(def.face);
    for (const side of [1.8, -1.8]) {
      view.grid.add({ kind: 'cyl', x: def.x + side * cos, z: def.z - side * sin, r: 0.62, y0: -50, y1: TALL, on: true });
    }
    view.tickers.push((dt, time) => { uniforms.time.value = time; });
    // nx, nz: the way the portal faces. tx, tz: along its doorway.
    view.portals.push({ def, x: def.x, y, z: def.z, nx: sin, nz: cos, tx: cos, tz: -sin });
  }

  // ---------- liquids ----------

  function addLiquid(view, size, level, material, wave, speed) {
    const geo = new THREE.PlaneGeometry(size, size, 110, 110).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = level;
    mesh.receiveShadow = true;
    view.group.add(mesh);
    const pos = geo.attributes.position;
    view.tickers.push((dt, time) => {
      const a = pos.array, t = time * speed;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] = (Math.sin(a[i] * 0.045 + t * 0.9) * 0.14 + Math.sin(a[i + 2] * 0.06 + t * 1.25) * 0.11) * wave;
      }
      pos.needsUpdate = true;
    });
    return mesh;
  }

  // ---------- the overworld's landmarks ----------

  function signpost(view, x, z, turn) {
    const wood = lambert(0x8a5f3c), woodDark = lambert(0x5f4129);
    const g = new THREE.Group();
    g.position.set(x, view.zone.heightAt(x, z), z);
    g.rotation.y = turn;
    add(g, cyl(0.09, 0.11, 2.4), woodDark, 0, 1.2, 0);
    add(g, new THREE.BoxGeometry(1.5, 0.36, 0.1), wood, 0.35, 2.05, 0);
    add(g, new THREE.BoxGeometry(1.3, 0.34, 0.1), wood, -0.3, 1.6, 0.02).rotation.y = 0.5;
    view.group.add(g);
    view.grid.add({ kind: 'cyl', x, z, r: 0.3, y0: -50, y1: TALL, on: true });
    return { x, z };
  }

  function buildOverworld(view) {
    const zone = view.zone, def = zone.def, group = view.group, heightAt = zone.heightAt;
    const wood = lambert(0x8a5f3c), woodDark = lambert(0x5f4129), stoneDark = lambert(0x77736d);

    view.sea = addLiquid(view, 2400, 0, lambert(0x2aa3b5, { transparent: true, opacity: 0.8 }), 1, 1);

    // The homestead: a campfire, a signpost and a stack of timber to build with.
    const home = def.places.home;
    const fire = new THREE.Group();
    const fx = home.x - 7, fz = home.z + 3;
    fire.position.set(fx, heightAt(fx, fz), fz);
    for (let i = 0; i < 3; i++) add(fire, cyl(0.13, 0.13, 1.3, 5), woodDark, 0, 0.14, 0).rotation.set(Math.PI / 2, 0, (i * Math.PI) / 3);
    for (let i = 0; i < 6; i++) add(fire, new THREE.IcosahedronGeometry(0.22, 0), stoneDark, Math.cos(i * 1.05) * 0.85, 0.1, Math.sin(i * 1.05) * 0.85);
    const flame = add(fire, new THREE.ConeGeometry(0.34, 0.9, 5), basic(0xff9a3c), 0, 0.6, 0, false);
    add(fire, new THREE.ConeGeometry(0.18, 0.55, 5), basic(0xffe07a), 0, 0.5, 0, false);
    group.add(fire);
    view.tickers.push((dt, time) => flame.scale.set(1 + Math.sin(time * 13) * 0.12, 1 + Math.sin(time * 9) * 0.2, 1 + Math.cos(time * 11) * 0.12));
    const tx = home.x + 11, tz = home.z - 6, ty = heightAt(tx, tz);
    const logGeo = cyl(0.28, 0.28, 2.4, 7).rotateZ(Math.PI / 2);
    [[0, 0.28, 0], [0, 0.28, 0.6], [0, 0.28, -0.6], [0, 0.78, 0.3], [0, 0.78, -0.3], [0, 1.26, 0]].forEach(([x, y, z]) => add(group, logGeo, wood, tx + x, ty + y, tz + z));
    view.grid.add({ kind: 'box', x0: tx - 1.2, x1: tx + 1.2, z0: tz - 0.9, z1: tz + 0.9, y0: -50, y1: ty + 1.5, on: true });
    view.spots.signs = {
      home: signpost(view, home.x + 4.5, home.z - 16, 0.3),
      crossroads: signpost(view, def.places.crossroads.x + 3, def.places.crossroads.z + 3, -0.6),
    };

    // The giant's fortress: four ruined walls, corner towers and a sealed gate.
    const F = def.fortress;
    const base = heightAt(F.x, F.z);
    const wallMat = lambert(0x5d5868), wallDark = lambert(0x48444f);
    const outer = F.half + F.wall;
    function wall(x0, x1, z0, z1, h, mat) {
      add(group, new THREE.BoxGeometry(x1 - x0, h + 3, z1 - z0), mat || wallMat, (x0 + x1) / 2, base + h / 2 - 1.5, (z0 + z1) / 2);
      view.grid.add({ kind: 'box', x0, x1, z0, z1, y0: -50, y1: base + h, on: true });
    }
    wall(F.x - outer, F.x + outer, F.z - outer, F.z - F.half, F.height + 1);
    wall(F.x - outer, F.x - F.half, F.z - F.half, F.z + F.half, F.height, wallDark);
    wall(F.x + F.half, F.x + outer, F.z - F.half, F.z + F.half, F.height + 0.6, wallDark);
    wall(F.x - outer, F.x - F.gate / 2, F.z + F.half, F.z + outer, F.height);
    wall(F.x + F.gate / 2, F.x + outer, F.z + F.half, F.z + outer, F.height + 0.8);
    add(group, new THREE.BoxGeometry(F.gate + 2, 1.6, F.wall + 0.4), wallDark, F.x, base + F.height - 0.4, F.z + F.half + F.wall / 2);
    const teeth = [];
    for (let n = -5; n <= 5; n++) {
      if (Math.abs(n) > 1) teeth.push(new THREE.BoxGeometry(1.6, 1.2, F.wall).translate(F.x + n * 4, base + F.height + 0.6, F.z + F.half + F.wall / 2));
      teeth.push(new THREE.BoxGeometry(1.6, 1.2, F.wall).translate(F.x + n * 4, base + F.height + 1.6, F.z - F.half - F.wall / 2));
      teeth.push(new THREE.BoxGeometry(F.wall, 1.2, 1.6).translate(F.x - F.half - F.wall / 2, base + F.height + 0.6, F.z + n * 4));
      teeth.push(new THREE.BoxGeometry(F.wall, 1.2, 1.6).translate(F.x + F.half + F.wall / 2, base + F.height + 1.2, F.z + n * 4));
    }
    const teethMesh = new THREE.Mesh(merge(teeth), wallMat);
    teethMesh.castShadow = teethMesh.receiveShadow = true;
    group.add(teethMesh);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = F.x + sx * (F.half + 1), z = F.z + sz * (F.half + 1), h = F.height + 4 + (sx + sz);
      add(group, cyl(3.3, 3.8, h + 3, 9), wallDark, x, base + h / 2 - 1.5, z);
      add(group, cyl(3.9, 3.3, 1, 9), wallMat, x, base + h + 0.5, z);
      view.grid.add({ kind: 'cyl', x, z, r: 3.6, y0: -50, y1: TALL, on: true });
    }
    // Purple braziers light the arena.
    const flameMat = basic(0xc77dff);
    const flames = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = F.x + sx * (F.half - 4), z = F.z + sz * (F.half - 4);
      add(group, cyl(0.7, 0.4, 1.6, 7), wallDark, x, base + 0.8, z);
      flames.push(add(group, new THREE.ConeGeometry(0.5, 1.4, 5), flameMat, x, base + 2.3, z, false));
      view.grid.add({ kind: 'cyl', x, z, r: 0.8, y0: -50, y1: base + 1.6, on: true });
    }
    view.tickers.push((dt, time) => flames.forEach((f, i) => f.scale.set(1, 1 + Math.sin(time * 9 + i * 2) * 0.2, 1)));
    // The seal: a wall of light across the gate until all three crystals are home.
    const sealZ = F.z + F.half + F.wall / 2;
    const sealUniforms = { time: { value: 0 }, color: { value: new THREE.Color(0xb060ff) } };
    const seal = new THREE.Mesh(
      new THREE.PlaneGeometry(F.gate, F.height - 1.2),
      new THREE.ShaderMaterial({ uniforms: sealUniforms, vertexShader: SWIRL_VERTEX, fragmentShader: SWIRL_FRAGMENT.replace('smoothstep(0.56, 0.34, r)', '1.0'), transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    seal.position.set(F.x, base + (F.height - 1.2) / 2, sealZ);
    group.add(seal);
    const sealSolid = view.grid.add({ kind: 'box', x0: F.x - F.gate / 2, x1: F.x + F.gate / 2, z0: sealZ - 0.5, z1: sealZ + 0.5, y0: -50, y1: TALL, on: true });
    view.tickers.push((dt, time) => { sealUniforms.time.value = time; });
    view.setSeal = (on) => {
      seal.visible = on;
      sealSolid.on = on;
    };
    view.spots.gate = { x: F.x, z: sealZ + 2.2 };
    view.arena = { x: F.x, z: F.z, half: F.half - 1, y: base, gateZ: sealZ };
  }

  // ---------- the dimensions ----------

  function stonesAndCrystalStand(view, mat, matPale) {
    const layout = view.zone.layout;
    layout.stones.forEach((s, i) => {
      const depth = s.top + 3;
      add(view.group, cyl(s.r, s.r + 0.35, depth, 7), i % 2 ? matPale : mat, s.x, s.top - depth / 2, s.z).rotation.y = i;
      view.grid.add({ kind: 'cyl', x: s.x, z: s.z, r: s.r, y0: -50, y1: s.top, on: true });
    });
  }

  function buildEmber(view) {
    view.sea = addLiquid(view, 900, 0, lambert(0xff7a1a, { emissive: 0xc8400a }), 0.7, 0.45);
    stonesAndCrystalStand(view, lambert(0x3a3033), lambert(0x52433f));
    const c = view.zone.def.places.crystal, y = view.zone.heightAt(c.x, c.z);
    add(view.group, cyl(1.1, 1.4, 0.7, 8), lambert(0x2c2628), c.x, y + 0.35, c.z);
    view.grid.add({ kind: 'cyl', x: c.x, z: c.z, r: 1.25, y0: -50, y1: y + 0.7, on: true });
  }

  function buildFrost(view) {
    const ice = lambert(0xbfe6f7, { emissive: 0x2a5a78, transparent: true, opacity: 0.9 });
    stonesAndCrystalStand(view, ice, ice);
  }

  function buildCloud(view) {
    const group = view.group;
    view.sea = addLiquid(view, 2600, -16, lambert(0xffffff, { emissive: 0x9aa0b0 }), 5, 0.35);
    const grass = lambert(0x9ad86a), grassPale = lambert(0xb4e27c), rock = lambert(0xbba78e), rockDark = lambert(0x9c8a74);
    view.zone.layout.islands.forEach((isle, i) => {
      add(group, cyl(isle.r, isle.r * 0.93, 1.3, 16), i % 2 ? grass : grassPale, isle.x, isle.top - 0.65, isle.z);
      const depth = isle.r * 1.25;
      add(group, new THREE.ConeGeometry(isle.r * 0.93, depth, 9), i % 2 ? rock : rockDark, isle.x, isle.top - 1.3 - depth / 2, isle.z).rotation.x = Math.PI;
      view.grid.add({ kind: 'cyl', x: isle.x, z: isle.z, r: isle.r, y0: isle.top - 1.3, y1: isle.top, on: true });
    });
    const last = view.zone.layout.islands.find((i) => i.crystal);
    const cr = view.zone.layout.crystal;
    add(group, cyl(1.1, 1.4, 0.7, 8), lambert(0xe6dcc8), cr.x, last.top + 0.35, cr.z);
    view.grid.add({ kind: 'cyl', x: cr.x, z: cr.z, r: 1.25, y0: -50, y1: last.top + 0.7, on: true });
  }

  // Builds the scenery for one zone (from Zones.buildZone). Nothing is added
  // to the scene here: the caller shows and hides `group`.
  function buildZoneView(zone) {
    const view = {
      id: zone.def.id,
      zone,
      group: new THREE.Group(),
      grid: RS.Physics.makeGrid(),
      portals: [],
      tickers: [],
      spots: {},
      sea: null,
      arena: null,
      setSeal() {},
    };
    if (zone.terrain) view.group.add(buildGround(zone));
    scatter(view.group, zone.layout, view.grid);
    // The height of the land (or island top) at a point, ignoring placed blocks.
    view.surfaceAt = (x, z) => RS.Physics.groundAt({ heightAt: zone.heightAt, grid: view.grid, store: null }, x, z, 1e4);
    if (view.id === 'overworld') buildOverworld(view);
    else if (view.id === 'ember') buildEmber(view);
    else if (view.id === 'frost') buildFrost(view);
    else buildCloud(view);
    for (const def of zone.def.portals) makePortal(view, def, view.surfaceAt(def.x, def.z));
    view.tick = (dt, time) => {
      for (const t of view.tickers) t(dt, time);
    };
    return view;
  }

  RS.World = { PALETTES, createSky, buildZoneView };
})();
