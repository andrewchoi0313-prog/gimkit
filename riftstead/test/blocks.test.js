const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/blocks.js');
const P = require('../src/physics.js');

const flat = (level) => ({ heightAt: () => level, grid: P.makeGrid(), store: B.createStore() });

test('cell keys round-trip, including negative cells', () => {
  for (const cell of [[0, 0, 0], [-1, -1, -1], [233, -190, 40], [-2047, 2047, 255]]) {
    assert.deepEqual(B.unkey(B.key(...cell)), cell);
  }
});

test('a block must rest on the land or touch another block', () => {
  const s = B.createStore();
  assert.equal(B.canPlace(s, 0, 0, 4, 1, 4), 'ok');        // sits on ground at height 4
  assert.equal(B.canPlace(s, 0, 0, 2, 1, 4), 'buried');
  assert.equal(B.canPlace(s, 0, 0, 6, 1, 4), 'floating');
  B.place(s, 0, 0, 4, 1);
  assert.equal(B.canPlace(s, 0, 0, 4, 1, 4), 'taken');
  assert.equal(B.canPlace(s, 0, 0, 5, 1, 4), 'ok');        // stacked
  assert.equal(B.canPlace(s, 1, 0, 5, 1, 4), 'floating');  // diagonal does not count
  B.place(s, 0, 0, 5, 1);
  assert.equal(B.canPlace(s, 1, 0, 5, 1, 4), 'ok');        // an overhang, held by its neighbour
  assert.equal(B.groundCell(s, 0, 0, 4), 6);
  assert.equal(B.groundCell(s, 3, 3, 4.85), 5);
  assert.equal(B.groundCell(s, 3, 3, 4.6), 4);
});

test('a door is two cells tall, opens, and is removed whole', () => {
  const s = B.createStore();
  B.place(s, 2, 2, 4, B.TYPES.planks);
  assert.equal(B.canPlace(s, 2, 2, 3, B.TYPES.door, 3), 'taken'); // no headroom
  B.place(s, 5, 5, 4, B.TYPES.door, 1);
  assert.equal(B.get(s, 5, 5, 5), B.TYPES.doorTop);
  assert.equal(B.isSolid(s, 5, 5, 4) && B.isSolid(s, 5, 5, 5), true);
  assert.equal(B.toggleDoor(s, 5, 5, 5), true);                   // works from the top half too
  assert.equal(B.isSolid(s, 5, 5, 4) || B.isSolid(s, 5, 5, 5), false);
  assert.equal(B.toggleDoor(s, 2, 2, 4), null);
  assert.equal(B.count(s), 2);
  assert.equal(B.remove(s, 5, 5, 5).length, 2);
  assert.equal(B.get(s, 5, 5, 4), 0);
  assert.equal(B.count(s), 1);
});

test('pointing finds the block face or the patch of ground', () => {
  const s = B.createStore();
  const ground = () => 4;
  const down = { x: 0, y: -1, z: 0 };
  assert.deepEqual(B.castRay(s, { x: 2.5, y: 9, z: 3.5 }, down, 20, ground).column, [2, 3]);
  B.place(s, 2, 3, 4, 1);
  const hit = B.castRay(s, { x: 2.5, y: 9, z: 3.5 }, down, 20, ground);
  assert.equal(hit.kind, 'block');
  assert.deepEqual(hit.cell, [2, 3, 4]);
  assert.deepEqual(hit.before, [2, 3, 5]);                 // the next block goes on top
  const side = B.castRay(s, { x: -3, y: 4.5, z: 3.5 }, { x: 1, y: 0, z: 0 }, 20, ground);
  assert.deepEqual(side.before, [1, 3, 4]);                // or against the side it was pointed at
  assert.equal(B.castRay(s, { x: 0, y: 9, z: 0 }, { x: 0, y: 1, z: 0 }, 20, ground), null);
});

