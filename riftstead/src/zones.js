// The lands of Riftstead: the big overworld and the three dimensions behind
// the portals. Each one is a "zone" with its own ground shape, places,
// portals, plants and monster dens. Everything comes from fixed seeds, so the
// world is the same every time.
// No DOM or 3D code here, so it runs in the browser and under `node --test`.
(function (exports) {
  'use strict';

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

  function hash2(ix, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Smooth value noise in [0, 1].
  function noise(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }

  function fbm(x, z, octaves, seed) {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x, z, seed + i) * amp;
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

  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  function distToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  function distToPaths(paths, x, z) {
    let best = Infinity;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const d = distToSegment(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // ---------- creatures ----------
  // body: blob (hops), brute (walks and swings), wisp (flies and dives).
  // luck multiplies the chance of a weapon drop.
  const SPECIES = {
    mossling: { body: 'blob', name: 'Mossling', color: 0x6fae4a, hp: 3, dmg: 1, speed: 1, luck: 1, scale: 1 },
    sandling: { body: 'blob', name: 'Sandling', color: 0xd7ae62, hp: 3, dmg: 1, speed: 1.3, luck: 1, scale: 0.9 },
    bogling: { body: 'blob', name: 'Bogling', color: 0x4c7d63, hp: 4, dmg: 1, speed: 0.9, luck: 1, scale: 1.1 },
    frostling: { body: 'blob', name: 'Frostling', color: 0xcfe6f5, hp: 4, dmg: 1, speed: 1, luck: 1, scale: 1 },
    thornback: { body: 'brute', name: 'Thornback', color: 0x5d7d3c, hp: 7, dmg: 1, speed: 1, luck: 1.6, scale: 1.25 },
    dunebrute: { body: 'brute', name: 'Dune brute', color: 0xbb8648, hp: 8, dmg: 1, speed: 1, luck: 1.6, scale: 1.3 },
    nightwisp: { body: 'wisp', name: 'Night wisp', color: 0x8a7cf0, hp: 3, dmg: 1, speed: 1, luck: 1.6, scale: 1 },
    cinderling: { body: 'blob', name: 'Cinderling', color: 0xff7a2a, hp: 5, dmg: 1, speed: 1.2, luck: 2.2, scale: 1, glow: true },
    magmabrute: { body: 'brute', name: 'Magma brute', color: 0x8c2f1c, hp: 11, dmg: 2, speed: 1, luck: 2.6, scale: 1.4, glow: true },
    rimewisp: { body: 'wisp', name: 'Rime wisp', color: 0x9fe0ff, hp: 5, dmg: 1, speed: 1.1, luck: 2.2, scale: 1.1 },
    icebrute: { body: 'brute', name: 'Ice brute', color: 0x7fb6d9, hp: 11, dmg: 2, speed: 0.9, luck: 2.6, scale: 1.4 },
    galewisp: { body: 'wisp', name: 'Gale wisp', color: 0xffe9a0, hp: 5, dmg: 1, speed: 1.25, luck: 2.2, scale: 1.1 },
    puffling: { body: 'blob', name: 'Puffling', color: 0xf4f7ff, hp: 5, dmg: 1, speed: 1.1, luck: 2.2, scale: 1 },
    warden: { body: 'brute', name: 'Crystal warden', color: 0x5b4a8c, hp: 16, dmg: 2, speed: 1.1, luck: 5, scale: 1.8, glow: true },
    shade: { body: 'blob', name: 'Shade', color: 0x3d2c61, hp: 4, dmg: 1, speed: 1.2, luck: 0.6, scale: 1 },
  };

  // ---------- the overworld ----------

  const RADIUS = 232; // roughly where the overworld's coast runs

  const OVERWORLD = {
    id: 'overworld',
    name: 'The Stead',
    size: 640,
    cells: 256,
    gravity: 24,
    liquid: 'water',
    // Fall this low and you are carried back to where you last stood.
    hazard: { level: -1.3, damage: 0, text: 'The current is too strong out there.' },
    places: {
      home: { x: 0, z: 120 },
      start: { x: 0, z: 129 },
      wren: { x: 7, z: 116 },
      crossroads: { x: 0, z: 40 },
      fortress: { x: 135, z: -135 },
    },
    portals: [
      { id: 'toEmber', x: 176, z: 45, face: -Math.PI / 2, to: 'ember', color: 0xff6a2a },
      { id: 'toFrost', x: -24, z: -166, face: 0, to: 'frost', color: 0x9fe0ff },
      { id: 'toCloud', x: -166, z: -16, face: Math.PI / 2, to: 'cloud', color: 0xfff2a8 },
    ],
    fortress: { x: 135, z: -135, half: 21, wall: 2.5, height: 8, gate: 6 },
    flats: [
      { x: 0, z: 120, r: 27, blend: 12, level: 4 },      // the homestead plot: a whole number, so blocks sit flush
      { x: 0, z: 40, r: 7, blend: 8, level: 5 },
      { x: 176, z: 45, r: 9, blend: 9, level: 6 },
      { x: -24, z: -166, r: 9, blend: 12, level: 24 },
      { x: -166, z: -16, r: 9, blend: 14, level: 14 },   // Windy Tor
      { x: 135, z: -135, r: 34, blend: 14, level: 9 },
    ],
    paths: [
      [[0, 112], [0, 40]],
      [[0, 40], [-60, 30], [-120, 4], [-158, -14]],
      [[0, 40], [70, 46], [130, 48], [168, 45]],
      [[0, 40], [-6, -30], [-16, -100], [-24, -158]],
      [[-6, -30], [60, -68], [122, -90], [135, -108]],
    ],
  };

  // Each biome pulls the ground towards its own shape. The nearest anchor wins.
  const ANCHORS = [
    ['meadow', 0, 112], ['meadow', 8, 28], ['meadow', 78, -34],
    ['forest', -150, -22], ['forest', -112, 66],
    ['desert', 172, 46], ['desert', 126, 134],
    ['snow', -30, -172], ['snow', -112, -128],
    ['swamp', -116, 166], ['swamp', -22, 204],
    ['blight', 135, -135],
  ];
  const BIOME_NAMES = ['meadow', 'forest', 'desert', 'snow', 'swamp', 'blight'];

  function biomeWeights(x, z) {
    const wx = x + (fbm(x * 0.008 + 3, z * 0.008 + 7, 2, 21) - 0.5) * 90;
    const wz = z + (fbm(x * 0.008 + 31, z * 0.008 + 17, 2, 22) - 0.5) * 90;
    const w = { meadow: 0, forest: 0, desert: 0, snow: 0, swamp: 0, blight: 0 };
    let sum = 0;
    for (const a of ANCHORS) {
      const d2 = (wx - a[1]) * (wx - a[1]) + (wz - a[2]) * (wz - a[2]) + 80;
      const v = 1 / (d2 * d2);
      w[a[0]] += v;
      sum += v;
    }
    for (const name of BIOME_NAMES) w[name] /= sum;
    return w;
  }

  function overworldBiome(x, z) {
    const w = biomeWeights(x, z);
    let best = 'meadow';
    for (const name of BIOME_NAMES) if (w[name] > w[best]) best = name;
    return best;
  }

  function applyFlats(flats, x, z, h) {
    for (const f of flats) {
      const k = smooth(f.r + f.blend, f.r, dist(x, z, f.x, f.z));
      if (k > 0) h += (f.level - h) * k;
    }
    return h;
  }

  function overworldHeight(x, z) {
    const coast = Math.hypot(x, z) + (fbm(x * 0.006 + 40, z * 0.006 + 40, 3, 11) - 0.5) * 110;
    const land = smooth(RADIUS + 24, RADIUS - 6, coast);    // seabed up to the beach shelf
    const inland = smooth(RADIUS - 8, RADIUS - 42, coast);  // beach up to the biome's own height
    const w = biomeWeights(x, z);
    const n1 = fbm(x * 0.012, z * 0.012, 4, 12);
    const n2 = fbm(x * 0.035, z * 0.035, 3, 13);
    const ridge = Math.abs(n2 - 0.5) * 2;
    const shape = w.meadow * (4 + (n1 - 0.5) * 7)
      + w.forest * (5.5 + (n1 - 0.5) * 11)
      + w.desert * (3.2 + ridge * 7)
      + w.snow * (7 + n1 * 30)
      + w.swamp * (0.75 + (n2 - 0.5) * 3.4)
      + w.blight * (7 + ridge * 8);
    const h = -6 + 6.6 * land + inland * (shape - 0.6);
    return applyFlats(OVERWORLD.flats, x, z, h);
  }

  // ---------- Ember Deep ----------

  const EMBER = {
    id: 'ember',
    name: 'Ember Deep',
    size: 280,
    cells: 140,
    gravity: 24,
    liquid: 'lava',
    hazard: { level: 0.12, damage: 1, text: 'Lava! Build a bridge or hop the stones.' },
    places: { start: { x: 0, z: 84 }, crystal: { x: 0, z: -76 } },
    portals: [{ id: 'fromEmber', x: 0, z: 92, face: Math.PI, to: 'overworld', color: 0x7fe3a0 }],
    flats: [{ x: 0, z: 88, r: 10, blend: 8, level: 4 }],
    paths: [[[0, 80], [10, 30], [-8, -20], [0, -58]]],
  };

  function emberHeight(x, z) {
    const edge = Math.hypot(x, z) + (fbm(x * 0.012, z * 0.012, 3, 31) - 0.5) * 40;
    const land = smooth(116, 92, edge);
    const ridge = Math.abs(fbm(x * 0.03, z * 0.03, 4, 32) - 0.5) * 2;
    let h = -5 + land * (7.5 + ridge * 13);
    // Rivers of lava wind across the rock.
    const river = 1 - smooth(0.012, 0.05, Math.abs(fbm(x * 0.018 + 9, z * 0.018 + 4, 3, 33) - 0.5));
    h += (-1.6 - h) * river * land;
    // The crystal stands on a mound inside a ring of lava.
    const d = dist(x, z, EMBER.places.crystal.x, EMBER.places.crystal.z);
    h += (-1.8 - h) * smooth(20, 16, d) * (1 - smooth(9.5, 7, d));
    h += (4 - h) * smooth(9, 6.5, d);
    return applyFlats(EMBER.flats, x, z, h);
  }

  // ---------- Frost Hollow ----------

  const FROST = {
    id: 'frost',
    name: 'Frost Hollow',
    size: 280,
    cells: 140,
    gravity: 24,
    liquid: 'none',
    hazard: null,
    // The mountains ring the hollow; nobody walks further out than this.
    wall: { r: 110, text: 'The blizzard is too thick to climb any higher.' },
    places: { start: { x: 0, z: 78 }, crystal: { x: 0, z: -10 }, lake: { x: 0, z: -8, r: 36 } },
    portals: [{ id: 'fromFrost', x: 0, z: 86, face: Math.PI, to: 'overworld', color: 0x7fe3a0 }],
    flats: [{ x: 0, z: 82, r: 10, blend: 9, level: 3 }],
    paths: [[[0, 74], [-6, 40]]],
  };

  // 1 in the middle of the frozen lake, 0 away from it.
  function frostLake(x, z) {
    const L = FROST.places.lake;
    return smooth(L.r + 6, L.r - 4, dist(x, z, L.x, L.z) + (fbm(x * 0.04, z * 0.04, 2, 53) - 0.5) * 14);
  }

  function frostHeight(x, z) {
    const rim = smooth(80, 122, Math.hypot(x, z) + (fbm(x * 0.012, z * 0.012, 2, 51) - 0.5) * 24);
    let h = 2.4 + (fbm(x * 0.03, z * 0.03, 4, 52) - 0.5) * 6 + rim * 46;
    h += (0.06 - h) * frostLake(x, z);
    return applyFlats(FROST.flats, x, z, h);
  }

  // ---------- Cloud Garden ----------

  const CLOUD = {
    id: 'cloud',
    name: 'Cloud Garden',
    size: 320,
    cells: 0, // no ground at all: only floating islands
    gravity: 13,
    liquid: 'cloud',
    hazard: { level: -9, damage: 0, text: 'A gust carries you back up.' },
    places: { start: { x: 0, z: 96 } },
    portals: [{ id: 'fromCloud', x: 0, z: 103, face: Math.PI, to: 'overworld', color: 0x7fe3a0 }],
    flats: [],
    paths: [],
  };

  // A chain of islands from the portal to the crystal, with a few off to the side.
  function cloudIslands() {
    const rng = mulberry32(71);
    const list = [];
    let x = 0, z = 96, r = 14, top = 0;
    list.push({ x, z, r, top, main: true });
    for (let i = 0; i < 7; i++) {
      const nr = 7.5 + rng() * 4.5;
      const gap = 4 + rng() * 2;
      const turn = (rng() - 0.5) * 1.2 - x * 0.012; // wander, but drift back to the middle
      const stride = r + nr + gap;
      x += Math.sin(turn) * stride;
      z -= Math.cos(turn) * stride;
      top += (rng() - 0.4) * 3;
      r = nr;
      list.push({ x, z, r, top, main: true });
    }
    const last = { x, z: z - (r + 15 + 5), r: 15, top: top + 1.2, main: true, crystal: true };
    list.push(last);
    const mains = list.slice(1, 8);
    for (let i = 0; i < 6; i++) {
      const base = mains[i + (i > 3 ? 1 : 0)];
      const side = i % 2 === 0 ? 1 : -1;
      const sr = 6 + rng() * 5;
      const gap = 4 + rng() * 2;
      list.push({ x: base.x + side * (base.r + sr + gap), z: base.z + (rng() - 0.5) * 8, r: sr, top: base.top + (rng() - 0.5) * 3, main: false });
    }
    return list;
  }

  // ---------- building a zone ----------

  const DEFS = { overworld: OVERWORLD, ember: EMBER, frost: FROST, cloud: CLOUD };
  const HEIGHTS = { overworld: overworldHeight, ember: emberHeight, frost: frostHeight };

  // Samples a height function onto a grid and returns a lookup that matches
  // the triangles the 3D ground is drawn with.
  function buildTerrain(def, rawHeight) {
    const cells = def.cells, size = def.size, step = size / cells, half = size / 2;
    const n = cells + 1;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = rawHeight(i * step - half, j * step - half);
    }
    function heightAt(x, z) {
      let gx = (x + half) / step, gz = (z + half) / step;
      if (gx < 0) gx = 0; else if (gx > cells - 0.0001) gx = cells - 0.0001;
      if (gz < 0) gz = 0; else if (gz > cells - 0.0001) gz = cells - 0.0001;
      const i = Math.floor(gx), j = Math.floor(gz);
      const fx = gx - i, fz = gz - j;
      const h00 = heights[j * n + i], h10 = heights[j * n + i + 1];
      const h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
      // Each cell is two triangles split along the corner (i+1, j) to (i, j+1).
      if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
      return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }
    return { heights, size, cells, step, half, heightAt };
  }

  // Round stepping stones wherever the line from a to b crosses liquid.
  function steppingStones(heightAt, a, b, top) {
    const len = dist(a.x, a.z, b.x, b.z);
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    const stones = [];
    let from = -1;
    for (let t = 0; t <= len + 0.25; t += 0.25) {
      const wet = t <= len && heightAt(a.x + dx * t, a.z + dz * t) < 0.35;
      if (wet && from < 0) from = t;
      if (!wet && from >= 0) {
        const span = t - from;
        const count = Math.max(1, Math.round(span / 3.3));
        for (let k = 0; k < count; k++) {
          const s = from + (k + 0.5) * (span / count);
          stones.push({ x: a.x + dx * s, z: a.z + dz * s, r: 1.25, top });
        }
        from = -1;
      }
    }
    return stones;
  }

  function nearFlat(def, x, z, margin) {
    for (const f of def.flats) if (dist(x, z, f.x, f.z) < f.r + margin) return true;
    return false;
  }

  function overworldLayout(def, heightAt) {
    const rng = mulberry32(4177);
    const trees = [], rocks = [], tufts = [], spawns = [];
    const reach = RADIUS + 8;
    const far = (list, x, z, min) => {
      for (const t of list) if (Math.abs(t.x - x) < min && Math.abs(t.z - z) < min && dist(x, z, t.x, t.z) < min) return false;
      return true;
    };
    const clear = (x, z, margin) => nearFlat(def, x, z, margin) || distToPaths(def.paths, x, z) < 2.6 + margin;

    const growth = {
      meadow: { chance: 0.05, min: 7, kinds: ['round', 'round', 'pine'] },
      forest: { chance: 0.8, min: 4, kinds: ['pine', 'pine', 'round'] },
      desert: { chance: 0.07, min: 8, kinds: ['cactus'] },
      snow: { chance: 0.2, min: 6, kinds: ['snowpine'] },
      swamp: { chance: 0.32, min: 5, kinds: ['dead', 'round', 'dead'] },
      blight: { chance: 0.22, min: 6, kinds: ['dead'] },
    };
    for (let i = 0; i < 16000 && trees.length < 980; i++) {
      const x = (rng() * 2 - 1) * reach, z = (rng() * 2 - 1) * reach;
      const h = heightAt(x, z);
      if (h < 0.9 || h > 30) continue;
      const biome = overworldBiome(x, z);
      const g = growth[biome];
      if (rng() > g.chance || (h < 1.5 && biome !== 'swamp') || clear(x, z, 2.2) || !far(trees, x, z, g.min)) continue;
      trees.push({ x, z, y: h, biome, type: g.kinds[Math.floor(rng() * g.kinds.length)], scale: 0.8 + rng() * 0.7, tint: rng(), turn: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 2600 && rocks.length < 300; i++) {
      const x = (rng() * 2 - 1) * reach, z = (rng() * 2 - 1) * reach;
      const h = heightAt(x, z);
      if (h < 0.4 || clear(x, z, 2.4) || !far(trees, x, z, 2.6)) continue;
      rocks.push({ x, z, y: h, biome: overworldBiome(x, z), scale: 0.45 + rng() * rng() * 1.7, turn: rng() * Math.PI * 2, squash: 0.55 + rng() * 0.4 });
    }
    for (let i = 0; i < 9000 && tufts.length < 2200; i++) {
      const x = (rng() * 2 - 1) * reach, z = (rng() * 2 - 1) * reach;
      const h = heightAt(x, z);
      const biome = overworldBiome(x, z);
      if (h < 1.3 || biome === 'snow' || biome === 'blight' || (biome === 'desert' && rng() > 0.15)) continue;
      if (distToPaths(def.paths, x, z) < 1.6) continue;
      tufts.push({ x, z, y: h, biome, kind: Math.floor(rng() * 4), scale: 0.7 + rng() * 0.6, turn: rng() * Math.PI });
    }

    // Monster dens. Half of them only wake at night.
    const dayKinds = {
      meadow: ['mossling'], forest: ['mossling', 'thornback', 'mossling'], desert: ['sandling', 'sandling', 'dunebrute'],
      snow: ['frostling'], swamp: ['bogling', 'bogling', 'thornback'], blight: ['thornback', 'bogling'],
    };
    const nightKinds = {
      meadow: ['nightwisp', 'mossling'], forest: ['nightwisp', 'thornback'], desert: ['dunebrute', 'nightwisp'],
      snow: ['nightwisp', 'frostling'], swamp: ['nightwisp', 'bogling'], blight: ['nightwisp', 'thornback'],
    };
    const home = def.places.home, fort = def.fortress;
    function den(night, count, keepFromHome) {
      for (let i = 0, made = 0; i < 4000 && made < count; i++) {
        const x = (rng() * 2 - 1) * (RADIUS - 14), z = (rng() * 2 - 1) * (RADIUS - 14);
        if (heightAt(x, z) < 1.3 || dist(x, z, home.x, home.z) < keepFromHome || dist(x, z, fort.x, fort.z) < 46) continue;
        if (nearFlat(def, x, z, 6) || !far(spawns, x, z, 20)) continue;
        const kinds = (night ? nightKinds : dayKinds)[overworldBiome(x, z)];
        spawns.push({ id: (night ? 'n' : 'd') + made, x, z, species: kinds[Math.floor(rng() * kinds.length)], night });
        made++;
      }
    }
    den(false, 44, 70);
    den(true, 40, 34);
    return { trees, rocks, tufts, spawns, stones: [], islands: [], crystal: null };
  }

  function emberLayout(def, heightAt) {
    const rng = mulberry32(3101);
    const rocks = [], spawns = [];
    const c = def.places.crystal, s = def.places.start;
    for (let i = 0; i < 1600 && rocks.length < 130; i++) {
      const x = (rng() * 2 - 1) * 112, z = (rng() * 2 - 1) * 112;
      const h = heightAt(x, z);
      if (h < 0.6 || nearFlat(def, x, z, 3) || dist(x, z, c.x, c.z) < 22 || distToPaths(def.paths, x, z) < 3) continue;
      rocks.push({ x, z, y: h, biome: 'ember', scale: 0.6 + rng() * rng() * 2.6, turn: rng() * 6.28, squash: 0.7 + rng() * 0.9 });
    }
    for (let i = 0, made = 0; i < 3000 && made < 13; i++) {
      const x = (rng() * 2 - 1) * 100, z = (rng() * 2 - 1) * 100;
      if (heightAt(x, z) < 1.2 || dist(x, z, s.x, s.z) < 30 || dist(x, z, c.x, c.z) < 24) continue;
      if (spawns.some((p) => dist(x, z, p.x, p.z) < 18)) continue;
      spawns.push({ id: 'e' + made, x, z, species: made % 3 === 2 ? 'magmabrute' : 'cinderling', night: false });
      made++;
    }
    spawns.push({ id: 'warden', x: c.x + 3, z: c.z + 3, species: 'warden', night: false, tint: 0xa8331c });
    // Stones across every lava channel on the way to the crystal.
    const stones = [];
    const path = def.paths[0].map(([x, z]) => ({ x, z })).concat([{ x: c.x, z: c.z + 5 }]);
    for (let i = 0; i < path.length - 1; i++) stones.push(...steppingStones(heightAt, path[i], path[i + 1], 0.55));
    return { trees: [], rocks, tufts: [], spawns, stones, islands: [], crystal: { x: c.x, z: c.z, y: heightAt(c.x, c.z) + 2 } };
  }

  function frostLayout(def, heightAt) {
    const rng = mulberry32(5103);
    const trees = [], rocks = [], spawns = [];
    const c = def.places.crystal, s = def.places.start;
    for (let i = 0; i < 2600 && trees.length < 150; i++) {
      const x = (rng() * 2 - 1) * 105, z = (rng() * 2 - 1) * 105;
      const h = heightAt(x, z);
      if (h < 1 || h > 22 || frostLake(x, z) > 0.02 || nearFlat(def, x, z, 3) || distToPaths(def.paths, x, z) < 3) continue;
      if (trees.some((t) => dist(x, z, t.x, t.z) < 5)) continue;
      trees.push({ x, z, y: h, biome: 'snow', type: 'snowpine', scale: 0.8 + rng() * 0.8, tint: rng(), turn: rng() * 6.28 });
    }
    for (let i = 0; i < 900 && rocks.length < 70; i++) {
      const x = (rng() * 2 - 1) * 100, z = (rng() * 2 - 1) * 100;
      const h = heightAt(x, z);
      if (h < 0.5 || h > 26 || frostLake(x, z) > 0.02 || nearFlat(def, x, z, 3)) continue;
      rocks.push({ x, z, y: h, biome: 'frost', scale: 0.6 + rng() * rng() * 2, turn: rng() * 6.28, squash: 0.8 + rng() * 1.2 });
    }
    for (let i = 0, made = 0; i < 3000 && made < 12; i++) {
      const x = (rng() * 2 - 1) * 78, z = (rng() * 2 - 1) * 78;
      const h = heightAt(x, z);
      if (h < 0 || h > 14 || dist(x, z, s.x, s.z) < 30 || dist(x, z, c.x, c.z) < 14) continue;
      if (spawns.some((p) => dist(x, z, p.x, p.z) < 17)) continue;
      spawns.push({ id: 'f' + made, x, z, species: made % 3 === 0 ? 'icebrute' : 'rimewisp', night: false });
      made++;
    }
    spawns.push({ id: 'warden', x: c.x + 7, z: c.z + 6, species: 'warden', night: false, tint: 0x4f8fc4 });
    // The crystal stands on an ice pillar in the lake. Two lower pillars make a stair.
    const stones = [
      { x: c.x, z: c.z, r: 2.4, top: 3.6, ice: true },
      { x: c.x + 4.3, z: c.z + 1.2, r: 1.7, top: 2.4, ice: true },
      { x: c.x + 6.6, z: c.z + 4.6, r: 1.7, top: 1.25, ice: true },
    ];
    return { trees, rocks, tufts: [], spawns, stones, islands: [], crystal: { x: c.x, z: c.z, y: 3.6 + 1.9 } };
  }

  function cloudLayout() {
    const rng = mulberry32(7105);
    const islands = cloudIslands();
    const trees = [], tufts = [], spawns = [];
    islands.forEach((isle, n) => {
      const plants = Math.floor(isle.r * isle.r / 28);
      for (let i = 0; i < plants * 6; i++) {
        const a = rng() * 6.28, d = Math.sqrt(rng()) * (isle.r - 1.2);
        const x = isle.x + Math.cos(a) * d, z = isle.z + Math.sin(a) * d;
        if (i < plants && n > 0 && d > 3 && !trees.some((t) => dist(x, z, t.x, t.z) < 4)) {
          trees.push({ x, z, y: isle.top, biome: 'cloud', type: 'round', scale: 0.7 + rng() * 0.5, tint: rng(), turn: a });
        } else {
          tufts.push({ x, z, y: isle.top, biome: 'cloud', kind: Math.floor(rng() * 4), scale: 0.7 + rng() * 0.6, turn: a });
        }
      }
      if (n >= 2 && !isle.crystal) {
        spawns.push({ id: 'c' + n, x: isle.x + 1.5, z: isle.z - 1, species: n % 2 === 0 ? 'galewisp' : 'puffling', night: false });
      }
    });
    const last = islands.find((i) => i.crystal);
    spawns.push({ id: 'warden', x: last.x + 4, z: last.z + 4, species: 'warden', night: false, tint: 0xd9a531 });
    return { trees, rocks: [], tufts, spawns, stones: [], islands, crystal: { x: last.x, z: last.z - 3, y: last.top + 2.4 } };
  }

  // Builds everything the game needs to know about one zone.
  function buildZone(id) {
    const def = DEFS[id];
    if (id === 'cloud') {
      const layout = cloudLayout();
      return { def, terrain: null, heightAt: () => -300, biomeAt: () => 'cloud', layout };
    }
    const terrain = buildTerrain(def, HEIGHTS[id]);
    const heightAt = terrain.heightAt;
    let biomeAt, layout;
    if (id === 'overworld') {
      biomeAt = overworldBiome;
      layout = overworldLayout(def, heightAt);
    } else if (id === 'ember') {
      biomeAt = () => 'ember';
      layout = emberLayout(def, heightAt);
    } else {
      biomeAt = (x, z) => (frostLake(x, z) > 0.5 ? 'ice' : 'frost');
      layout = frostLayout(def, heightAt);
    }
    return { def, terrain, heightAt, biomeAt, layout };
  }

  Object.assign(exports, {
    RADIUS, DEFS, SPECIES, ANCHORS,
    mulberry32, noise, fbm, smooth, dist, distToPaths,
    overworldHeight, overworldBiome, emberHeight, frostHeight, frostLake, cloudIslands,
    buildTerrain, buildZone, steppingStones,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.RS = window.RS || {}).Zones = {}));
