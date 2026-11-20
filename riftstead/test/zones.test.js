const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../src/zones.js');

const zones = {};
for (const id of Object.keys(Z.DEFS)) zones[id] = Z.buildZone(id);
const over = zones.overworld;

// Jump numbers from src/main.js: 9 units/s upward, running at 10.5 units/s.
const jump = (gravity) => ({ height: (9 * 9) / (2 * gravity), reach: 10.5 * ((2 * 9) / gravity) });

test('the world is the same every time it is generated', () => {
  const again = Z.buildZone('overworld');
  assert.deepEqual(again.layout.trees.slice(0, 30), over.layout.trees.slice(0, 30));
  assert.deepEqual(again.layout.spawns, over.layout.spawns);
  assert.deepEqual(Z.buildZone('cloud').layout.islands, zones.cloud.layout.islands);
});

test('the overworld is about four times the area of Beacon Isle and ringed by sea', () => {
  let land = 0;
  for (let x = -320; x < 320; x += 4) for (let z = -320; z < 320; z += 4) if (over.heightAt(x, z) > 0) land += 16;
  assert.ok(land > 4 * 34000, 'only ' + land + ' square units of land');
  for (let a = 0; a < 6.28; a += 0.2) assert.ok(over.heightAt(Math.cos(a) * 310, Math.sin(a) * 310) < -2);
});

test('all six biomes are there, and each landmark is in the right one', () => {
  const seen = new Set();
  for (let x = -230; x <= 230; x += 10) for (let z = -230; z <= 230; z += 10) if (over.heightAt(x, z) > 1.3) seen.add(over.biomeAt(x, z));
  assert.deepEqual([...seen].sort(), ['blight', 'desert', 'forest', 'meadow', 'snow', 'swamp']);
  const at = (p) => over.biomeAt(p.x, p.z);
  const portal = (id) => over.def.portals.find((p) => p.id === id);
  assert.equal(at(over.def.places.home), 'meadow');
  assert.equal(at(portal('toEmber')), 'desert');
  assert.equal(at(portal('toFrost')), 'snow');
  assert.equal(at(portal('toCloud')), 'forest');
  assert.equal(at(over.def.places.fortress), 'blight');
});

test('the homestead plot is flat at a whole number, so blocks sit flush', () => {
  const h = over.def.places.home;
  for (let dx = -22; dx <= 22; dx += 3.7) for (let dz = -22; dz <= 22; dz += 3.7) {
    if (Math.hypot(dx, dz) <= 22) assert.ok(Math.abs(over.heightAt(h.x + dx, h.z + dz) - 4) < 1e-6);
  }
});

test('paths, portals and places stay on dry land in every zone', () => {
  for (const zone of Object.values(zones)) {
    if (!zone.terrain) continue;
    const dry = (x, z, what) => assert.ok(zone.heightAt(x, z) > 0.3, zone.def.id + ': ' + what + ' is in the wet');
    for (const p of zone.def.portals) dry(p.x, p.z, p.id);
    dry(zone.def.places.start.x, zone.def.places.start.z, 'the start');
    if (zone.def.id !== 'overworld') continue;
    for (const path of zone.def.paths) {
      for (let i = 0; i < path.length - 1; i++) for (let k = 0; k <= 20; k++) {
        dry(path[i][0] + ((path[i + 1][0] - path[i][0]) * k) / 20, path[i][1] + ((path[i + 1][1] - path[i][1]) * k) / 20, 'a path');
      }
    }
  }
});

test('every portal has a way back', () => {
  for (const p of over.def.portals) {
    const back = zones[p.to].def.portals;
    assert.equal(back.length, 1);
    assert.equal(back[0].to, 'overworld');
  }
});

test('monster dens keep clear of the homestead, and night brings more of them', () => {
  const dens = over.layout.spawns;
  const home = over.def.places.home;
  const day = dens.filter((d) => !d.night), night = dens.filter((d) => d.night);
  assert.ok(day.length >= 40 && night.length >= 35);
  for (const d of dens) {
    assert.ok(Z.SPECIES[d.species], 'unknown species ' + d.species);
    assert.ok(over.heightAt(d.x, d.z) > 1, d.id + ' is in the water');
    assert.ok(Z.dist(d.x, d.z, home.x, home.z) >= (d.night ? 34 : 70));
  }
  assert.equal(new Set(dens.map((d) => d.id)).size, dens.length);
  for (const id of ['ember', 'frost', 'cloud']) {
    const kinds = zones[id].layout.spawns.map((d) => d.species);
    assert.ok(kinds.includes('warden'), id + ' has no crystal warden');
    assert.ok(kinds.length >= 10);
  }
});

test('trees keep off the paths and the building plots', () => {
  assert.ok(over.layout.trees.length > 700);
  for (const t of over.layout.trees) {
    assert.ok(Z.distToPaths(over.def.paths, t.x, t.z) > 3, 'tree on a path');
    for (const f of over.def.flats) assert.ok(Z.dist(t.x, t.z, f.x, f.z) > f.r, 'tree on a flat plot');
  }
});

test('Ember Deep: the crystal mound is ringed by lava with stepping stones across', () => {
  const z = zones.ember, c = z.def.places.crystal;
  assert.ok(z.heightAt(c.x, c.z) > 3);
  for (let a = 0; a < 6.28; a += 0.3) assert.ok(z.heightAt(c.x + Math.cos(a) * 13, c.z + Math.sin(a) * 13) < 0, 'the lava ring has a gap');
  const moat = z.layout.stones.filter((s) => Z.dist(s.x, s.z, c.x, c.z) < 22);
  assert.ok(moat.length >= 2);
  const { reach } = jump(z.def.gravity);
  for (let i = 0; i < moat.length - 1; i++) {
    assert.ok(Z.dist(moat[i].x, moat[i].z, moat[i + 1].x, moat[i + 1].z) - 2.5 < reach * 0.5);
  }
});

test('Frost Hollow: the lake is flat ice and the pillar steps can each be jumped', () => {
  const z = zones.frost, c = z.def.places.crystal;
  assert.equal(z.biomeAt(c.x, c.z), 'ice');
  assert.ok(Math.abs(z.heightAt(c.x + 10, c.z) - 0.06) < 0.01);
  const steps = z.layout.stones.slice().sort((a, b) => a.top - b.top);
  let from = z.heightAt(steps[0].x + 3, steps[0].z);
  for (const s of steps) {
    assert.ok(s.top - from < jump(z.def.gravity).height - 0.3, 'an ice step is too tall');
    from = s.top;
  }
  assert.ok(z.layout.crystal.y > steps[steps.length - 1].top);
});

test('Cloud Garden: every island on the way to the crystal can be reached', () => {
  const z = zones.cloud;
  const main = z.layout.islands.filter((i) => i.main);
  assert.ok(main.length >= 8);
  assert.equal(main[main.length - 1].crystal, true);
  const { height, reach } = jump(z.def.gravity);
  for (let i = 0; i < main.length - 1; i++) {
    const a = main[i], b = main[i + 1];
    const gap = Z.dist(a.x, a.z, b.x, b.z) - a.r - b.r;
    assert.ok(gap > 2 && gap < reach * 0.6, 'gap ' + i + ' is ' + gap.toFixed(1));
    assert.ok(b.top - a.top < height - 0.6, 'island ' + (i + 1) + ' is too high');
  }
  // No two islands overlap.
  const all = z.layout.islands;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    assert.ok(Z.dist(all[i].x, all[i].z, all[j].x, all[j].z) > all[i].r + all[j].r + 1.5, 'islands ' + i + ' and ' + j + ' overlap');
  }
});
