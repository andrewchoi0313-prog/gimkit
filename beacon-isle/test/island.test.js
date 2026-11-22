const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/island.js');
const R = require('../src/rules.js');

const terrain = I.buildTerrain();
const layout = I.buildLayout(terrain);

// Jump numbers from src/main.js: 9 units/s upward against gravity of 24.
const JUMP_HEIGHT = (9 * 9) / (2 * 24);

test('the island is the same every time it is generated', () => {
  const again = I.buildLayout(I.buildTerrain());
  assert.deepEqual(again.trees.slice(0, 20), layout.trees.slice(0, 20));
  assert.deepEqual(again.coins, layout.coins);
});

test('every named place is on dry land', () => {
  for (const [name, p] of Object.entries(I.PLACES)) {
    assert.ok(terrain.heightAt(p.x, p.z) > 0.2, name + ' is under water');
  }
});

test('the sea surrounds the island', () => {
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    assert.ok(terrain.heightAt(Math.cos(a) * 150, Math.sin(a) * 150) < -2, 'land reaches the map edge');
  }
});

test('paths stay above the water', () => {
  for (const path of I.PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      for (let k = 0; k <= 20; k++) {
        const x = path[i][0] + ((path[i + 1][0] - path[i][0]) * k) / 20;
        const z = path[i][1] + ((path[i + 1][1] - path[i][1]) * k) / 20;
        assert.ok(terrain.heightAt(x, z) > 0.2, 'path dips under water at ' + x + ', ' + z);
      }
    }
  }
});

test('trees keep off the paths and the building plots', () => {
  assert.ok(layout.trees.length > 150);
  for (const t of layout.trees) {
    assert.ok(I.distToPaths(t.x, t.z) > 3, 'tree on a path');
    for (const f of I.FLATS) assert.ok(I.dist(t.x, t.z, f.x, f.z) > f.r, 'tree on a building plot');
  }
});

test('there are plenty of coins to afford the trader\'s shard', () => {
  assert.ok(layout.coins.length >= R.SHARD_PRICE * 2);
  const ids = new Set(layout.coins.map((c) => c.id));
  assert.equal(ids.size, layout.coins.length);
  for (const c of layout.coins) assert.ok(c.y > 1, 'coin is under water');
});

test('the stepping stones can be crossed with ordinary jumps', () => {
  const stones = layout.stones;
  assert.ok(stones.length >= 3);
  for (let i = 0; i < stones.length - 1; i++) {
    const gap = I.dist(stones[i].x, stones[i].z, stones[i + 1].x, stones[i + 1].z) - stones[i].r - stones[i + 1].r;
    assert.ok(gap < 2.5, 'gap of ' + gap.toFixed(2) + ' is too wide');
  }
  // The first and last stones sit close to dry land.
  const first = stones[0];
  const last = stones[stones.length - 1];
  assert.ok(I.dist(first.x, first.z, I.PLACES.islet.x, I.PLACES.islet.z) < 14);
  assert.ok(I.dist(last.x, last.z, I.PLACES.shore.x, I.PLACES.shore.z) < 8);
});

test('every step up the spire is lower than a jump', () => {
  const spire = layout.spire;
  let from = spire.base;
  for (const step of spire.steps) {
    assert.ok(step.top - from < JUMP_HEIGHT - 0.3, 'step is too tall');
    from = step.top;
  }
  assert.ok(spire.top - from < JUMP_HEIGHT - 0.3);
});

test('gloomlings and hearts start on dry land, and four gloomlings guard the grove', () => {
  for (const g of layout.gloomlings) assert.ok(g.y > 1, g.id + ' starts in the water');
  for (const h of layout.hearts) assert.ok(h.y > 2, h.id + ' is in the water');
  assert.equal(layout.gloomlings.filter((g) => g.group === 'grove').length, R.GROVE_GUARDS);
});

test('heightAt matches the grid corners and stays inside the map', () => {
  const n = I.CELLS + 1;
  assert.equal(terrain.heightAt(-I.HALF, -I.HALF), terrain.heights[0]);
  const i = 90;
  const j = 40;
  assert.equal(terrain.heightAt(i * I.STEP - I.HALF, j * I.STEP - I.HALF), terrain.heights[j * n + i]);
  assert.ok(Number.isFinite(terrain.heightAt(9999, -9999)));
});
