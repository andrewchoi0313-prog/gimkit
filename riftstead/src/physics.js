// Collisions: what a body stands on, what it bumps into, and what is over
// its head. A "space" is { heightAt, grid, store }: the land, the fixed
// solid shapes (trees, rocks, walls, floating islands) and the placed blocks.
// No DOM or 3D code here, so it runs under `node --test`.
(function (exports) {
  'use strict';

  const Blocks = typeof module !== 'undefined' ? require('./blocks.js') : window.RS.Blocks;

  const STEP_UP = 0.55;   // ledges lower than this are walked up
  const BUCKET = 10;
  const EMPTY = [];

  // Solids are { kind: 'cyl', x, z, r, y0, y1, on } or
  // { kind: 'box', x0, x1, z0, z1, y0, y1, on }. The grid sorts them into
  // square buckets so a body only checks the few that are near it.
  function makeGrid() {
    const map = new Map();
    const all = [];
    const cell = (bx, bz) => (bx + 512) * 2048 + (bz + 512);
    function add(s) {
      all.push(s);
      const pad = 2.5;
      const x0 = (s.kind === 'cyl' ? s.x - s.r : s.x0) - pad, x1 = (s.kind === 'cyl' ? s.x + s.r : s.x1) + pad;
      const z0 = (s.kind === 'cyl' ? s.z - s.r : s.z0) - pad, z1 = (s.kind === 'cyl' ? s.z + s.r : s.z1) + pad;
      for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
        for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
          const n = cell(bx, bz);
          if (!map.has(n)) map.set(n, []);
          map.get(n).push(s);
        }
      }
      return s;
    }
    const near = (x, z) => map.get(cell(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) || EMPTY;
    return { add, near, all };
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // The height of whatever is under (x, z): the land, the top of a solid or
  // the top of a block. Only tops the feet are above, or within a step of, count.
  function groundAt(space, x, z, feetY) {
    let top = space.heightAt(x, z);
    for (const s of space.grid.near(x, z)) {
      if (!s.on || s.y1 > 1e5 || s.y1 <= top || feetY < s.y1 - STEP_UP) continue;
      if (s.kind === 'cyl') {
        const dx = x - s.x, dz = z - s.z, r = s.r + 0.15;
        if (dx * dx + dz * dz > r * r) continue;
      } else if (x < s.x0 - 0.15 || x > s.x1 + 0.15 || z < s.z0 - 0.15 || z > s.z1 + 0.15) {
        continue;
      }
      top = s.y1;
    }
    const store = space.store;
    if (store && store.cells.size) {
      // The highest block top the feet could be standing on, in the columns
      // under the body (a little wider than a point, so edges feel fair).
      const kTop = Math.floor(feetY + STEP_UP - 1 + 1e-6);
      for (let i = Math.floor(x - 0.25); i <= Math.floor(x + 0.25); i++) {
        for (let j = Math.floor(z - 0.25); j <= Math.floor(z + 0.25); j++) {
          for (let k = kTop; k > kTop - 5 && k + 1 > top; k--) {
            if (Blocks.isSolid(store, i, j, k)) {
              top = k + 1;
              break;
            }
          }
        }
      }
    }
    return top;
  }

  function pushFromBox(p, x0, x1, z0, z1, radius) {
    const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return false;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * radius;
      p.z = cz + (dz / d) * radius;
    } else {
      // The centre is inside the box: leave by the nearest side.
      const left = p.x - x0, right = x1 - p.x, back = p.z - z0, front = z1 - p.z;
      const least = Math.min(left, right, back, front);
      if (least === left) p.x = x0 - radius;
      else if (least === right) p.x = x1 + radius;
      else if (least === back) p.z = z0 - radius;
      else p.z = z1 + radius;
    }
    return true;
  }

  // Moves point p (x, z) out of any solid or block whose side the body is
  // touching. Returns true if it had to move.
  function pushOut(space, p, feetY, radius, height) {
    let moved = false;
    for (const s of space.grid.near(p.x, p.z)) {
      if (!s.on || feetY + STEP_UP >= s.y1 || feetY + height <= s.y0) continue;
      if (s.kind === 'cyl') {
        const dx = p.x - s.x, dz = p.z - s.z, min = s.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-4) {
          p.x += min;
        } else {
          p.x = s.x + (dx / d) * min;
          p.z = s.z + (dz / d) * min;
        }
        moved = true;
      } else if (pushFromBox(p, s.x0, s.x1, s.z0, s.z1, radius)) {
        moved = true;
      }
    }
    const store = space.store;
    if (store && store.cells.size) {
      const k0 = Math.floor(feetY + STEP_UP), k1 = Math.floor(feetY + height - 0.01);
      for (let pass = 0; pass < 2; pass++) {
        let hit = false;
        for (let i = Math.floor(p.x - radius); i <= Math.floor(p.x + radius); i++) {
          for (let j = Math.floor(p.z - radius); j <= Math.floor(p.z + radius); j++) {
            for (let k = k0; k <= k1; k++) {
              if (Blocks.isSolid(store, i, j, k) && pushFromBox(p, i, i + 1, j, j + 1, radius)) {
                hit = true;
                break;
              }
            }
          }
        }
        if (!hit) break;
        moved = true;
      }
    }
    return moved;
  }

  // The underside of whatever is just above the head, or Infinity.
  function ceilingAt(space, x, z, headY) {
    let low = Infinity;
    for (const s of space.grid.near(x, z)) {
      if (!s.on || s.y0 < headY - 0.05 || s.y0 >= low) continue;
      if (s.kind === 'cyl') {
        const dx = x - s.x, dz = z - s.z;
        if (dx * dx + dz * dz > s.r * s.r) continue;
      } else if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) {
        continue;
      }
      low = s.y0;
    }
    const store = space.store;
    if (store && store.cells.size) {
      const i = Math.floor(x), j = Math.floor(z);
      for (let k = Math.floor(headY - 0.05); k <= Math.floor(headY) + 3 && k < low; k++) {
        if (k >= headY - 0.05 && Blocks.isSolid(store, i, j, k)) {
          low = k;
          break;
        }
      }
    }
    return low;
  }

  // Walks a body from (ax, az) towards (bx, bz) and returns the last spot
  // before anything solid got in the way.
  function sweep(space, ax, az, bx, bz, feetY, radius, height) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.3));
    let x = ax, z = az;
    const probe = { x: 0, z: 0 };
    for (let n = 1; n <= steps; n++) {
      probe.x = ax + ((bx - ax) * n) / steps;
      probe.z = az + ((bz - az) * n) / steps;
      const tx = probe.x, tz = probe.z;
      if (pushOut(space, probe, feetY, radius, height) && Math.hypot(probe.x - tx, probe.z - tz) > 0.02) {
        return { x, z, hit: true };
      }
      x = tx;
      z = tz;
    }
    return { x, z, hit: false };
  }

  Object.assign(exports, { STEP_UP, makeGrid, groundAt, pushOut, ceilingAt, sweep });
})(typeof module !== 'undefined' ? module.exports : ((window.RS = window.RS || {}).Physics = {}));