test('a build survives saving and loading', () => {
  const s = B.createStore();
  B.place(s, -3, 7, 4, B.TYPES.brick);
  B.place(s, -3, 7, 5, B.TYPES.glass);
  B.place(s, 0, 0, 4, B.TYPES.door, 1);
  B.toggleDoor(s, 0, 0, 4);
  const copy = B.restore(JSON.parse(JSON.stringify(B.serialize(s))));
  assert.equal(B.get(copy, -3, 7, 5), B.TYPES.glass);
  assert.equal(B.get(copy, 0, 0, 5), B.TYPES.doorTop);
  assert.equal(copy.turn.get(B.key(0, 0, 4)), 1);
  assert.equal(B.isSolid(copy, 0, 0, 4), true);            // doors load shut
  assert.equal(B.count(copy), 3);
  assert.equal(B.count(B.restore([1, 2, 'x', 3, 0, 0, 0, 99, 5, 5, 5])), 0);
});

test('bodies stand on blocks, are stopped by them, and bump their heads', () => {
  const space = flat(4);
  B.place(space.store, 0, 0, 4, 1);
  B.place(space.store, 0, 0, 5, 1);
  assert.equal(P.groundAt(space, 0.5, 0.5, 4), 4);         // too tall to step onto
  assert.equal(P.groundAt(space, 0.5, 0.5, 6.2), 6);       // but it can be landed on from above
  assert.equal(P.groundAt(space, 1.2, 0.5, 6), 6);         // a little past the edge still counts
  assert.equal(P.groundAt(space, 1.6, 0.5, 6), 4);
  const p = { x: 1.2, z: 0.5 };
  assert.equal(P.pushOut(space, p, 4, 0.4, 1.8), true);
  assert.ok(Math.abs(p.x - 1.4) < 1e-9);
  const above = { x: 0.5, z: 0.5 };
  assert.equal(P.pushOut(space, above, 6, 0.4, 1.8), false); // standing on top: nothing to push
  B.place(space.store, 3, 0, 6, 1);
  assert.equal(P.ceilingAt(space, 3.5, 0.5, 5.8), 6);
  assert.equal(P.ceilingAt(space, 3.5, 0.5, 7.2), Infinity);
});

test('a half-buried block can simply be walked up', () => {
  const space = flat(4.6);
  B.place(space.store, 0, 0, 4, 1);                        // top at 5, only 0.4 above the ground
  assert.equal(P.groundAt(space, 0.5, 0.5, 4.6), 5);
  assert.equal(P.pushOut(space, { x: 0.5, z: 0.5 }, 4.6, 0.4, 1.8), false);
});

test('a wall one block thick stops a body that tries to cross it', () => {
  const space = flat(4);
  for (let j = -3; j <= 3; j++) for (let k = 4; k <= 6; k++) B.place(space.store, 2, j, k, 3);
  const end = P.sweep(space, 0.5, 0.5, 5.5, 0.5, 4, 0.6, 1.2);
  assert.equal(end.hit, true);
  assert.ok(end.x < 1.5, 'stopped at ' + end.x);
  // An open door lets the same body through.
  B.remove(space.store, 2, 0, 4);
  B.remove(space.store, 2, 0, 5);
  B.place(space.store, 2, 0, 4, B.TYPES.door, 0);
  assert.equal(P.sweep(space, 0.5, 0.5, 5.5, 0.5, 4, 0.4, 1.8).hit, true);
  B.toggleDoor(space.store, 2, 0, 4);
  assert.equal(P.sweep(space, 0.5, 0.5, 5.5, 0.5, 4, 0.4, 1.8).hit, false);
});

test('fixed solids are found through the grid, and can be switched off', () => {
  const space = flat(0);
  const rock = space.grid.add({ kind: 'cyl', x: 40, z: -30, r: 2, y0: -5, y1: 1.5, on: true });
  const wall = space.grid.add({ kind: 'box', x0: -52, x1: -50, z0: 10, z1: 30, y0: -5, y1: 8, on: true });
  assert.equal(P.groundAt(space, 40, -30, 3), 1.5);
  assert.equal(P.groundAt(space, 40, -30, 0), 0);
  const p = { x: -50.2, z: 20 };
  P.pushOut(space, p, 0, 0.4, 1.8);
  assert.ok(Math.abs(p.x - -49.6) < 1e-9);
  wall.on = false;
  assert.equal(P.pushOut(space, { x: -51, z: 20 }, 0, 0.4, 1.8), false);
  assert.equal(rock.on, true);
});
