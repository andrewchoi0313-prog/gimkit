// The shape of Beacon Isle: the height map, the named places, the paths and
// where trees, rocks, coins and gloomlings go. Everything is generated from a
// fixed seed, so the island is the same every time.
// No DOM or 3D code here, so it runs in the browser and under `node --test`.
(function (exports) {
  'use strict';

  const SIZE = 320;            // the height map covers SIZE x SIZE world units
  const CELLS = 160;           // grid cells along each side
  const STEP = SIZE / CELLS;
  const HALF = SIZE / 2;
  const SEED = 20261;

  // Named places. x runs east, z runs south, and north is -z.
  const PLACES = {
    start: { x: 6, z: 95 },
    lighthouse: { x: 52, z: 78 },
    crossroads: { x: -2, z: 44 },
    trader: { x: -24, z: 48 },
    ring: { x: 0, z: 12 },
    forest: { x: -58, z: 2, r: 36 },
    grove: { x: -64, z: -4 },
    vault: { x: 66, z: -8 },
    mountain: { x: 0, z: -62, r: 50, top: 12, height: 22 },
    hiker: { x: 6, z: -17 },
    islet: { x: -98, z: 84 },
    shore: { x: -74, z: 66 },   // where the stepping stones reach the main island
  };

  // Patches of ground that are levelled so buildings and puzzles sit flat.
  const FLATS = [
    { x: 6, z: 95, r: 5, blend: 6, level: 0.8 },      // landing beach
    { x: 52, z: 78, r: 9, blend: 8, level: 6 },       // lighthouse bluff
    { x: 0, z: 12, r: 12, blend: 8, level: 4.6 },     // stone ring
    { x: -24, z: 48, r: 6, blend: 6, level: 4.1 },    // trader's camp
    { x: -64, z: -4, r: 9, blend: 7, level: 4.4 },    // grove clearing
    { x: 66, z: -8, r: 15, blend: 8, level: 5 },      // old vault
    { x: 0, z: -62, r: 11, blend: 5, level: 26.2 },   // mountain top
    { x: -98, z: 84, r: 4, blend: 8, level: 2.2 },    // islet
  ];

  // Dirt paths, as lists of [x, z] points.
  const PATHS = [
    [[6, 92], [4, 70], [-2, 44]],              // beach to crossroads
    [[6, 92], [28, 88], [45, 81]],             // beach to lighthouse
    [[-2, 44], [0, 26]],                       // crossroads to stone ring
    [[-2, 44], [-19, 47]],                     // crossroads to trader
    [[-28, 49], [-50, 58], [-71, 65]],         // trader to the fisher's shore
    [[-11, 10], [-34, 4], [-54, -3]],          // stone ring to the grove
    [[11, 10], [34, 0], [49, -8]],             // stone ring to the vault gate
    [[0, 0], [-3, -20], [0, -40], [0, -51]],   // stone ring to the mountain top
  ];

  const VAULT = { half: 5.6, wall: 1.2, height: 4.4, gateWidth: 3.2 };
  const SPIRE = { steps: 8, rise: 1.2, stepRadius: 1.35, orbit: 3.9, columnRadius: 2.3, turn: 0.7 };

  // ---------- small maths helpers ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(ix, iz) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(SEED, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Smooth value noise in [0, 1].
  function noise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }

  function fbm(x, z, octaves) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x, z) * amp;
      norm += amp;
      amp *= 0.5;
      x = x * 2 + 17.3;
      z = z * 2 + 9.1;
    }
    return sum / norm;
  }

  // Smoothstep from `from` to `to`. Works in either direction.
  function smooth(from, to, v) {
    let t = (v - from) / (to - from);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function dist(ax, az, bx, bz) {
    return Math.hypot(ax - bx, az - bz);
  }

  function distToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  function distToPaths(x, z) {
    let best = Infinity;
    for (const path of PATHS) {
      for (let i = 0; i < path.length - 1; i++) {
        const d = distToSegment(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // ---------- height ----------

  // The height of the ground at any point, before it is sampled onto the grid.
  function rawHeight(x, z) {
    const r = Math.hypot(x, z);
    const coast = r + (fbm(x * 0.013 + 40, z * 0.013 + 40, 3) - 0.5) * 58;
    // Seabed at -6, a beach shelf just above the water, then the inland plain.
    let h = -6 + 6.6 * smooth(128, 100, coast) + 3.8 * smooth(98, 80, coast);
    const inland = smooth(104, 84, coast);
    h += (fbm(x * 0.028, z * 0.028, 4) - 0.5) * 10 * inland;

    const m = PLACES.mountain;
    const rise = smooth(m.r, m.top, dist(x, z, m.x, m.z));
    h += m.height * rise;
    h += (fbm(x * 0.08 + 5, z * 0.08 + 5, 3) - 0.5) * 7 * 4 * rise * (1 - rise);

    h += 9.2 * smooth(15, 4, dist(x, z, PLACES.islet.x, PLACES.islet.z));

    for (const f of FLATS) {
      const k = smooth(f.r + f.blend, f.r, dist(x, z, f.x, f.z));
      if (k > 0) h += (f.level - h) * k;
    }
    return h;
  }

  // Samples the height onto a grid and returns fast lookups that match the
  // triangles the 3D ground is drawn with.
  function buildTerrain() {
    const n = CELLS + 1;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        heights[j * n + i] = rawHeight(i * STEP - HALF, j * STEP - HALF);
      }
    }

    function heightAt(x, z) {
      let gx = (x + HALF) / STEP;
      let gz = (z + HALF) / STEP;
      if (gx < 0) gx = 0; else if (gx > CELLS - 0.0001) gx = CELLS - 0.0001;
      if (gz < 0) gz = 0; else if (gz > CELLS - 0.0001) gz = CELLS - 0.0001;
      const i = Math.floor(gx);
      const j = Math.floor(gz);
      const fx = gx - i;
      const fz = gz - j;
      const h00 = heights[j * n + i];
      const h10 = heights[j * n + i + 1];
      const h01 = heights[(j + 1) * n + i];
      const h11 = heights[(j + 1) * n + i + 1];
      // Each cell is two triangles split along the corner (i+1, j) to (i, j+1).
      if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
      return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }

    return { heights, size: SIZE, cells: CELLS, step: STEP, half: HALF, heightAt };
  }

  // ---------- what kind of ground ----------

  function inForest(x, z) {
    const f = PLACES.forest;
    return dist(x, z, f.x, f.z) < f.r;
  }

  // True where nothing should be scattered: flat building plots and paths.
  function isKeptClear(x, z, margin) {
    for (const f of FLATS) {
      if (dist(x, z, f.x, f.z) < f.r + margin) return true;
    }
    for (const key of ['crossroads', 'hiker', 'shore']) {
      if (dist(x, z, PLACES[key].x, PLACES[key].z) < 4 + margin) return true;
    }
    return distToPaths(x, z) < 2.4 + margin;
  }

  // ---------- layout ----------

  // The stepping stones cross the water between the islet and the shore.
  function steppingStones(heightAt) {
    const a = PLACES.islet;
    const b = PLACES.shore;
    const len = dist(a.x, a.z, b.x, b.z);
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    let from = -1;
    let to = -1;
    for (let t = 0; t <= len; t += 0.25) {
      const wet = heightAt(a.x + dx * t, a.z + dz * t) < 0.3;
      if (wet && from < 0) from = t;
      if (wet) to = t;
    }
    const stones = [];
    if (from < 0) return stones;
    const span = to - from;
    const count = Math.max(1, Math.round(span / 3.3));
    for (let k = 0; k < count; k++) {
      const t = from + (k + 0.5) * (span / count);
      stones.push({ x: a.x + dx * t, z: a.z + dz * t, r: 1.2, top: 0.5 });
    }
    return stones;
  }

  // The steps that spiral up the spire on the mountain top.
  function spireSteps() {
    const m = PLACES.mountain;
    const base = FLATS[6].level;
    const steps = [];
    for (let k = 1; k <= SPIRE.steps; k++) {
      const angle = 1.2 + k * SPIRE.turn;
      steps.push({
        x: m.x + Math.cos(angle) * SPIRE.orbit,
        z: m.z + Math.sin(angle) * SPIRE.orbit,
        r: SPIRE.stepRadius,
        top: base + k * SPIRE.rise,
      });
    }
    return { x: m.x, z: m.z, base, top: base + (SPIRE.steps + 1) * SPIRE.rise, steps };
  }

  function buildLayout(terrain) {
    const heightAt = terrain.heightAt;
    const rng = mulberry32(SEED);
    const trees = [];
    const rocks = [];
    const tufts = [];

    function farFromTrees(x, z, min) {
      for (const t of trees) {
        if (Math.abs(t.x - x) < min && Math.abs(t.z - z) < min && dist(x, z, t.x, t.z) < min) return false;
      }
      return true;
    }

    function tryTree(x, z, min, pineChance) {
      const h = heightAt(x, z);
      if (h < 1.6 || h > 16) return;
      if (isKeptClear(x, z, 2.2)) return;
      if (!farFromTrees(x, z, min)) return;
      trees.push({
        x, z, y: h,
        scale: 0.8 + rng() * 0.7,
        type: rng() < pineChance ? 'pine' : 'round',
        tint: rng(),
        turn: rng() * Math.PI * 2,
      });
    }

    // Whisperwood: packed close together.
    const f = PLACES.forest;
    for (let i = 0; i < 1100 && trees.length < 190; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * f.r;
      tryTree(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r, 3.6, 0.7);
    }
    // Scattered trees everywhere else.
    for (let i = 0; i < 900 && trees.length < 270; i++) {
      const x = (rng() * 2 - 1) * 118;
      const z = (rng() * 2 - 1) * 118;
      if (inForest(x, z)) continue;
      tryTree(x, z, 6, heightAt(x, z) > 8 ? 0.9 : 0.3);
    }

    // Rocks: a few everywhere, more on the mountain.
    const m = PLACES.mountain;
    for (let i = 0; i < 520 && rocks.length < 95; i++) {
      const onMountain = i % 2 === 0;
      const x = onMountain ? m.x + (rng() * 2 - 1) * m.r : (rng() * 2 - 1) * 120;
      const z = onMountain ? m.z + (rng() * 2 - 1) * m.r : (rng() * 2 - 1) * 120;
      const h = heightAt(x, z);
      if (h < 0.4) continue;
      if (isKeptClear(x, z, 2.4)) continue;
      if (!farFromTrees(x, z, 2.6)) continue;
      const scale = 0.45 + rng() * rng() * 1.5;
      rocks.push({ x, z, y: h, scale, turn: rng() * Math.PI * 2, squash: 0.55 + rng() * 0.4 });
    }

    // Flowers and grass tufts. Decoration only.
    for (let i = 0; i < 2400 && tufts.length < 620; i++) {
      const x = (rng() * 2 - 1) * 112;
      const z = (rng() * 2 - 1) * 112;
      const h = heightAt(x, z);
      if (h < 1.5 || h > 11) continue;
      if (distToPaths(x, z) < 1.6) continue;
      tufts.push({ x, z, y: h, kind: Math.floor(rng() * 4), scale: 0.7 + rng() * 0.6, turn: rng() * Math.PI });
    }

    // Coins: a trail along every path, plus a few rewards off the beaten track.
    const coins = [];
    function coin(x, z, y) {
      coins.push({ id: 'coin-' + coins.length, x, z, y: (y === undefined ? heightAt(x, z) : y) + 1 });
    }
    for (const path of PATHS) {
      let next = 7;
      let walked = 0;
      let placed = 0;
      for (let i = 0; i < path.length - 1 && placed < 6; i++) {
        const [ax, az] = path[i];
        const [bx, bz] = path[i + 1];
        const seg = dist(ax, az, bx, bz);
        while (next <= walked + seg && placed < 6) {
          const t = (next - walked) / seg;
          coin(ax + (bx - ax) * t, az + (bz - az) * t);
          next += 6.5;
          placed++;
        }
        walked += seg;
      }
    }
    const stones = steppingStones(heightAt);
    stones.forEach((s, i) => { if (i % 2 === 0) coin(s.x, s.z, s.top); });
    const spire = spireSteps();
    spire.steps.forEach((s, i) => { if (i % 2 === 1) coin(s.x, s.z, s.top); });
    const v = PLACES.vault;
    [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(([dx, dz]) => coin(v.x + dx, v.z + dz));
    [[-101, 86], [-96, 87], [14, 99], [-2, 98], [58, 84], [-40, -30], [40, 36], [-30, 78]]
      .forEach(([x, z]) => { if (heightAt(x, z) > 0.3) coin(x, z); });

    const hearts = [
      { id: 'heart-0', x: 3, z: 30 },
      { id: 'heart-1', x: 42, z: 2 },
      { id: 'heart-2', x: -46, z: -9 },
      { id: 'heart-3', x: 8, z: -58 },
    ].map((h) => Object.assign(h, { y: heightAt(h.x, h.z) + 1 }));

    // Gloomlings. The four in the grove guard a shard.
    const g = PLACES.grove;
    const gloomlings = [
      { x: g.x + 5, z: g.z + 1, group: 'grove' },
      { x: g.x - 4, z: g.z + 4, group: 'grove' },
      { x: g.x - 3, z: g.z - 5, group: 'grove' },
      { x: g.x + 2, z: g.z - 4, group: 'grove' },
      { x: -34, z: 9, group: 'path' },
      { x: 43, z: -12, group: 'vault' },
      { x: 47, z: -2, group: 'vault' },
      { x: 40, z: 3, group: 'vault' },
      { x: -7, z: -33, group: 'mountain' },
      { x: 6, z: -44, group: 'mountain' },
      { x: -52, z: 54, group: 'shore' },
    ].map((e, i) => Object.assign(e, { id: 'gloom-' + i, y: heightAt(e.x, e.z) }));

    return { trees, rocks, tufts, coins, hearts, gloomlings, stones, spire };
  }

  Object.assign(exports, {
    SIZE, CELLS, STEP, HALF, PLACES, FLATS, PATHS, VAULT, SPIRE,
    mulberry32, noise, fbm, smooth, dist, distToPaths,
    rawHeight, buildTerrain, buildLayout, inForest, isKeptClear, steppingStones, spireSteps,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.BI = window.BI || {}).Island = {}));
