// The world of Wildshore: seven islands in an open sea, about ten times the
// land of Riftstead. This file shapes the ground, names the islands and
// decides where trees, wild animals, night monsters and treasure go.
// Everything comes from fixed seeds, so the world is the same every time.
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
  // Monsters (blob, brute, wisp) only come out at night. Animals and fish are
  // always about, never attack, and leave meat.
  const SPECIES = {
    mossling: { body: 'blob', name: 'Mossling', color: 0x6fae4a, hp: 3, dmg: 1, speed: 1, luck: 1, scale: 1 },
    sandling: { body: 'blob', name: 'Sandling', color: 0xd7ae62, hp: 3, dmg: 1, speed: 1.3, luck: 1.2, scale: 0.9 },
    bogling: { body: 'blob', name: 'Bogling', color: 0x4c7d63, hp: 4, dmg: 1, speed: 0.9, luck: 1.2, scale: 1.1 },
    frostling: { body: 'blob', name: 'Frostling', color: 0xcfe6f5, hp: 4, dmg: 1, speed: 1, luck: 1.4, scale: 1 },
    cinderling: { body: 'blob', name: 'Cinderling', color: 0xff7a2a, hp: 5, dmg: 1, speed: 1.2, luck: 2, scale: 1, glow: true },
    puffling: { body: 'blob', name: 'Puffling', color: 0xf4f7ff, hp: 3, dmg: 1, speed: 1.1, luck: 1.2, scale: 1 },
    thornback: { body: 'brute', name: 'Thornback', color: 0x5d7d3c, hp: 7, dmg: 1, speed: 1, luck: 1.6, scale: 1.25 },
    dunebrute: { body: 'brute', name: 'Dune brute', color: 0xbb8648, hp: 8, dmg: 1, speed: 1, luck: 1.8, scale: 1.3 },
    icebrute: { body: 'brute', name: 'Ice brute', color: 0x7fb6d9, hp: 11, dmg: 2, speed: 0.9, luck: 2.4, scale: 1.4 },
    magmabrute: { body: 'brute', name: 'Magma brute', color: 0x8c2f1c, hp: 11, dmg: 2, speed: 1, luck: 2.6, scale: 1.4, glow: true },
    nightwisp: { body: 'wisp', name: 'Night wisp', color: 0x8a7cf0, hp: 3, dmg: 1, speed: 1, luck: 1.6, scale: 1 },
    rimewisp: { body: 'wisp', name: 'Rime wisp', color: 0x9fe0ff, hp: 5, dmg: 1, speed: 1.1, luck: 2.2, scale: 1.1 },
    galewisp: { body: 'wisp', name: 'Gale wisp', color: 0xffe9a0, hp: 4, dmg: 1, speed: 1.2, luck: 1.8, scale: 1.1 },
    sheep: { body: 'animal', name: 'Sheep', color: 0xf2efe6, hp: 3, speed: 1, meat: 1, scale: 1 },
    cow: { body: 'animal', name: 'Cow', color: 0x7a5a44, hp: 5, speed: 0.9, meat: 2, scale: 1.3 },
    pig: { body: 'animal', name: 'Pig', color: 0xf0a8b0, hp: 3, speed: 1.1, meat: 1, scale: 0.9 },
    deer: { body: 'animal', name: 'Deer', color: 0xb5814f, hp: 3, speed: 1.6, meat: 2, scale: 1.1 },
    chicken: { body: 'animal', name: 'Chicken', color: 0xfdfdf8, hp: 1, speed: 1.2, meat: 1, scale: 0.5 },
    fish: { body: 'fish', name: 'Fish', color: 0xff9a3c, hp: 1, speed: 1, meat: 1, scale: 1 },
  };

  // ---------- the islands ----------

  const SIZE = 2100;
  const CELLS = 336;
  const RING = 730; // the six outer islands sit on a circle this far from the middle

  function outer(id, name, biome, degrees, r) {
    const a = (degrees * Math.PI) / 180;
    return { id, name, biome, x: Math.round(Math.sin(a) * RING), z: Math.round(-Math.cos(a) * RING), r };
  }

  const ISLANDS = [
    { id: 'home', name: 'Hearth Isle', biome: 'meadow', x: 0, z: 0, r: 360 },
    outer('bloom', 'Petal Cay', 'bloom', 180, 230),     // south: the closest to the dock
    outer('bog', 'Mirefen', 'swamp', 240, 250),
    outer('pine', 'Pinewatch', 'forest', 300, 250),
    outer('frost', 'Winterholm', 'snow', 0, 260),
    outer('ash', 'Cinder Rock', 'blight', 60, 240),
    outer('dune', 'Sunscar', 'desert', 120, 260),
  ];

  const HOUSE = { x: 0, z: 284 };

  const WORLD = {
    id: 'overworld',
    name: 'Wildshore',
    size: SIZE,
    cells: CELLS,
    gravity: 24,
    liquid: 'water',
    // Wade this deep and the sea carries you back to where you last stood.
    hazard: { level: -1.3, damage: 0, text: 'Too deep to wade. Take the boat.' },
    places: { house: HOUSE },
    // The house's floor is at height 4. The land is a whisker lower so no grass shows through it.
    flats: [{ x: HOUSE.x, z: HOUSE.z, r: 20, blend: 12, level: 3.94 }],
    paths: [
      [[0, 290], [0, 372]],                  // house to the dock
      [[0, 276], [14, 180], [-24, 60], [0, -40]],
    ],
  };

  // Mirefen is so low that its middle would be a pond: raise a dry hummock
  // there for the treasure chest.
  const bog = ISLANDS.find((I) => I.id === 'bog');
  WORLD.flats.push({ x: bog.x, z: bog.z, r: 7, blend: 10, level: 1.9 });

  // The island a point belongs to, and how far inside its rim the point is
  // (negative inside, positive out at sea).
  function nearestIsland(x, z) {
    let best = ISLANDS[0], edge = Infinity;
    for (const I of ISLANDS) {
      const e = Math.hypot(x - I.x, z - I.z) - I.r;
      if (e < edge) {
        edge = e;
        best = I;
      }
    }
    return { island: best, edge };
  }

  // 0 in Hearth Isle's meadows, 1 in its western woods.
  function woodsOnHome(x, z) {
    return smooth(0.46, 0.6, fbm(x * 0.006 + 3, z * 0.006 + 7, 2, 21) - x / 700);
  }

  function biomeAt(x, z) {
    const island = nearestIsland(x, z).island;
    if (island.id !== 'home') return island.biome;
    return woodsOnHome(x, z) > 0.5 ? 'forest' : 'meadow';
  }

  function worldHeight(x, z) {
    const { island, edge } = nearestIsland(x, z);
    if (edge > 90) return -6; // open sea
    const coast = edge + (fbm(x * 0.006 + 40, z * 0.006 + 40, 3, 11) - 0.5) * 100;
    const land = smooth(24, -6, coast);      // seabed up to the beach shelf
    const inland = smooth(-8, -42, coast);   // beach up to the island's own height
    const n1 = fbm(x * 0.012, z * 0.012, 4, 12);
    const n2 = fbm(x * 0.035, z * 0.035, 3, 13);
    const ridge = Math.abs(n2 - 0.5) * 2;
    let shape;
    if (island.id === 'home') {
      const w = woodsOnHome(x, z);
      shape = (4 + (n1 - 0.5) * 7) * (1 - w) + (5.5 + (n1 - 0.5) * 11) * w;
    } else if (island.biome === 'forest') shape = 5.5 + (n1 - 0.5) * 11;
    else if (island.biome === 'desert') shape = 3.2 + ridge * 7;
    else if (island.biome === 'snow') shape = 7 + n1 * 26;
    else if (island.biome === 'swamp') shape = 0.75 + (n2 - 0.5) * 3.4;
    else if (island.biome === 'blight') shape = 7 + ridge * 9;
    else shape = 4.5 + (n1 - 0.5) * 8;
    let h = -6 + 6.6 * land + inland * (shape - 0.6);
    for (const f of WORLD.flats) {
      const k = smooth(f.r + f.blend, f.r, dist(x, z, f.x, f.z));
      if (k > 0) h += (f.level - h) * k;
    }
    return h;
  }

  // Samples the height onto a grid and returns a lookup that matches the
  // triangles the 3D ground is drawn with.
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

  // What grows where, and which creatures live there.
  const GROWTH = {
    meadow: { chance: 0.05, min: 7, kinds: ['round', 'round', 'pine'] },
    forest: { chance: 0.8, min: 4.5, kinds: ['pine', 'pine', 'round'] },
    desert: { chance: 0.07, min: 8, kinds: ['cactus'] },
    snow: { chance: 0.2, min: 6, kinds: ['snowpine'] },
    swamp: { chance: 0.32, min: 5, kinds: ['dead', 'round', 'dead'] },
    blight: { chance: 0.2, min: 6, kinds: ['dead'] },
    bloom: { chance: 0.3, min: 5.5, kinds: ['blossom'] },
  };
  const MONSTERS = {
    meadow: ['mossling', 'mossling', 'nightwisp'], forest: ['mossling', 'thornback', 'nightwisp'],
    desert: ['sandling', 'dunebrute', 'sandling'], snow: ['frostling', 'icebrute', 'rimewisp'],
    swamp: ['bogling', 'thornback', 'bogling'], blight: ['cinderling', 'magmabrute', 'nightwisp'],
    bloom: ['puffling', 'galewisp', 'puffling'],
  };
  const ANIMALS = {
    meadow: ['sheep', 'cow', 'chicken', 'pig', 'sheep'], forest: ['deer', 'pig', 'chicken', 'deer'],
    desert: ['chicken'], snow: ['sheep', 'deer'], swamp: ['pig', 'chicken'], blight: [],
    bloom: ['sheep', 'chicken', 'cow', 'deer'],
  };

  function buildLayout(def, heightAt) {
    const rng = mulberry32(8123);
    const half = def.size / 2 - 20;
    const trees = [], rocks = [], tufts = [], spawns = [];
    const far = (list, x, z, min) => {
      for (const t of list) if (Math.abs(t.x - x) < min && Math.abs(t.z - z) < min && dist(x, z, t.x, t.z) < min) return false;
      return true;
    };
    const clear = (x, z, margin) => dist(x, z, HOUSE.x, HOUSE.z) < 22 + margin || distToPaths(def.paths, x, z) < 2.6 + margin;
    const spot = () => [(rng() * 2 - 1) * half, (rng() * 2 - 1) * half];

    for (let i = 0; i < 60000 && trees.length < 2900; i++) {
      const [x, z] = spot();
      const h = heightAt(x, z);
      if (h < 0.9 || h > 30) continue;
      const biome = biomeAt(x, z);
      const g = GROWTH[biome];
      if (rng() > g.chance || (h < 1.5 && biome !== 'swamp') || clear(x, z, 2.2) || !far(trees, x, z, g.min)) continue;
      trees.push({ x, z, y: h, biome, type: g.kinds[Math.floor(rng() * g.kinds.length)], scale: 0.8 + rng() * 0.7, tint: rng(), turn: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 9000 && rocks.length < 520; i++) {
      const [x, z] = spot();
      const h = heightAt(x, z);
      if (h < 0.4 || clear(x, z, 2.4) || !far(trees, x, z, 2.6)) continue;
      rocks.push({ x, z, y: h, biome: biomeAt(x, z), scale: 0.45 + rng() * rng() * 1.7, turn: rng() * Math.PI * 2, squash: 0.55 + rng() * 0.4 });
    }
    for (let i = 0; i < 30000 && tufts.length < 3400; i++) {
      const [x, z] = spot();
      const h = heightAt(x, z);
      if (h < 1.3) continue;
      const biome = biomeAt(x, z);
      if (biome === 'snow' || biome === 'blight' || (biome === 'desert' && rng() > 0.15) || distToPaths(def.paths, x, z) < 1.6) continue;
      if (dist(x, z, HOUSE.x, HOUSE.z) < 9) continue; // nothing grows through the floor
      tufts.push({ x, z, y: h, biome, kind: Math.floor(rng() * 4), scale: 0.7 + rng() * 0.6, turn: rng() * Math.PI });
    }

    // Night monsters: far more than Riftstead had, on every island.
    for (let i = 0, made = 0; i < 40000 && made < 240; i++) {
      const [x, z] = spot();
      if (heightAt(x, z) < 1.3 || dist(x, z, HOUSE.x, HOUSE.z) < 55 || !far(spawns, x, z, 22)) continue;
      const kinds = MONSTERS[biomeAt(x, z)];
      spawns.push({ id: 'm' + made, x, z, species: kinds[Math.floor(rng() * kinds.length)], night: true });
      made++;
    }
    // Wild animals.
    const herd = [];
    for (let i = 0, made = 0; i < 40000 && made < 200; i++) {
      const [x, z] = spot();
      const kinds = ANIMALS[biomeAt(x, z)];
      if (heightAt(x, z) < 1.4 || !kinds.length || dist(x, z, HOUSE.x, HOUSE.z) < 24 || !far(herd, x, z, 15)) continue;
      herd.push({ id: 'a' + made, x, z, species: kinds[Math.floor(rng() * kinds.length)], wild: true });
      made++;
    }
    // Fish in the shallows round every island.
    const shoal = [];
    for (let i = 0, made = 0; i < 60000 && made < 90; i++) {
      const [x, z] = spot();
      const h = heightAt(x, z);
      if (h > -0.6 || h < -2.4 || !far(shoal, x, z, 12)) continue;
      shoal.push({ id: 'f' + made, x, z, species: 'fish', wild: true });
      made++;
    }
    spawns.push(...herd, ...shoal);

    // The dock: follow the path south from the house until it meets the sea.
    let shore = HOUSE.z + 10;
    while (shore < HOUSE.z + 140 && heightAt(HOUSE.x, shore) > 0.25) shore += 0.5;
    const dock = { x: HOUSE.x, z0: shore - 3, z1: shore + 15, top: 0.9 };
    // A treasure chest at the heart of each of the other islands.
    const chests = ISLANDS.filter((I) => I.id !== 'home').map((I) => ({ id: I.id, x: I.x, z: I.z, y: heightAt(I.x, I.z) }));
    return { trees, rocks, tufts, spawns, dock, chests, boat: { x: dock.x + 2.6, z: dock.z1 - 2 } };
  }

  // Builds everything the game needs to know about the world.
  function buildZone() {
    const terrain = buildTerrain(WORLD, worldHeight);
    return { def: WORLD, terrain, heightAt: terrain.heightAt, biomeAt, layout: buildLayout(WORLD, terrain.heightAt) };
  }

  Object.assign(exports, {
    SIZE, RING, ISLANDS, HOUSE, WORLD, SPECIES, GROWTH,
    mulberry32, noise, fbm, smooth, dist, distToPaths,
    nearestIsland, biomeAt, worldHeight, buildTerrain, buildZone,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.WS = window.WS || {}).Zones = {}));
