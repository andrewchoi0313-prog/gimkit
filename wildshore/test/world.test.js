const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../src/zones.js');
const B = require('../src/blocks.js');
const P = require('../src/physics.js');
const H = require('../src/house.js');

const world = Z.buildZone();
const L = world.layout;

test('there are seven islands with open sea between them', () => {
  assert.equal(Z.ISLANDS.length, 7);
  for (const a of Z.ISLANDS) {
    assert.ok(world.heightAt(a.x, a.z) > 1, a.name + ' has no land at its heart');
    for (const b of Z.ISLANDS) {
      if (a === b) continue;
      assert.ok(Z.dist(a.x, a.z, b.x, b.z) - a.r - b.r > 60, a.name + ' touches ' + b.name);
    }
  }
  for (let t = 0; t < 6.28; t += 0.1) assert.ok(world.heightAt(Math.cos(t) * 1040, Math.sin(t) * 1040) < -2, 'land reaches the edge of the map');
});

test('the land is about ten times the size of Riftstead', () => {
  let land = 0;
  for (let x = -1050; x < 1050; x += 10) for (let z = -1050; z < 1050; z += 10) if (world.heightAt(x, z) > 0) land += 100;
  const riftstead = 171500; // measured the same way in riftstead/
  assert.ok(land > riftstead * 8.5 && land < riftstead * 12, 'land is ' + (land / riftstead).toFixed(1) + ' times Riftstead');
});

test('every den is a night monster, a wild animal or a fish, in the right place', () => {
  const dens = L.spawns;
  const monsters = dens.filter((d) => d.night), wild = dens.filter((d) => d.wild);
  assert.equal(monsters.length + wild.length, dens.length);
  assert.ok(monsters.length >= 200, 'only ' + monsters.length + ' monsters');   // Riftstead had 84 dens in all
  assert.equal(new Set(dens.map((d) => d.id)).size, dens.length);
  for (const d of dens) {
    const sp = Z.SPECIES[d.species];
    assert.ok(sp, 'unknown species ' + d.species);
    const h = world.heightAt(d.x, d.z);
    if (sp.body === 'fish') assert.ok(h < -0.5 && h > -2.5, 'a fish is out of the shallows');
    else assert.ok(h > 1, d.species + ' starts in the water');
    assert.equal(!!d.wild, sp.body === 'animal' || sp.body === 'fish');
    if (d.wild) assert.ok(sp.meat >= 1);
    else assert.ok(Z.dist(d.x, d.z, Z.HOUSE.x, Z.HOUSE.z) >= 55, 'a monster den is too close to the house');
  }
  const kinds = new Set(wild.map((d) => d.species));
  for (const need of ['sheep', 'cow', 'chicken', 'pig', 'deer', 'fish']) assert.ok(kinds.has(need), 'no ' + need);
});

test('the dock runs from the beach out to water deep enough for the boat', () => {
  const d = L.dock;
  assert.ok(world.heightAt(d.x, d.z0) > 0.2);
  assert.ok(world.heightAt(L.boat.x, L.boat.z) < -0.45, 'the boat is aground');
  assert.ok(d.top - world.heightAt(d.x, d.z0) < P.STEP_UP, 'the pier is too high to step onto');
  // From the dock, straight south is open water all the way to Petal Cay.
  const cay = Z.ISLANDS.find((i) => i.id === 'bloom');
  let sea = 0;
  for (let z = d.z1; z < cay.z - cay.r - 60; z += 4) if (world.heightAt(d.x, z) < -0.45) sea++; else sea = -1e9;
  assert.ok(sea > 10);
});

test('each of the six far islands has a chest on dry land', () => {
  assert.equal(L.chests.length, 6);
  for (const c of L.chests) assert.ok(c.y > 1, c.id + ' chest is in the water');
});

test('the house: two floors, a door, a chimney, and stairs that can be walked up', () => {
  const plan = H.plan(Z.HOUSE.x, Z.HOUSE.z, 4);
  const store = B.createStore();
  for (const [i, j, k, type, turn] of plan.blocks) {
    assert.equal(B.get(store, i, j, k), 0, 'two blocks share a cell');
    B.place(store, i, j, k, type, turn);
  }
  const types = new Set(plan.blocks.map((b) => b[3]));
  for (const t of ['planks', 'stone', 'glass', 'roof', 'door']) assert.ok(types.has(B.TYPES[t]), 'no ' + t);
  assert.equal(plan.upper - plan.ground, 4);
  // The ground under the house is flat, just below the floor.
  for (const [dx, dz] of [[-5, -4], [5, 4], [0, 0], [5, -4]]) {
    const gap = plan.ground - world.heightAt(Z.HOUSE.x + dx, Z.HOUSE.z + dz);
    assert.ok(gap > 0 && gap < 0.1, 'the floor is ' + gap + ' above the land');
  }

  const grid = P.makeGrid();
  for (const s of plan.stairs) grid.add({ kind: 'box', x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, y0: -50, y1: s.top, on: true });
  const space = { heightAt: () => 4, grid, store };
  // Walk up: every step is low enough to climb without jumping, with headroom.
  let y = P.groundAt(space, plan.start.x, plan.start.z, 4);
  assert.equal(y, 4);
  for (const s of plan.stairs) {
    const x = (s.x0 + s.x1) / 2, z = (s.z0 + s.z1) / 2;
    const top = P.groundAt(space, x, z, y);
    assert.ok(top - y > 0 && top - y <= P.STEP_UP, 'a stair rises ' + (top - y));
    assert.ok(P.ceilingAt(space, x, z, top + 1.8) === Infinity || P.ceilingAt(space, x, z, top + 0.1) - top >= 1.8, 'no headroom on the stairs');
    y = top;
  }
  assert.equal(y, plan.upper);
  const last = plan.stairs[plan.stairs.length - 1];
  assert.equal(P.groundAt(space, last.x0 - 0.5, last.z0 + 0.5, y), plan.upper); // the landing
  // The walls keep a body in until the door is opened.
  const out = () => P.sweep(space, plan.door.x, plan.door.z - 2, plan.door.x, plan.door.z + 2, 4, 0.4, 1.8).hit;
  assert.equal(out(), true);
  B.toggleDoor(store, Math.floor(plan.door.x), Math.floor(plan.door.z), 4);
  assert.equal(out(), false);
  assert.equal(P.sweep(space, plan.start.x, plan.start.z, plan.start.x + 9, plan.start.z, 4, 0.4, 1.8).hit, true);
});
