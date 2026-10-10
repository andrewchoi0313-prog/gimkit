// Core game rules: cash, upgrades, streaks and the win condition.
// Kept free of DOM code so it can run in the browser and under `node --test`.
(function (exports) {
  'use strict';

  const DEFAULT_GOAL = 10000;

  // Each upgrade starts at level 0 (free). `cost` is the price to reach that level.
  const UPGRADES = [
    {
      id: 'perAnswer',
      name: 'Money per Answer',
      description: 'Base cash for every correct answer.',
      format: (v) => formatCash(v),
      levels: [
        { value: 10, cost: 0 },
        { value: 20, cost: 40 },
        { value: 50, cost: 150 },
        { value: 100, cost: 500 },
        { value: 250, cost: 1500 },
      ],
    },
    {
      id: 'streakBonus',
      name: 'Streak Bonus',
      description: 'Extra cash for each answer already in your streak.',
      format: (v) => '+' + formatCash(v),
      levels: [
        { value: 0, cost: 0 },
        { value: 5, cost: 40 },
        { value: 15, cost: 200 },
        { value: 30, cost: 600 },
        { value: 75, cost: 1800 },
      ],
    },
    {
      id: 'multiplier',
      name: 'Multiplier',
      description: 'Multiplies everything you earn.',
      format: (v) => '×' + v,
      levels: [
        { value: 1, cost: 0 },
        { value: 1.5, cost: 80 },
        { value: 2, cost: 300 },
        { value: 3, cost: 1000 },
        { value: 5, cost: 3000 },
      ],
    },
    {
      id: 'insurance',
      name: 'Insurance',
      description: 'Shrinks what you lose on a wrong answer.',
      format: (v) => v + '%',
      levels: [
        { value: 0, cost: 0 },
        { value: 25, cost: 20 },
        { value: 50, cost: 80 },
        { value: 75, cost: 250 },
        { value: 100, cost: 700 },
      ],
    },
  ];

  const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  function createGame(options = {}) {
    return {
      goal: options.goal ?? DEFAULT_GOAL,
      cash: 0,
      levels: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
      streak: 0,
      bestStreak: 0,
      answered: 0,
      correct: 0,
      won: false,
    };
  }

  function upgradeValue(state, id) {
    return UPGRADE_BY_ID[id].levels[state.levels[id]].value;
  }

  // Cash earned by the next correct answer. The streak bonus counts answers
  // already in the streak, so the first correct answer earns no bonus.
  function rewardFor(state) {
    const base = upgradeValue(state, 'perAnswer');
    const bonus = upgradeValue(state, 'streakBonus') * state.streak;
    return Math.round((base + bonus) * upgradeValue(state, 'multiplier'));
  }

  // Cash lost on a wrong answer, after insurance. Never more than you have.
  function penaltyFor(state) {
    const full = upgradeValue(state, 'perAnswer') * upgradeValue(state, 'multiplier');
    const uncovered = 1 - upgradeValue(state, 'insurance') / 100;
    return Math.min(state.cash, Math.round(full * uncovered));
  }

  function answer(state, isCorrect) {
    if (state.won) throw new Error('Game is already won');
    state.answered += 1;
    let delta;
    if (isCorrect) {
      delta = rewardFor(state);
      state.correct += 1;
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    } else {
      const penalty = penaltyFor(state);
      delta = penalty > 0 ? -penalty : 0;
      state.streak = 0;
    }
    state.cash += delta;
    if (state.cash >= state.goal) state.won = true;
    return { correct: isCorrect, delta, cash: state.cash, streak: state.streak, won: state.won };
  }

  // The next level of an upgrade, or null when it is maxed out.
  function nextLevel(state, id) {
    return UPGRADE_BY_ID[id].levels[state.levels[id] + 1] ?? null;
  }

  function canBuy(state, id) {
    const next = nextLevel(state, id);
    return next !== null && state.cash >= next.cost;
  }

  function buy(state, id) {
    if (!canBuy(state, id)) return false;
    state.cash -= nextLevel(state, id).cost;
    state.levels[id] += 1;
    return true;
  }

  function formatCash(n) {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1e6) return sign + '$' + trimZero((abs / 1e6).toFixed(1)) + 'M';
    if (abs >= 1e4) return sign + '$' + trimZero((abs / 1e3).toFixed(1)) + 'K';
    return sign + '$' + abs.toLocaleString('en-US');
  }

  function trimZero(s) {
    return s.replace(/\.0$/, '');
  }

  Object.assign(exports, {
    DEFAULT_GOAL,
    UPGRADES,
    createGame,
    upgradeValue,
    rewardFor,
    penaltyFor,
    answer,
    nextLevel,
    canBuy,
    buy,
    formatCash,
  });
})(typeof module !== 'undefined' ? module.exports : (window.BrainBucksGame = {}));
