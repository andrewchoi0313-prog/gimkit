const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game.js');

test('a new game starts with no cash and every upgrade at level 0', () => {
  const s = G.createGame();
  assert.equal(s.cash, 0);
  assert.equal(s.goal, G.DEFAULT_GOAL);
  for (const u of G.UPGRADES) assert.equal(s.levels[u.id], 0);
});

test('correct answers pay the base amount and build a streak', () => {
  const s = G.createGame();
  const r = G.answer(s, true);
  assert.equal(r.delta, 10);
  assert.equal(s.cash, 10);
  assert.equal(s.streak, 1);
  assert.equal(s.correct, 1);
});

test('streak bonus scales with the answers already in the streak', () => {
  const s = G.createGame();
  s.levels.streakBonus = 1; // +$5 per streak answer
  assert.equal(G.answer(s, true).delta, 10);
  assert.equal(G.answer(s, true).delta, 15);
  assert.equal(G.answer(s, true).delta, 20);
});

test('multiplier applies to base and streak bonus', () => {
  const s = G.createGame();
  s.levels.multiplier = 2; // x2
  s.levels.streakBonus = 1; // +$5
  s.streak = 2;
  assert.equal(G.rewardFor(s), (10 + 5 * 2) * 2);
});

test('wrong answers cost cash, reset the streak, and never go below zero', () => {
  const s = G.createGame();
  G.answer(s, true);
  G.answer(s, true);
  assert.equal(s.cash, 20);
  const r = G.answer(s, false);
  assert.equal(r.delta, -10);
  assert.equal(s.cash, 10);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 2);

  const broke = G.createGame();
  assert.equal(G.answer(broke, false).delta, 0);
  assert.equal(broke.cash, 0);
});

test('insurance reduces the penalty', () => {
  const s = G.createGame();
  s.cash = 100;
  s.levels.insurance = 2; // 50%
  assert.equal(G.penaltyFor(s), 5);
  s.levels.insurance = 4; // 100%
  assert.equal(G.penaltyFor(s), 0);
});

test('buying an upgrade spends cash and raises its level', () => {
  const s = G.createGame();
  s.cash = 50;
  assert.equal(G.buy(s, 'perAnswer'), true);
  assert.equal(s.cash, 10);
  assert.equal(s.levels.perAnswer, 1);
  assert.equal(G.rewardFor(s), 20);
});

test('cannot buy what you cannot afford or what is maxed out', () => {
  const s = G.createGame();
  s.cash = 39;
  assert.equal(G.buy(s, 'perAnswer'), false);
  assert.equal(s.cash, 39);

  const maxed = G.createGame();
  maxed.cash = 1e9;
  const levelCount = G.UPGRADES.find((u) => u.id === 'insurance').levels.length;
  for (let i = 1; i < levelCount; i++) assert.equal(G.buy(maxed, 'insurance'), true);
  assert.equal(G.nextLevel(maxed, 'insurance'), null);
  assert.equal(G.buy(maxed, 'insurance'), false);
});

test('reaching the goal wins the game and ends answering', () => {
  const s = G.createGame({ goal: 25 });
  G.answer(s, true);
  G.answer(s, true);
  assert.equal(s.won, false);
  assert.equal(G.answer(s, true).won, true);
  assert.throws(() => G.answer(s, true));
});

test('upgrade levels get pricier and better', () => {
  for (const u of G.UPGRADES) {
    assert.equal(u.levels[0].cost, 0, u.id);
    for (let i = 1; i < u.levels.length; i++) {
      assert.ok(u.levels[i].cost > u.levels[i - 1].cost, `${u.id} cost ${i}`);
      assert.ok(u.levels[i].value > u.levels[i - 1].value, `${u.id} value ${i}`);
    }
  }
});

test('formatCash', () => {
  assert.equal(G.formatCash(0), '$0');
  assert.equal(G.formatCash(1500), '$1,500');
  assert.equal(G.formatCash(10000), '$10K');
  assert.equal(G.formatCash(12345), '$12.3K');
  assert.equal(G.formatCash(2500000), '$2.5M');
  assert.equal(G.formatCash(-15), '-$15');
});
