// Builds the 3D island: ground, sea, sky, plants, buildings, and the solid
// shapes the player bumps into or stands on.
(function () {
  'use strict';

  const BI = (window.BI = window.BI || {});
  const Island = BI.Island;
  const P = Island.PLACES;

  const { lambert, basic, add, merge, glowTexture, glyphTexture } = BI.Gfx;

  const lerp = (a, b, t) => a + (b - a) * t;

  // Sky, light and sea colours for afternoon (0), dusk (1) and night (2).
  const MOODS = [
    { top: 0x4a9be0, horizon: 0xffe2b0, sun: 0xfff0d2, sunPower: 0.62, skyLight: 0xe6f1ff, groundLight: 0x8f9c68, hemi: 0.5, elev: 0.72, turn: 5.5, sea: 0x2aa3b5, stars: 0, fogNear: 90, fogFar: 400 },
    { top: 0x43478a, horizon: 0xff9e72, sun: 0xffb078, sunPower: 0.62, skyLight: 0xd6c8f2, groundLight: 0x8c7684, hemi: 0.64, elev: 0.26, turn: 4.9, sea: 0x3b7f9e, stars: 0.12, fogNear: 80, fogFar: 380 },
    { top: 0x070b24, horizon: 0x1c2a55, sun: 0xa9bcff, sunPower: 0.42, skyLight: 0x7f90d0, groundLight: 0x222a45, hemi: 0.6, elev: 0.95, turn: 0.9, sea: 0x16345c, stars: 1, fogNear: 60, fogFar: 340 },
  ];

  // ---------- ground ----------

  const GROUND = {
    sandA: new THREE.Color(0xecdaa6), sandB: new THREE.Color(0xdcc78f), wet: new THREE.Color(0xc9b684),
    dirtA: new THREE.Color(0xc09c6e), dirtB: new THREE.Color(0xa98659),
    snowA: new THREE.Color(0xf5f8fc), snowB: new THREE.Color(0xdde7f2),
    rockA: new THREE.Color(0x8e8a86), rockB: new THREE.Color(0xa7a199),
    woodA: new THREE.Color(0x55974f), woodB: new THREE.Color(0x437f49),
    grassA: new THREE.Color(0x8ccb5c), grassB: new THREE.Color(0x70b552),
  };

  function groundColor(out, x, z, h, ny) {
    const fine = Island.noise(x * 0.23, z * 0.23);
    const broad = Island.noise(x * 0.05 + 9, z * 0.05 + 3);
    const m = P.mountain;
    if (h < 0.15) return out.copy(GROUND.wet);
    if (h < 1.25) return out.copy(GROUND.sandA).lerp(GROUND.sandB, fine);
    if (h < 22 && Island.distToPaths(x, z) < 1.5 + fine * 0.7) return out.copy(GROUND.dirtA).lerp(GROUND.dirtB, fine);
    if (h > 21 + broad * 2.5 && Island.dist(x, z, m.x, m.z) < 30) return out.copy(GROUND.snowA).lerp(GROUND.snowB, fine);
    if (ny < 0.74 || h > 12 + broad * 3.5) return out.copy(GROUND.rockA).lerp(GROUND.rockB, fine);
    if (Island.inForest(x, z)) return out.copy(GROUND.woodA).lerp(GROUND.woodB, fine);
    return out.copy(GROUND.grassA).lerp(GROUND.grassB, broad * 0.7 + fine * 0.3);
  }

  function buildGround(terrain) {
    const { heights, cells, step, half } = terrain;
    const n = cells + 1;
    const positions = new Float32Array(cells * cells * 18);
    const colors = new Float32Array(cells * cells * 18);
    const color = new THREE.Color();
    let o = 0;

    function tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
      // Face normal, to tell steep rock from walkable grass.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      groundColor(color, (ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny / len);
      const pts = [ax, ay, az, bx, by, bz, cx, cy, cz];
      for (let k = 0; k < 9; k++) {
        positions[o + k] = pts[k];
        colors[o + k] = k % 3 === 0 ? color.r : k % 3 === 1 ? color.g : color.b;
      }
      o += 9;
    }

    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const x0 = i * step - half, x1 = x0 + step;
        const z0 = j * step - half, z1 = z0 + step;
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

  function instanced(geometry, material, items, place, castShadow) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
    mesh.count = items.length;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((item, i) => {
      place(dummy, color, item);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    });
    mesh.frustumCulled = false; // instances are spread over the whole island
    mesh.castShadow = castShadow !== false;
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildPlants(scene, layout, solids) {
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 1.9, 6).translate(0, 0.95, 0);
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
    const WHITE = 0xffffff; // instanced meshes take their colour from each instance

    const pineA = new THREE.Color(0x2f7d4f), pineB = new THREE.Color(0x45a05a);
    const leafA = new THREE.Color(0x5fae4a), leafB = new THREE.Color(0x93cf55);
    const amber = new THREE.Color(0xe7a23c);
    const barkA = new THREE.Color(0x7a5536), barkB = new THREE.Color(0x94694a);

    const setTree = (d, t) => {
      d.position.set(t.x, t.y - 0.2, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.scale);
    };
    scene.add(instanced(trunkGeo, lambert(WHITE), layout.trees, (d, c, t) => {
      setTree(d, t);
      c.copy(barkA).lerp(barkB, t.tint);
    }));
    scene.add(instanced(pineGeo, lambert(WHITE), layout.trees.filter((t) => t.type === 'pine'), (d, c, t) => {
      setTree(d, t);
      c.copy(pineA).lerp(pineB, t.tint);
    }));
    scene.add(instanced(roundGeo, lambert(WHITE), layout.trees.filter((t) => t.type === 'round'), (d, c, t) => {
      setTree(d, t);
      if (t.tint > 0.9) c.copy(amber); else c.copy(leafA).lerp(leafB, t.tint / 0.9);
    }));
    for (const t of layout.trees) {
      solids.push({ kind: 'cyl', x: t.x, z: t.z, r: 0.42 * t.scale, y0: -50, y1: 1e6, on: true });
    }

    const rockA = new THREE.Color(0x8b8782), rockB = new THREE.Color(0xb0aaa1);
    scene.add(instanced(new THREE.IcosahedronGeometry(1, 0), lambert(WHITE), layout.rocks, (d, c, r) => {
      d.position.set(r.x, r.y + r.scale * r.squash * 0.3, r.z);
      d.rotation.set(0, r.turn, 0);
      d.scale.set(r.scale, r.scale * r.squash, r.scale);
      c.copy(rockA).lerp(rockB, (r.turn / 6.3) % 1);
    }));
    for (const r of layout.rocks) {
      solids.push({ kind: 'cyl', x: r.x, z: r.z, r: r.scale * 0.8, y0: -50, y1: r.y + r.scale * r.squash * 1.05, on: true });
    }

    const grass = layout.tufts.filter((t) => t.kind < 2);
    const flowers = layout.tufts.filter((t) => t.kind >= 2);
    const tuftGeo = merge([
      new THREE.ConeGeometry(0.1, 0.6, 4).translate(0, 0.3, 0),
      new THREE.ConeGeometry(0.09, 0.45, 4).rotateZ(0.5).translate(-0.16, 0.2, 0.05),
      new THREE.ConeGeometry(0.09, 0.5, 4).rotateZ(-0.45).translate(0.17, 0.22, -0.04),
    ]);
    const tuftA = new THREE.Color(0x5fa648), tuftB = new THREE.Color(0x9bd565);
    scene.add(instanced(tuftGeo, lambert(WHITE), grass, (d, c, t) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.scale);
      c.copy(tuftA).lerp(tuftB, t.scale - 0.7);
    }, false));
    const petals = [0xffd84a, 0xff8fb0, 0xffffff, 0xb99cff].map((h) => new THREE.Color(h));
    const flowerGeo = merge([
      new THREE.CylinderGeometry(0.025, 0.025, 0.4, 4).translate(0, 0.2, 0),
      new THREE.OctahedronGeometry(0.14, 0).translate(0, 0.46, 0),
    ]);
    scene.add(instanced(flowerGeo, lambert(WHITE), flowers, (d, c, t) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.turn, 0);
      d.scale.setScalar(t.scale);
      c.copy(petals[Math.floor(t.turn * 7) % petals.length]);
    }, false));
  }

  // ---------- sky ----------

  function buildSky(scene) {
    const uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
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

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), basic(0xffffff, { fog: false }));
    scene.add(sunDisc);

    const starPositions = new Float32Array(600 * 3);
    const rng = Island.mulberry32(77);
    for (let i = 0; i < 600; i++) {
      const a = rng() * Math.PI * 2;
      const y = 0.08 + rng() * 0.92;
      const r = Math.sqrt(1 - y * y);
      starPositions.set([Math.cos(a) * r * 860, y * 860, Math.sin(a) * r * 860], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(stars);

    const clouds = [];
    const cloudMat = lambert(0xffffff, { emissive: 0x9a9aa8, fog: false });
    const puff = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 11; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < puffs; k++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const s = 9 + rng() * 9;
        m.scale.set(s * 1.5, s * 0.6, s);
        m.position.set((k - puffs / 2) * 13 + rng() * 5, rng() * 4, rng() * 9);
        cloud.add(m);
      }
      cloud.position.set((rng() * 2 - 1) * 420, 85 + rng() * 55, (rng() * 2 - 1) * 420);
      cloud.userData.speed = 1.2 + rng() * 1.6;
      scene.add(cloud);
      clouds.push(cloud);
    }
    return { uniforms, dome, sunDisc, stars, clouds, cloudMat };
  }

  // ---------- the world ----------

  function build(scene, terrain, layout) {
    const heightAt = terrain.heightAt;
    const solids = [];
    const tickers = []; // functions called every frame with (dt, time)

    const stone = lambert(0x9c978f);
    const stoneDark = lambert(0x77736d);
    const wood = lambert(0x8a5f3c);
    const woodDark = lambert(0x5f4129);
    const glow = glowTexture();

    scene.add(buildGround(terrain));
    buildPlants(scene, layout, solids);

    // --- light ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.5;
    scene.add(sun);
    scene.add(sun.target);
    const sunDir = new THREE.Vector3(0, 1, 0);

    scene.fog = new THREE.Fog(0xffffff, 80, 380);
    const sky = buildSky(scene);

    // --- sea ---
    const seaGeo = new THREE.PlaneGeometry(1800, 1800, 120, 120).rotateX(-Math.PI / 2);
    const seaMat = lambert(0x2aa3b5, { transparent: true, opacity: 0.8 });
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.receiveShadow = true;
    scene.add(sea);
    const seaPos = seaGeo.attributes.position;
    tickers.push((dt, time) => {
      const a = seaPos.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] = Math.sin(a[i] * 0.045 + time * 0.9) * 0.14 + Math.sin(a[i + 2] * 0.06 + time * 1.25) * 0.11;
      }
      seaPos.needsUpdate = true;
    });

    // --- lighthouse ---
    const L = P.lighthouse;
    const groundL = heightAt(L.x, L.z);
    const lighthouse = new THREE.Group();
    lighthouse.position.set(L.x, groundL, L.z);
    scene.add(lighthouse);
    add(lighthouse, new THREE.CylinderGeometry(4.3, 4.8, 1.4, 12), stone, 0, 0.5, 0);
    const towerWhite = lambert(0xf4efe4);
    const towerRed = lambert(0xd9483b);
    for (let i = 0; i < 4; i++) {
      add(lighthouse, new THREE.CylinderGeometry(3.25 - 0.32 * (i + 1), 3.25 - 0.32 * i, 4.2, 12), i % 2 ? towerRed : towerWhite, 0, 1.2 + 2.1 + i * 4.2, 0);
    }
    const galleryY = 1.2 + 16.8;
    add(lighthouse, new THREE.CylinderGeometry(3.0, 2.5, 0.5, 12), stoneDark, 0, galleryY + 0.25, 0);
    add(lighthouse, new THREE.TorusGeometry(2.9, 0.07, 5, 16).rotateX(Math.PI / 2), stoneDark, 0, galleryY + 1.1, 0, false);
    const lampMat = basic(0x39445a, { transparent: true, opacity: 0.92 });
    add(lighthouse, new THREE.CylinderGeometry(1.5, 1.5, 2.5, 8), lampMat, 0, galleryY + 1.75, 0, false);
    add(lighthouse, new THREE.ConeGeometry(2.2, 1.9, 8), towerRed, 0, galleryY + 3.95, 0);
    add(lighthouse, new THREE.SphereGeometry(0.28, 8, 6), stoneDark, 0, galleryY + 5.05, 0);
    const lampY = groundL + galleryY + 1.75;

    const doorDir = new THREE.Vector2(45 - L.x, 81 - L.z).normalize();
    const door = add(lighthouse, new THREE.BoxGeometry(1.5, 2.6, 0.4), woodDark, doorDir.x * 3.15, 2.5, doorDir.y * 3.15);
    door.rotation.y = Math.atan2(doorDir.x, doorDir.y);
    const stepMesh = add(lighthouse, new THREE.BoxGeometry(2.4, 0.5, 1.4), stone, doorDir.x * 4.6, 0.25, doorDir.y * 4.6);
    stepMesh.rotation.y = door.rotation.y;
    solids.push({ kind: 'cyl', x: L.x, z: L.z, r: 4.5, y0: -50, y1: 1e6, on: true });

    const beam = new THREE.Group();
    beam.position.set(L.x, lampY, L.z);
    beam.visible = false;
    const beamMat = basic(0xfff3b8, { transparent: true, opacity: 0.17, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const side of [1, -1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 150, 18, 1, true), beamMat);
      cone.rotation.z = (side * Math.PI) / 2;
      cone.position.x = side * 75;
      beam.add(cone);
    }
    scene.add(beam);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff0a8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    lampGlow.scale.setScalar(22);
    lampGlow.position.set(L.x, lampY, L.z);
    lampGlow.visible = false;
    scene.add(lampGlow);
    const lampLight = new THREE.PointLight(0xffe7a0, 0, 70, 1.6);
    lampLight.position.set(L.x, lampY, L.z);
    scene.add(lampLight);

    // Ships that come home once the beacon is lit.
    const ships = new THREE.Group();
    ships.visible = false;
    const hullMat = lambert(0x6b4a33);
    const sailMat = lambert(0xf2ead8, { side: THREE.DoubleSide });
    [[150, 150, 0.6], [95, 190, -0.4], [205, 95, 1.2]].forEach(([x, z, turn]) => {
      const ship = new THREE.Group();
      add(ship, new THREE.BoxGeometry(7, 1.6, 2.4), hullMat, 0, 0.5, 0, false);
      add(ship, new THREE.CylinderGeometry(0.12, 0.12, 6, 5), hullMat, 0, 4, 0, false);
      add(ship, new THREE.ConeGeometry(2.6, 4.6, 3), sailMat, 0.4, 4.4, 0, false);
      const lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffc66b, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      lantern.scale.setScalar(7);
      lantern.position.set(-3, 2.4, 0);
      ship.add(lantern);
      ship.position.set(x, 0, z);
      ship.rotation.y = turn;
      ship.userData.phase = x;
      ships.add(ship);
    });
    scene.add(ships);

    tickers.push((dt, time) => {
      if (beam.visible) beam.rotation.y += dt * 0.55;
      if (ships.visible) {
        for (const ship of ships.children) {
          ship.position.y = Math.sin(time * 0.9 + ship.userData.phase) * 0.25;
          ship.rotation.z = Math.sin(time * 0.7 + ship.userData.phase) * 0.05;
        }
      }
    });

    // --- landing beach: a rowing boat and a campfire ---
    const S = P.start;
    const boat = new THREE.Group();
    const bx = S.x + 6, bz = S.z + 6.5;
    boat.position.set(bx, Math.max(heightAt(bx, bz), 0) + 0.25, bz);
    boat.rotation.set(0.05, 0.7, 0.12);
    add(boat, new THREE.BoxGeometry(1.5, 0.25, 3.6), wood, 0, 0, 0);
    add(boat, new THREE.BoxGeometry(0.2, 0.75, 3.8), woodDark, 0.8, 0.3, 0);
    add(boat, new THREE.BoxGeometry(0.2, 0.75, 3.8), woodDark, -0.8, 0.3, 0);
    add(boat, new THREE.BoxGeometry(1.6, 0.75, 0.2), woodDark, 0, 0.3, 1.85);
    add(boat, new THREE.BoxGeometry(1.2, 0.75, 0.2), woodDark, 0, 0.3, -1.9);
    add(boat, new THREE.BoxGeometry(1.5, 0.12, 0.4), wood, 0, 0.42, 0.3);
    scene.add(boat);
    solids.push({ kind: 'cyl', x: bx, z: bz, r: 1.5, y0: -50, y1: 1e6, on: true });

    const fire = new THREE.Group();
    const fx = S.x - 4.5, fz = S.z - 2.5;
    fire.position.set(fx, heightAt(fx, fz), fz);
    for (let i = 0; i < 3; i++) {
      const log = add(fire, new THREE.CylinderGeometry(0.13, 0.13, 1.3, 5), woodDark, 0, 0.14, 0);
      log.rotation.set(Math.PI / 2, 0, (i * Math.PI) / 3);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      add(fire, new THREE.IcosahedronGeometry(0.22, 0), stoneDark, Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85);
    }
    const flame = add(fire, new THREE.ConeGeometry(0.34, 0.9, 5), basic(0xff9a3c), 0, 0.6, 0, false);
    const flameCore = add(fire, new THREE.ConeGeometry(0.18, 0.55, 5), basic(0xffe07a), 0, 0.5, 0, false);
    scene.add(fire);
    tickers.push((dt, time) => {
      flame.scale.set(1 + Math.sin(time * 13) * 0.12, 1 + Math.sin(time * 9) * 0.2, 1 + Math.cos(time * 11) * 0.12);
      flameCore.scale.y = 1 + Math.sin(time * 16) * 0.25;
    });

    // --- signposts ---
    function signpost(x, z, turn) {
      const g = new THREE.Group();
      g.position.set(x, heightAt(x, z), z);
      g.rotation.y = turn;
      add(g, new THREE.CylinderGeometry(0.09, 0.11, 2.4, 6), woodDark, 0, 1.2, 0);
      add(g, new THREE.BoxGeometry(1.5, 0.36, 0.1), wood, 0.35, 2.05, 0);
      add(g, new THREE.BoxGeometry(1.3, 0.34, 0.1), wood, -0.3, 1.6, 0.02).rotation.y = 0.5;
      scene.add(g);
      solids.push({ kind: 'cyl', x, z, r: 0.3, y0: -50, y1: 1e6, on: true });
      return { x, z };
    }
    const signs = {
      beach: signpost(S.x + 4, S.z - 5, 0.4),
      crossroads: signpost(P.crossroads.x - 3.2, P.crossroads.z + 2.5, -0.5),
      ring: signpost(4, 27, 0.2),
    };

    // --- trader's camp ---
    const T = P.trader;
    const groundT = heightAt(T.x, T.z);
    const tentMat = lambert(0xe07a52);
    add(scene, new THREE.ConeGeometry(2.7, 3.2, 4).rotateY(Math.PI / 4), tentMat, T.x - 3.2, groundT + 1.6, T.z - 1.6);
    add(scene, new THREE.ConeGeometry(0.5, 0.6, 4).rotateY(Math.PI / 4), lambert(0xf6efdc), T.x - 3.2, groundT + 3.3, T.z - 1.6, false);
    add(scene, new THREE.BoxGeometry(0.9, 0.9, 0.9), wood, T.x - 0.4, groundT + 0.45, T.z - 2.6).rotation.y = 0.3;
    add(scene, new THREE.BoxGeometry(0.7, 0.7, 0.7), woodDark, T.x - 0.2, groundT + 1.25, T.z - 2.5).rotation.y = 0.8;
    add(scene, new THREE.BoxGeometry(0.8, 0.8, 0.8), wood, T.x + 0.9, groundT + 0.4, T.z - 2.3).rotation.y = -0.2;
    solids.push({ kind: 'cyl', x: T.x - 3.2, z: T.z - 1.6, r: 2.0, y0: -50, y1: 1e6, on: true });
    solids.push({ kind: 'cyl', x: T.x + 0.1, z: T.z - 2.5, r: 1.1, y0: -50, y1: groundT + 0.9, on: true });

    // --- stone ring and the rune puzzle ---
    const R = P.ring;
    const groundR = heightAt(R.x, R.z);
    // The altar is low enough to step onto, so the shard above it can be reached.
    add(scene, new THREE.CylinderGeometry(1.7, 2.0, 0.45, 8), stone, R.x, groundR + 0.225, R.z);
    solids.push({ kind: 'cyl', x: R.x, z: R.z, r: 1.85, y0: -50, y1: groundR + 0.45, on: true });
    const runeAngles = { sun: 0, moon: Math.PI, star: -Math.PI / 2 };
    const runes = {};
    const plainStone = new THREE.BoxGeometry(1.2, 2.4, 0.8);
    const runeStone = new THREE.BoxGeometry(1.7, 3.2, 0.8);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const kind = Object.keys(runeAngles).find((k) => Math.abs(Math.atan2(Math.sin(a - runeAngles[k]), Math.cos(a - runeAngles[k]))) < 0.01);
      if (i === 2) continue; // the gap where the path comes in from the south
      const radius = 7;
      const x = R.x + Math.cos(a) * radius;
      const z = R.z + Math.sin(a) * radius;
      const g = new THREE.Group();
      g.position.set(x, groundR, z);
      g.rotation.y = Math.atan2(R.x - x, R.z - z); // face the altar
      scene.add(g);
      if (kind) {
        add(g, runeStone, stone, 0, 1.6, 0);
        const mat = basic(0x4d5866, { map: glyphTexture(kind), transparent: true });
        const front = add(g, new THREE.PlaneGeometry(1.3, 1.3), mat, 0, 2.0, 0.41, false);
        const back = add(g, new THREE.PlaneGeometry(1.3, 1.3), mat, 0, 2.0, -0.41, false);
        back.rotation.y = Math.PI;
        front.receiveShadow = back.receiveShadow = false;
        runes[kind] = { x, z, mat };
      } else {
        const m = add(g, plainStone, i % 2 ? stone : stoneDark, 0, 1.1 + (i % 3) * 0.12, 0);
        m.rotation.z = (i % 2 ? 1 : -1) * 0.06;
      }
      solids.push({ kind: 'cyl', x, z, r: 0.85, y0: -50, y1: 1e6, on: true });
    }
    const tablet = new THREE.Group();
    const tabletX = R.x - 3.2, tabletZ = R.z + 8.8;
    tablet.position.set(tabletX, groundR, tabletZ);
    tablet.rotation.set(0, 0.3, 0);
    add(tablet, new THREE.BoxGeometry(1.6, 1.1, 0.25), stoneDark, 0, 0.75, 0).rotation.x = -0.35;
    add(tablet, new THREE.BoxGeometry(0.5, 0.5, 0.4), stone, 0, 0.25, -0.1);
    scene.add(tablet);
    solids.push({ kind: 'cyl', x: tabletX, z: tabletZ, r: 0.8, y0: -50, y1: 1e6, on: true });

    const RUNE_OFF = new THREE.Color(0x4d5866), RUNE_ON = new THREE.Color(0xffd66b), RUNE_BAD = new THREE.Color(0xff5a4a);
    let runeFlash = 0;
    let runeLit = [];
    function paintRunes() {
      for (const kind of Object.keys(runes)) {
        runes[kind].mat.color.copy(runeFlash > 0 ? RUNE_BAD : runeLit.includes(kind) ? RUNE_ON : RUNE_OFF);
      }
    }
    tickers.push((dt) => {
      if (runeFlash > 0) {
        runeFlash -= dt;
        if (runeFlash <= 0) paintRunes();
      }
    });

    // --- grove ---
    const G = P.grove;
    const groundG = heightAt(G.x, G.z);
    add(scene, new THREE.CylinderGeometry(1.1, 1.3, 0.7, 9), wood, G.x, groundG + 0.35, G.z);
    solids.push({ kind: 'cyl', x: G.x, z: G.z, r: 1.2, y0: -50, y1: groundG + 0.7, on: true });
    const capMat = lambert(0x5fd0c5, { emissive: 0x1c6f68 });
    const stemMat = lambert(0xe9e2cf);
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + 0.2;
      const r = 5.6 + (i % 3) * 0.9;
      const x = G.x + Math.cos(a) * r, z = G.z + Math.sin(a) * r;
      const y = heightAt(x, z);
      const s = 0.7 + (i % 4) * 0.2;
      add(scene, new THREE.CylinderGeometry(0.09 * s, 0.12 * s, 0.5 * s, 5), stemMat, x, y + 0.25 * s, z, false);
      add(scene, new THREE.ConeGeometry(0.36 * s, 0.3 * s, 7), capMat, x, y + 0.62 * s, z, false);
    }
    const seal = add(scene, new THREE.IcosahedronGeometry(1.7, 1), basic(0x2b1a4a, { transparent: true, opacity: 0.6, depthWrite: false }), G.x, groundG + 2.0, G.z, false);
    seal.receiveShadow = false;
    tickers.push((dt, time) => {
      if (seal.visible) {
        seal.rotation.y += dt * 0.6;
        seal.scale.setScalar(1 + Math.sin(time * 2.2) * 0.05);
      }
    });

    // --- old vault ---
    const V = P.vault;
    const groundV = heightAt(V.x, V.z);
    const VD = Island.VAULT;
    const outer = VD.half + VD.wall;
    function wall(x0, x1, z0, z1, h, mat) {
      add(scene, new THREE.BoxGeometry(x1 - x0, h, z1 - z0), mat || stone, (x0 + x1) / 2, groundV + h / 2 - 0.3, (z0 + z1) / 2);
      solids.push({ kind: 'box', x0, x1, z0, z1, y0: -50, y1: groundV + h - 0.3, on: true });
    }
    const wallH = VD.height;
    wall(V.x - outer, V.x + outer, V.z - outer, V.z - VD.half, wallH);
    wall(V.x - outer, V.x + outer, V.z + VD.half, V.z + outer, wallH + 0.5);
    wall(V.x + VD.half, V.x + outer, V.z - VD.half, V.z + VD.half, wallH + 0.9, stoneDark);
    const gateHalf = VD.gateWidth / 2;
    wall(V.x - outer, V.x - VD.half, V.z - VD.half, V.z - gateHalf, wallH + 0.4, stoneDark);
    wall(V.x - outer, V.x - VD.half, V.z + gateHalf, V.z + VD.half, wallH);
    // Lintel over the gate: high enough to walk under.
    add(scene, new THREE.BoxGeometry(VD.wall + 0.3, 0.9, VD.gateWidth + 1.2), stoneDark, V.x - VD.half - VD.wall / 2, groundV + 4.0, V.z);
    // Broken blocks on top of the walls.
    [[-4, -6.2, 0.9], [2.5, -6.2, 1.3], [5, 6.2, 0.8], [-1, 6.2, 1.1], [6.2, 1, 1.2], [6.2, -4, 0.7]].forEach(([dx, dz, s], i) => {
      add(scene, new THREE.BoxGeometry(1.5 * s, 0.9 * s, 1.1), i % 2 ? stone : stoneDark, V.x + dx, groundV + wallH + 0.25 + 0.4 * s, V.z + dz).rotation.y = i * 0.2;
    });
    // The gate itself: iron bars that sink into the ground when unlocked.
    const gate = new THREE.Group();
    const gateX = V.x - VD.half - VD.wall / 2;
    gate.position.set(gateX, groundV, V.z);
    const iron = lambert(0x3d4654);
    for (let i = 0; i < 6; i++) {
      add(gate, new THREE.CylinderGeometry(0.09, 0.09, 3.5, 5), iron, 0, 1.75, -gateHalf + 0.3 + i * ((VD.gateWidth - 0.6) / 5));
    }
    add(gate, new THREE.BoxGeometry(0.2, 0.22, VD.gateWidth), iron, 0, 3.2, 0);
    add(gate, new THREE.BoxGeometry(0.2, 0.22, VD.gateWidth), iron, 0, 1.3, 0);
    add(gate, new THREE.BoxGeometry(0.34, 0.5, 0.5), lambert(0xd9a531), -0.12, 1.3, 0);
    scene.add(gate);
    const gateSolid = { kind: 'box', x0: gateX - 0.25, x1: gateX + 0.25, z0: V.z - gateHalf, z1: V.z + gateHalf, y0: -50, y1: groundV + 3.6, on: true };
    solids.push(gateSolid);
    let gateDrop = 0; // 0 closed .. 1 open
    let gateTarget = 0;
    tickers.push((dt) => {
      if (gateDrop !== gateTarget) {
        gateDrop = Math.min(gateTarget, gateDrop + dt * 0.9);
        gate.position.y = groundV - gateDrop * 3.7;
      }
    });
    // Pedestal and a few fallen pillars outside.
    add(scene, new THREE.CylinderGeometry(0.9, 1.1, 0.8, 8), stoneDark, V.x, groundV + 0.4, V.z);
    solids.push({ kind: 'cyl', x: V.x, z: V.z, r: 1.0, y0: -50, y1: groundV + 0.8, on: true });
    [[-11, -5, 3.4], [-11, 5, 2.2], [-15, -5, 1.4], [-15, 5, 3.0], [-4, -10.5, 2.6], [5, 10.5, 1.8]].forEach(([dx, dz, h]) => {
      const x = V.x + dx, z = V.z + dz, y = heightAt(x, z);
      add(scene, new THREE.CylinderGeometry(0.55, 0.65, h, 8), stone, x, y + h / 2 - 0.2, z);
      add(scene, new THREE.CylinderGeometry(0.8, 0.8, 0.3, 8), stoneDark, x, y + 0.05, z);
      solids.push({ kind: 'cyl', x, z, r: 0.75, y0: -50, y1: y + h - 0.2, on: true });
    });

    // --- spire on the mountain top ---
    const spire = layout.spire;
    const rock = lambert(0x8c8781);
    const rockPale = lambert(0xb5afa6);
    const columnH = spire.top - spire.base + 2;
    add(scene, new THREE.CylinderGeometry(Island.SPIRE.columnRadius - 0.2, Island.SPIRE.columnRadius + 0.5, columnH, 7), rock, spire.x, spire.top - columnH / 2, spire.z);
    solids.push({ kind: 'cyl', x: spire.x, z: spire.z, r: Island.SPIRE.columnRadius, y0: -50, y1: spire.top, on: true });
    spire.steps.forEach((s, i) => {
      add(scene, new THREE.CylinderGeometry(s.r, s.r - 0.3, 0.6, 6), i % 2 ? rockPale : rock, s.x, s.top - 0.3, s.z).rotation.y = i * 0.5;
      // A rough prop under each step so it reads as part of the spire.
      const prop = add(scene, new THREE.BoxGeometry(0.5, 0.5, 1.8), rock, (s.x + spire.x) / 2, s.top - 0.45, (s.z + spire.z) / 2);
      prop.rotation.y = Math.atan2(s.x - spire.x, s.z - spire.z);
      solids.push({ kind: 'cyl', x: s.x, z: s.z, r: s.r, y0: s.top - 0.6, y1: s.top, on: true });
    });

    // --- stepping stones, islet and chest ---
    layout.stones.forEach((s, i) => {
      add(scene, new THREE.CylinderGeometry(s.r, s.r + 0.3, 2.4, 7), i % 2 ? rockPale : rock, s.x, s.top - 1.2, s.z).rotation.y = i;
      solids.push({ kind: 'cyl', x: s.x, z: s.z, r: s.r, y0: -50, y1: s.top, on: true });
    });
    const C = P.islet;
    const groundC = heightAt(C.x, C.z);
    const chest = new THREE.Group();
    chest.position.set(C.x, groundC, C.z);
    chest.rotation.y = Math.atan2(P.shore.x - C.x, P.shore.z - C.z);
    const gold = lambert(0xe2b23a, { emissive: 0x3d2a00 });
    add(chest, new THREE.BoxGeometry(1.3, 0.6, 0.85), wood, 0, 0.3, 0);
    add(chest, new THREE.BoxGeometry(1.36, 0.1, 0.9), gold, 0, 0.6, 0, false);
    const lid = new THREE.Group();
    lid.position.set(0, 0.62, -0.42);
    add(lid, new THREE.BoxGeometry(1.3, 0.34, 0.85), woodDark, 0, 0.17, 0.42);
    add(lid, new THREE.BoxGeometry(0.22, 0.3, 0.1), gold, 0, 0.1, 0.86, false);
    chest.add(lid);
    const keyMesh = BI.Actors.makeKey();
    keyMesh.visible = false;
    chest.add(keyMesh);
    scene.add(chest);
    solids.push({ kind: 'cyl', x: C.x, z: C.z, r: 0.8, y0: -50, y1: groundC + 0.95, on: true });
    let lidTarget = 0;
    let keyPop = -1;
    tickers.push((dt) => {
      lid.rotation.x += (lidTarget - lid.rotation.x) * Math.min(1, dt * 7);
      if (keyPop >= 0) {
        keyPop += dt;
        keyMesh.visible = keyPop < 1.5;
        keyMesh.position.y = 0.9 + Math.min(1.2, keyPop * 1.6);
        keyMesh.rotation.y = keyPop * 6;
        if (keyPop >= 1.5) keyPop = -1;
      }
    });

    // --- sky and light moods ---
    const cA = new THREE.Color(), cB = new THREE.Color();
    const mix = (a, b, k) => cA.setHex(a).lerp(cB.setHex(b), k);
    let beaconLit = false;
    function setMood(m) {
      const i = Math.max(0, Math.min(MOODS.length - 2, Math.floor(m)));
      const k = Math.max(0, Math.min(1, m - i));
      const a = MOODS[i], b = MOODS[i + 1];
      sky.uniforms.top.value.copy(mix(a.top, b.top, k));
      sky.uniforms.horizon.value.copy(mix(a.horizon, b.horizon, k));
      scene.fog.color.copy(sky.uniforms.horizon.value);
      scene.fog.near = lerp(a.fogNear, b.fogNear, k);
      scene.fog.far = lerp(a.fogFar, b.fogFar, k);
      sun.color.copy(mix(a.sun, b.sun, k));
      sun.intensity = lerp(a.sunPower, b.sunPower, k);
      sky.sunDisc.material.color.copy(sun.color);
      hemi.color.copy(mix(a.skyLight, b.skyLight, k));
      hemi.groundColor.copy(mix(a.groundLight, b.groundLight, k));
      hemi.intensity = lerp(a.hemi, b.hemi, k);
      seaMat.color.copy(mix(a.sea, b.sea, k));
      sky.stars.material.opacity = lerp(a.stars, b.stars, k);
      sky.cloudMat.emissive.copy(mix(0x9a9aa8, 0x1a2140, Math.max(0, m - 1)));
      sky.cloudMat.color.copy(mix(0xffffff, 0xffb9a0, Math.min(1, m))).lerp(cB.setHex(0x5a6aa0), Math.max(0, m - 1));
      const elev = lerp(a.elev, b.elev, k);
      const turn = lerp(a.turn, b.turn, k);
      sunDir.set(Math.cos(elev) * Math.sin(turn), Math.sin(elev), Math.cos(elev) * Math.cos(turn));
      sky.sunDisc.scale.setScalar(m > 1.5 ? 0.6 : 1);
    }
    setMood(0);

    // ---------- per-frame update ----------
    function update(dt, time, focus, camera) {
      for (const tick of tickers) tick(dt, time);
      // Keep the shadow box centred on the player.
      sun.target.position.set(focus.x, focus.y, focus.z);
      sun.position.set(focus.x + sunDir.x * 140, focus.y + sunDir.y * 140, focus.z + sunDir.z * 140);
      sky.dome.position.copy(camera.position);
      sky.stars.position.copy(camera.position);
      sky.sunDisc.position.set(camera.position.x + sunDir.x * 840, camera.position.y + sunDir.y * 840, camera.position.z + sunDir.z * 840);
      for (const cloud of sky.clouds) {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x > 460) cloud.position.x = -460;
      }
      if (beaconLit) lampGlow.scale.setScalar(22 + Math.sin(time * 3) * 2);
    }

    return {
      solids,
      update,
      setMood,
      sun,
      lampY,
      spots: {
        door: { x: L.x + doorDir.x * 5.4, z: L.z + doorDir.y * 5.4 },
        keeper: { x: L.x + doorDir.x * 6.6 - doorDir.y * 3.4, z: L.z + doorDir.y * 6.6 + doorDir.x * 3.4 },
        trader: { x: T.x, z: T.z },
        fisher: { x: P.shore.x + 2.2, z: P.shore.z - 1.7 },
        hiker: { x: P.hiker.x, z: P.hiker.z },
        chest: { x: C.x, z: C.z },
        gate: { x: gateX - 1.4, z: V.z },
        tablet: { x: tabletX, z: tabletZ },
        runes,
        signs,
        campfire: { x: fx, z: fz },
        shards: {
          grove: { x: G.x, y: groundG + 2.0, z: G.z },
          peak: { x: spire.x, y: spire.top + 1.4, z: spire.z },
          vault: { x: V.x, y: groundV + 2.1, z: V.z },
          runes: { x: R.x, y: groundR + 1.8, z: R.z },
        },
      },
      setRunes(lit, wrong) {
        runeLit = lit.slice();
        if (wrong) runeFlash = 0.7;
        paintRunes();
      },
      setGate(open, instant) {
        gateTarget = open ? 1 : 0;
        gateSolid.on = !open;
        if (instant || !open) {
          gateDrop = gateTarget;
          gate.position.y = groundV - gateDrop * 3.7;
        }
      },
      setChest(open, withKey) {
        lidTarget = open ? -1.9 : 0;
        if (!open) lid.rotation.x = 0;
        if (open && withKey) keyPop = 0;
      },
      setSeal(visible) {
        seal.visible = visible;
      },
      setBeacon(lit) {
        beaconLit = lit;
        beam.visible = lit;
        lampGlow.visible = lit;
        ships.visible = lit;
        lampLight.intensity = lit ? 0.45 : 0;
        lampMat.color.setHex(lit ? 0xfff2b0 : 0x39445a);
      },
    };
  }

  BI.World = { build };
})();
