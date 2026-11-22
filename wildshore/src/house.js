// The plan of the two-storey house the player starts in: which blocks make
// its walls, floors and roof, where the stairs climb, and where the
// fireplace and furniture stand.
// No DOM or 3D code here, so it runs under `node --test`.
(function (exports) {
  'use strict';

  const Blocks = typeof module !== 'undefined' ? require('./blocks.js') : window.WS.Blocks;
  const T = Blocks.TYPES;

  const HALF_X = 5;   // the house is 11 blocks wide...
  const HALF_Z = 4;   // ...and 9 deep, walls included
  const STOREY = 4;   // from one floor up to the next
  const STEPS = 8;    // stairs, each half a block high

  // (hx, hz) is the middle of the house and g the height of the ground there.
  // All three must be whole numbers so the blocks line up with the grid.
  function plan(hx, hz, g) {
    const blocks = [];  // [i, j, k, type, turn]
    const put = (i, j, k, type, turn) => blocks.push([i, j, k, type, turn || 0]);
    const x0 = hx - HALF_X, x1 = hx + HALF_X, z0 = hz - HALF_Z, z1 = hz + HALF_Z;
    const upper = g + STOREY;
    const edge = (i, j) => i === x0 || i === x1 || j === z0 || j === z1;
    const stairRow = z0 + 1;                                 // the stairs run along the north wall
    const stairwell = (i, j) => j === stairRow && i >= hx - 3 && i <= hx + 3;
    const chimney = (i, j) => i === x0 && j === hz;
    const window1 = (i, j) => (j === z1 && Math.abs(i - hx) === 3) || (i === x1 && Math.abs(j - hz) === 1);
    const window2 = (i, j) => (j === z1 && (i === hx || Math.abs(i - hx) === 3)) || (i === x1 && Math.abs(j - hz) === 1) || (j === z0 && Math.abs(i - hx) === 2);
    const doorway = (i, j) => i === hx && j === z1;

    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        put(i, j, g - 1, T.planks);                          // ground floor, flush with the grass
        if (chimney(i, j)) continue;                         // the chimney fills this column
        if (!stairwell(i, j)) put(i, j, upper - 1, T.planks); // upstairs floor
        put(i, j, upper + 3, T.roof);
        if (j > z0 && j < z1) put(i, j, upper + 4, T.roof);  // two more rows make a ridge
        if (Math.abs(j - hz) <= 1) put(i, j, upper + 5, T.roof);
        if (!edge(i, j)) continue;
        for (let k = 0; k < 3; k++) {
          if (!(doorway(i, j) && k < 2)) put(i, j, g + k, k === 1 && window1(i, j) ? T.glass : k === 0 ? T.stone : T.planks);
          put(i, j, upper + k, k === 1 && window2(i, j) ? T.glass : T.planks);
        }
      }
    }
    put(hx, z1, g, T.door, 0);
    // The chimney climbs the west wall and out past the ridge.
    for (let k = g; k <= upper + 7; k++) put(x0, hz, k, T.stone);
    // The hearth: stone either side of the fire and across the top.
    for (const j of [hz - 1, hz + 1]) for (const k of [g, g + 1]) put(x0 + 1, j, k, T.stone);
    for (const j of [hz - 1, hz, hz + 1]) put(x0 + 1, j, g + 2, T.brick);

    // Stairs climb from the east end of the north wall up to the west.
    const stairs = [];
    for (let n = 0; n < STEPS; n++) {
      const i = x1 - 1 - n;
      stairs.push({ x0: i, x1: i + 1, z0: stairRow, z1: stairRow + 1, top: g + (STOREY / STEPS) * (n + 1) });
    }

    return {
      blocks, stairs, ground: g, upper,
      door: { x: hx + 0.5, z: z1 + 0.5 },
      start: { x: hx - 1.5, z: hz + 0.5, heading: -Math.PI / 2 },   // on the rug, facing the fire
      fire: { x: x0 + 1.5, y: g, z: hz + 0.5 },                    // the firebox
      table: { x: hx + 2.5, y: g, z: hz + 1.5 },
      mask: { x: hx + 2.7, y: g, z: hz + 0.8 },                     // the snorkel mask, on the table
      shelf: { x: x1 - 0.75, y: g, z: hz + 2.5 },
      bed: { x: x1 - 1.7, y: upper, z: z1 - 2.2 },
      wardrobe: { x: hx - 2.5, y: upper, z: z1 - 0.85 },
      inside: (x, z) => x > x0 && x < x1 + 1 && z > z0 && z < z1 + 1,
    };
  }

  exports.plan = plan;
  exports.STEPS = STEPS;
})(typeof module !== 'undefined' ? module.exports : ((window.WS = window.WS || {}).House = {}));
