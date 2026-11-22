const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules.js');

test('a new game starts with full hearts and nothing collected', () => {
  const s = R.createState();
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.equal(s.coins, 0);
  assert.equal(R.shardCount(s), 0);
  assert.equal(s.metKeeper, false);
  assert.equal(R.objective(s), 'Find the keeper at the lighthouse.');
});

test('each shard can be collected once, and unknown shards are refused', () => {
  const s = R.createState();
  assert.equal(R.collectShard(s, 'peak'), true);
  assert.equal(R.collectShard(s, 'peak'), false);
  assert.equal(R.collectShard(s, 'moon'), false);
  assert.equal(R.shardCount(s), 1);
  assert.deepEqual(R.missingShards(s), ['grove', 'vault', 'runes', 'trader']);
});

test('pickups count once: coins add up and hearts heal without overfilling', () => {
  const s = R.createState();
  assert.equal(R.takePickup(s, 'coin-1', 'coin'), true);
  assert.equal(R.takePickup(s, 'coin-1', 'coin'), false);
  assert.equal(s.coins, 1);
  R.hurt(s, 3);
  assert.equal(s.hearts, 2);
  R.takePickup(s, 'heart-0', 'heart');
  assert.equal(s.hearts, 4);
  R.takePickup(s, 'heart-1', 'heart');
  assert.equal(s.hearts, R.MAX_HEARTS);
});

test('losing the last heart faints, and reviving refills every heart', () => {
  const s = R.createState();
  for (let i = 0; i < R.MAX_HEARTS - 1; i++) assert.equal(R.hurt(s).fainted, false);
  assert.equal(R.hurt(s).fainted, true);
  assert.equal(s.hearts, 0);
  R.revive(s);
  assert.equal(s.hearts, R.MAX_HEARTS);
  assert.equal(s.faints, 1);
});

test('the grove is cleared once all four of its guards are defeated', () => {
  const s = R.createState();
  R.defeat(s, 'gloom-9', 'mountain');
  for (let i = 0; i < 3; i++) assert.equal(R.defeat(s, 'gloom-' + i, 'grove').groveCleared, false);
  const last = R.defeat(s, 'gloom-3', 'grove');
  assert.equal(last.groveCleared, true);
  assert.equal(last.justCleared, true);
  assert.equal(s.defeated, 5);
  // Defeating the same gloomling again changes nothing.
  assert.equal(R.defeat(s, 'gloom-3', 'grove').justCleared, false);
  assert.equal(s.defeated, 5);
});

test('the rune stones wake in the order sun, moon, star', () => {
  const s = R.createState();
  assert.equal(R.pressRune(s, 'sun'), 'progress');
  assert.equal(R.pressRune(s, 'sun'), 'ignored');
  assert.equal(R.pressRune(s, 'moon'), 'progress');
  assert.equal(R.pressRune(s, 'star'), 'solved');
  assert.equal(s.runesSolved, true);
  assert.equal(R.pressRune(s, 'sun'), 'ignored');
});

test('a wrong rune resets the stones', () => {
  const s = R.createState();
  R.pressRune(s, 'sun');
  assert.equal(R.pressRune(s, 'star'), 'wrong');
  assert.deepEqual(s.runeProgress, []);
  assert.equal(R.pressRune(s, 'moon'), 'wrong');
  assert.equal(s.runesSolved, false);
});

test('the vault gate stays locked until the chest gives up its key', () => {
  const s = R.createState();
  assert.equal(R.tryGate(s), 'locked');
  assert.equal(R.openChest(s), true);
  assert.equal(R.openChest(s), false);
  assert.equal(s.hasKey, true);
  assert.equal(R.tryGate(s), 'opened');
  assert.equal(R.tryGate(s), 'already');
});

test('Pip sells the shard for exactly the asking price', () => {
  const s = R.createState();
  s.coins = R.SHARD_PRICE - 1;
  assert.equal(R.traderTalk(s).effect, undefined);
  assert.equal(R.buyShard(s), false);
  s.coins = R.SHARD_PRICE + 3;
  const talk = R.traderTalk(s);
  assert.equal(talk.effect, 'buyShard');
  assert.equal(R.applyEffect(s, talk.effect), true);
  assert.equal(s.coins, 3);
  assert.equal(R.hasShard(s, 'trader'), true);
  assert.equal(R.buyShard(s), false);
});

test('the keeper sets the quest, then hints at a shard that is still missing', () => {
  const s = R.createState();
  const first = R.keeperTalk(s);
  assert.equal(first.effect, 'meetKeeper');
  R.applyEffect(s, first.effect);
  assert.equal(s.metKeeper, true);
  R.collectShard(s, 'grove');
  const next = R.keeperTalk(s);
  assert.equal(next.lines[0], '1 of 5 shards so far.');
  assert.equal(next.lines[1], R.SHARD_HINTS.peak);
});

test('the beacon lights only with all five shards', () => {
  const s = R.createState();
  s.metKeeper = true;
  for (const id of R.SHARDS.slice(0, 4)) R.collectShard(s, id);
  assert.equal(R.lightBeacon(s), false);
  R.collectShard(s, R.SHARDS[4]);
  assert.equal(R.objective(s), 'Take the shards to the lighthouse door.');
  assert.equal(R.lightBeacon(s), true);
  assert.equal(R.lightBeacon(s), false);
  assert.equal(s.beaconLit, true);
});

test('a saved game restores, and broken saves are rejected', () => {
  const s = R.createState();
  s.metKeeper = true;
  s.coins = 12;
  R.collectShard(s, 'vault');
  R.takePickup(s, 'coin-4', 'coin');
  R.defeat(s, 'gloom-2', 'grove');
  R.pressRune(s, 'sun');
  const copy = R.restore(R.serialize(s));
  assert.equal(copy.coins, 13);
  assert.deepEqual(copy.shards, ['vault']);
  assert.equal(copy.taken['coin-4'], true);
  assert.equal(copy.gone['gloom-2'], true);
  assert.equal(copy.groveDefeated, 1);
  assert.deepEqual(copy.runeProgress, []); // a half-finished puzzle starts over

  assert.equal(R.restore('not json'), null);
  assert.equal(R.restore('{"coins":5}'), null);
  const odd = R.restore('{"shards":["peak","nope"],"hearts":0,"coins":-4,"beaconLit":true}');
  assert.deepEqual(odd.shards, ['peak']);
  assert.equal(odd.hearts, 1);
  assert.equal(odd.coins, 0);
  assert.equal(odd.beaconLit, false);
});
