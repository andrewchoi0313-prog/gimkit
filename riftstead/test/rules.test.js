const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules.js');

test('a new game starts in the morning with full hearts and only a stick', () => {
  const s = R.createState();
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.deepEqual(R.ownedWeapons(s), ['stick']);
  assert.equal(R.isNight(s.clock), false);
  assert.equal(R.objective(s), 'Talk to Wren at the homestead.');
});

test('hearts fall to zero, revive refills them, and rest brings them back slowly', () => {
  const s = R.createState();
  assert.equal(R.hurt(s, 2).down, false);
  assert.equal(R.tickRegen(s, 5), false);          // too soon after a hit
  let healed = 0;
  for (let i = 0; i < 40; i++) if (R.tickRegen(s, 1)) healed++;
  assert.equal(healed, 2);
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.equal(R.hurt(s, 99).down, true);
  assert.equal(R.tickRegen(s, 100), false);        // no healing while down
  R.revive(s);
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.equal(s.deaths, 1);
  assert.equal(R.heal(s, 3), 0);
});

test('the first sword and axe are promised after a few fights', () => {
  const s = R.createState();
  assert.equal(R.rollDrop(s, 1, 0.99), null);
  assert.equal(R.rollDrop(s, 1, 0.99), null);
  assert.equal(R.rollDrop(s, 1, 0.99), 'sword');
  assert.equal(R.rollDrop(s, 1, 0.99), null);       // promised once, not on every fight after
  R.pickupWeapon(s, 'sword');
  for (let i = 0; i < 5; i++) assert.equal(R.rollDrop(s, 1, 0.99), null);
  assert.equal(R.rollDrop(s, 1, 0.99), 'axe');
  // A promise that was left on the ground is made again after loading the game.
  const later = R.restore(R.serialize(s));
  assert.deepEqual(later.promised, {});
  assert.equal(R.rollDrop(later, 1, 0.99), 'axe');
});

test('the blaster is a rare roll, and better luck makes weapons more likely', () => {
  const s = R.createState();
  s.weapons.sword = 1;
  s.weapons.axe = 1;
  assert.equal(R.rollDrop(s, 1, 0.01), 'blaster');
  assert.equal(R.rollDrop(s, 1, 0.03), 'axe');
  assert.equal(R.rollDrop(s, 1, 0.15), 'sword');
  assert.equal(R.rollDrop(s, 1, 0.3), 'heart');
  assert.equal(R.rollDrop(s, 1, 0.9), null);
  assert.equal(R.rollDrop(s, 2.2, 0.04), 'blaster'); // would have been an axe with luck 1
  // Out of every 1000 even rolls, about 22 are blasters at luck 1.
  let blasters = 0;
  for (let i = 0; i < 1000; i++) if (R.rollDrop(R.restore(R.serialize(s)), 1, (i + 0.5) / 1000) === 'blaster') blasters++;
  assert.equal(blasters, 22);
});

test('picking up a weapon again makes it stronger, up to level 3', () => {
  const s = R.createState();
  assert.equal(R.weaponDamage(s, 'stick'), 1);
  assert.deepEqual(R.pickupWeapon(s, 'sword'), { id: 'sword', isNew: true, level: 1 });
  assert.equal(s.weapon, 'sword');                  // a better weapon goes straight into the hand
  assert.equal(R.weaponDamage(s, 'sword'), 2);
  R.pickupWeapon(s, 'sword');
  assert.equal(R.pickupWeapon(s, 'sword').level, 3);
  assert.equal(R.pickupWeapon(s, 'sword').level, 3);
  assert.equal(R.weaponDamage(s, 'sword'), 4);
  assert.equal(R.rollDrop(s, 1, 0.15), 'heart');    // a maxed sword drops as a heart instead
  assert.equal(R.pickupWeapon(s, 'stick'), null);
});

test('weapons can be chosen and cycled, but only ones that have been found', () => {
  const s = R.createState();
  assert.equal(R.selectWeapon(s, 'axe'), false);
  R.pickupWeapon(s, 'axe');
  R.pickupWeapon(s, 'sword');
  assert.equal(s.weapon, 'axe');                    // the sword is no better than the axe in hand
  assert.equal(R.cycleWeapon(s), 'stick');
  assert.equal(R.cycleWeapon(s), 'sword');
  assert.equal(R.selectWeapon(s, 'stick'), true);
});

test('three crystals break the seal on the fortress', () => {
  const s = R.createState();
  s.metWren = true;
  assert.equal(R.collectCrystal(s, 'ember'), true);
  assert.equal(R.collectCrystal(s, 'ember'), false);
  assert.equal(R.collectCrystal(s, 'moon'), false);
  assert.equal(R.sealBroken(s), false);
  assert.deepEqual(R.missingCrystals(s), ['frost', 'cloud']);
  R.collectCrystal(s, 'cloud');
  R.collectCrystal(s, 'frost');
  assert.equal(R.sealBroken(s), true);
  assert.equal(R.objective(s), 'The seal is broken. Face the giant in the north-east fortress.');
  assert.equal(R.defeatBoss(s), true);
  assert.equal(R.defeatBoss(s), false);
});

test('the clock turns day into night and back', () => {
  const s = R.createState();
  const events = [];
  for (let t = 0; t < R.DAY_LENGTH; t += 1) {
    const e = R.advanceClock(s, 1);
    if (e) events.push(e);
  }
  assert.deepEqual(events, ['dusk', 'dawn']);
  assert.equal(R.moodAt(0.3), 0);
  assert.equal(R.moodAt(0.8), 2);
  assert.ok(Math.abs(R.moodAt(0.66) - 1) < 1e-9);
  assert.ok(R.moodAt(0.99) < 0.5);
  for (let c = 0; c < 1; c += 0.001) assert.ok(Math.abs(R.moodAt(c + 0.001) - R.moodAt(c)) < 0.05, 'the sky jumps at ' + c);
});

test('Wren sets the quest, then hints at a crystal that is still missing', () => {
  const s = R.createState();
  const first = R.wrenTalk(s, false);
  assert.match(first.lines[1], /Press B/);
  assert.match(R.wrenTalk(s, true).lines[1], /Tap Build/);
  R.applyEffect(s, first.effect);
  assert.equal(s.metWren, true);
  R.collectCrystal(s, 'ember');
  const next = R.wrenTalk(s, false);
  assert.equal(next.lines[0], '1 of 3 crystals so far.');
  assert.equal(next.lines[1], R.CRYSTAL_HINTS.frost);
});

test('a saved game restores, and broken saves are rejected', () => {
  const s = R.createState();
  s.metWren = true;
  R.pickupWeapon(s, 'axe');
  R.collectCrystal(s, 'frost');
  s.clock = 0.8;
  const copy = R.restore(R.serialize(s));
  assert.equal(copy.weapons.axe, 1);
  assert.equal(copy.weapon, 'axe');
  assert.deepEqual(copy.crystals, ['frost']);
  assert.equal(copy.clock, 0.8);
  assert.equal(R.restore('nope'), null);
  assert.equal(R.restore('{"hearts":3}'), null);
  const odd = R.restore('{"weapons":{"sword":9,"stick":0},"weapon":"blaster","crystals":["cloud","x"],"hearts":0,"bossDown":true}');
  assert.equal(odd.weapons.sword, R.MAX_LEVEL);
  assert.equal(odd.weapons.stick, 1);
  assert.equal(odd.weapon, 'stick');
  assert.deepEqual(odd.crystals, ['cloud']);
  assert.equal(odd.hearts, 1);
  assert.equal(odd.bossDown, false);
});
