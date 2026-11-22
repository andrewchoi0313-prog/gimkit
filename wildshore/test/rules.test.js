const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules.js');

test('a new game starts at home in the morning with a stick and no meat', () => {
  const s = R.createState();
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.equal(s.meat, 0);
  assert.deepEqual(R.ownedWeapons(s), ['stick']);
  assert.deepEqual(s.islands, ['home']);
  assert.equal(R.isNight(s.clock), false);
  assert.equal(R.objective(s), 'Islands found: 1 of 7. Chests opened: 0 of 6.');
});

test('meat is only eaten when hurt, and wins back two hearts', () => {
  const s = R.createState();
  assert.equal(R.eatMeat(s), 'none');
  R.addMeat(s, 2);
  assert.equal(s.hunts, 1);
  assert.equal(R.eatMeat(s), 'full');
  R.hurt(s, 3);
  assert.equal(R.eatMeat(s), 'ate');
  assert.equal(s.hearts, R.MAX_HEARTS - 1);
  assert.equal(R.eatMeat(s), 'ate');
  assert.equal(s.hearts, R.MAX_HEARTS);     // never more than full
  assert.equal(s.meat, 0);
});

test('breath lasts ten seconds under water, comes back above, and the mask never runs out', () => {
  const s = R.createState();
  assert.equal(R.AIR, 10);
  for (let t = 0; t < 9; t++) assert.equal(R.breathe(s, 1, true), false);
  assert.equal(R.breathe(s, 1, true), true);       // the tenth second: out of air
  assert.equal(s.air, 0);
  assert.equal(R.breathe(s, 1, false), false);
  assert.equal(s.air, 4);                          // back above: breath returns fast
  R.breathe(s, 5, false);
  assert.equal(s.air, R.AIR);
  s.mask = true;
  for (let t = 0; t < 60; t++) assert.equal(R.breathe(s, 1, true), false);
  assert.equal(s.air, R.AIR);
  assert.equal(R.restore(R.serialize(s)).mask, true);
  assert.equal(JSON.parse(R.serialize(s)).air, undefined);
});

test('hearts fall to zero, revive refills them, and rest brings them back slowly', () => {
  const s = R.createState();
  R.hurt(s, 2);
  assert.equal(R.tickRegen(s, 5), false);
  let healed = 0;
  for (let i = 0; i < 40; i++) if (R.tickRegen(s, 1)) healed++;
  assert.equal(healed, 2);
  assert.equal(R.hurt(s, 99).down, true);
  R.revive(s);
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.equal(s.deaths, 1);
});

test('monsters promise a first sword and axe, and the blaster is a rare roll', () => {
  const s = R.createState();
  assert.equal(R.rollDrop(s, 1, 0.99), null);
  assert.equal(R.rollDrop(s, 1, 0.99), null);
  assert.equal(R.rollDrop(s, 1, 0.99), 'sword');
  assert.equal(R.rollDrop(s, 1, 0.99), null);       // promised once only
  R.pickupWeapon(s, 'sword');
  s.weapons.axe = 1;
  assert.equal(R.rollDrop(s, 1, 0.01), 'blaster');
  assert.equal(R.rollDrop(s, 1, 0.03), 'axe');
  assert.equal(R.rollDrop(s, 1, 0.3), 'heart');
  assert.equal(R.rollDrop(s, 1, 0.9), null);
});

test('finding a weapon again makes it stronger, up to level 3', () => {
  const s = R.createState();
  assert.deepEqual(R.pickupWeapon(s, 'sword'), { id: 'sword', isNew: true, level: 1 });
  assert.equal(s.weapon, 'sword');
  R.pickupWeapon(s, 'sword');
  assert.equal(R.pickupWeapon(s, 'sword').level, 3);
  assert.equal(R.pickupWeapon(s, 'sword').level, 3);
  assert.equal(R.weaponDamage(s, 'sword'), 4);
  assert.equal(R.cycleWeapon(s), 'stick');
  assert.equal(R.selectWeapon(s, 'axe'), false);
});

test('islands count once each, and every chest opens once', () => {
  const s = R.createState();
  assert.equal(R.visitIsland(s, 'home'), false);
  assert.equal(R.visitIsland(s, 'bloom'), true);
  assert.equal(R.visitIsland(s, 'bloom'), false);
  assert.equal(R.openChest(s, 'bloom'), 'sword');
  assert.equal(R.openChest(s, 'bloom'), null);
  assert.equal(R.openChest(s, 'home'), null);
  assert.equal(R.objective(s), 'Islands found: 2 of 7. Chests opened: 1 of 6.');
  for (const id of Object.keys(R.CHESTS)) {
    R.visitIsland(s, id);
    R.openChest(s, id);
  }
  assert.match(R.objective(s), /The sea is yours/);
  assert.equal(Object.values(R.CHESTS).filter((w) => w === 'blaster').length, 2);
});

test('the clock turns day into night and back, and the bed skips the night', () => {
  const s = R.createState();
  const events = [];
  for (let t = 0; t < R.DAY_LENGTH; t += 1) {
    const e = R.advanceClock(s, 1);
    if (e) events.push(e);
  }
  assert.deepEqual(events, ['dusk', 'dawn']);
  assert.equal(R.sleep(s), false);                  // daytime
  s.clock = 0.8;
  R.hurt(s, 2);
  assert.equal(R.sleep(s), true);
  assert.equal(R.isNight(s.clock), false);
  assert.equal(s.hearts, R.MAX_HEARTS);
  for (let c = 0; c < 1; c += 0.001) assert.ok(Math.abs(R.moodAt(c + 0.001) - R.moodAt(c)) < 0.05, 'the sky jumps at ' + c);
});

test('a saved game restores, and broken saves are rejected', () => {
  const s = R.createState();
  R.addMeat(s, 3);
  R.pickupWeapon(s, 'axe');
  R.visitIsland(s, 'frost');
  R.openChest(s, 'frost');
  const copy = R.restore(R.serialize(s));
  assert.equal(copy.meat, 3);
  assert.equal(copy.weapon, 'axe');
  assert.deepEqual(copy.islands, ['home', 'frost']);
  assert.deepEqual(copy.chests, ['frost']);
  assert.deepEqual(copy.promised, {});
  assert.equal(R.restore('nope'), null);
  assert.equal(R.restore('{"hearts":3}'), null);
  const odd = R.restore('{"weapons":{"sword":9},"weapon":"blaster","islands":["x","dune"],"chests":["nope"],"meat":-5,"hearts":0}');
  assert.equal(odd.weapons.sword, R.MAX_LEVEL);
  assert.equal(odd.weapon, 'stick');
  assert.deepEqual(odd.islands, ['home', 'dune']);
  assert.deepEqual(odd.chests, []);
  assert.equal(odd.meat, 0);
  assert.equal(odd.hearts, 1);
});
