// The building blocks: where every placed block is, which spots a new block
// may go, and finding the block (or patch of ground) the player points at.
// Blocks are 1 x 1 x 1 cubes on a grid; cell (i, j, k) fills x i..i+1,
// z j..j+1 and height k..k+1.
// No DOM or 3D code here, so it runs under `node --test`.
(function (exports) {
  'use strict';

  const TYPES = { planks: 1, log: 2, stone: 3, brick: 4, glass: 5, roof: 6, door: 7, doorTop: 8 };

  // What the build bar offers, in order. Every one is unlimited.
  const PALETTE = [
    { type: 1, id: 'planks', name: 'Planks' },
    { type: 2, id: 'log', name: 'Log' },
    { type: 3, id: 'stone', name: 'Stone' },
    { type: 4, id: 'brick', name: 'Brick' },
    { type: 5, id: 'glass', name: 'Glass' },
    { type: 6, id: 'roof', name: 'Roof tile' },
    { type: 7, id: 'door', name: 'Door' },
  ];

  const SPAN = 4096, HALF = 2048, LOW = 256;

  function key(i, j, k) {
    return (i + HALF) + (j + HALF) * SPAN + (k + LOW) * SPAN * SPAN;
  }

  function unkey(n) {
    const i = n % SPAN;
    const j = Math.floor(n / SPAN) % SPAN;
    const k = Math.floor(n / (SPAN * SPAN));
    return [i - HALF, j - HALF, k - LOW];
  }

  function createStore() {
    return {
      cells: new Map(),   // key -> type
      turn: new Map(),    // door key -> 0 (blocks the way along z) or 1 (along x)
      open: new Set(),    // keys of doors standing open
    };
  }

  function get(store, i, j, k) {
    return store.cells.get(key(i, j, k)) || 0;
  }

  // Open doors can be walked through; everything else placed is solid.
  function isSolid(store, i, j, k) {
    const n = key(i, j, k);
    const type = store.cells.get(n);
    if (!type) return false;
    if (type === TYPES.door) return !store.open.has(n);
    if (type === TYPES.doorTop) return !store.open.has(key(i, j, k - 1));
    return true;
  }

  const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  // Whether a block of `type` may go in a cell. `ground` is the height of the
  // land under the middle of the cell. Returns 'ok', 'taken' (something is
  // there), 'buried' (wholly underground) or 'floating' (touching nothing).
  function canPlace(store, i, j, k, type, ground) {
    if (get(store, i, j, k)) return 'taken';
    if (type === TYPES.door && get(store, i, j, k + 1)) return 'taken';
    if (k + 1 <= ground + 0.05) return 'buried';
    if (k <= ground + 0.3) return 'ok'; // rests on the land
    for (const [di, dj, dk] of NEIGHBOURS) {
      if (get(store, i + di, j + dj, k + dk)) return 'ok';
    }
    return 'floating';
  }

  // A door is two cells tall: the top half is stored as its own hidden type.
  function place(store, i, j, k, type, turn) {
    store.cells.set(key(i, j, k), type);
    if (type === TYPES.door) {
      store.cells.set(key(i, j, k + 1), TYPES.doorTop);
      store.turn.set(key(i, j, k), turn ? 1 : 0);
    }
  }

  // Removes the block in a cell. Returns the cells cleared as [i, j, k, type].
  function remove(store, i, j, k) {
    const type = get(store, i, j, k);
    if (!type) return [];
    if (type === TYPES.doorTop) return remove(store, i, j, k - 1);
    const gone = [[i, j, k, type]];
    store.cells.delete(key(i, j, k));
    if (type === TYPES.door) {
      store.cells.delete(key(i, j, k + 1));
      store.turn.delete(key(i, j, k));
      store.open.delete(key(i, j, k));
      gone.push([i, j, k + 1, TYPES.doorTop]);
    }
    return gone;
  }

  // Opens or shuts the door that owns this cell. Returns the new state, or
  // null if the cell is not part of a door.
  function toggleDoor(store, i, j, k) {
    const type = get(store, i, j, k);
    if (type === TYPES.doorTop) return toggleDoor(store, i, j, k - 1);
    if (type !== TYPES.door) return null;
    const n = key(i, j, k);
    if (store.open.has(n)) store.open.delete(n);
    else store.open.add(n);
    return store.open.has(n);
  }

  // The lowest free cell in a column that sits on the land.
  function groundCell(store, i, j, ground) {
    let k = Math.floor(ground + 0.2);
    while (get(store, i, j, k)) k++;
    return k;
  }

  // Follows a line from `origin` along `dir` (a unit vector) until it meets a
  // block or the land. `surfaceAt(x, z)` gives the height of the land.
  // Returns { kind: 'block', cell, before, dist } where `before` is the empty
  // cell the line came through, { kind: 'ground', column: [i, j], point, dist },
  // or null.
  function castRay(store, origin, dir, maxDist, surfaceAt) {
    const step = 0.08;
    let pi = Math.floor(origin.x), pj = Math.floor(origin.z), pk = Math.floor(origin.y);
    for (let t = 0; t <= maxDist; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const i = Math.floor(x), j = Math.floor(z), k = Math.floor(y);
      if (i !== pi || j !== pj || k !== pk) {
        if (get(store, i, j, k)) return { kind: 'block', cell: [i, j, k], before: [pi, pj, pk], dist: t };
        pi = i;
        pj = j;
        pk = k;
      }
      if (y <= surfaceAt(x, z)) return { kind: 'ground', column: [i, j], point: { x, y, z }, dist: t };
    }
    return null;
  }

  function count(store) {
    let n = 0;
    for (const type of store.cells.values()) if (type !== TYPES.doorTop) n++;
    return n;
  }

  // Saved as a flat list of numbers: i, j, k, code, ... Doors remember which
  // way they face, and always load shut.
  function serialize(store) {
    const out = [];
    for (const [n, type] of store.cells) {
      if (type === TYPES.doorTop) continue;
      const [i, j, k] = unkey(n);
      out.push(i, j, k, type === TYPES.door ? type + 16 * (store.turn.get(n) || 0) : type);
    }
    return out;
  }

  function restore(list) {
    const store = createStore();
    if (!Array.isArray(list)) return store;
    for (let n = 0; n + 3 < list.length; n += 4) {
      const [i, j, k, code] = [list[n], list[n + 1], list[n + 2], list[n + 3]];
      if (![i, j, k, code].every(Number.isInteger)) continue;
      if (Math.abs(i) >= HALF || Math.abs(j) >= HALF || k < -LOW || k > LOW) continue;
      const type = code % 16;
      const known = (code >= 1 && code <= 7) || code === TYPES.door + 16;
      if (!known || get(store, i, j, k)) continue;
      if (type === TYPES.door && get(store, i, j, k + 1)) continue;
      place(store, i, j, k, type, code >= 16);
    }
    return store;
  }

  Object.assign(exports, {
    TYPES, PALETTE, key, unkey, createStore, get, isSolid, canPlace, place, remove, toggleDoor,
    groundCell, castRay, count, serialize, restore,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.WS = window.WS || {}).Blocks = {}));
