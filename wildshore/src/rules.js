// The rules of Wildshore: hearts, meat, weapons and what monsters drop,
// islands found, treasure chests, the day and night clock, and saving.
// No DOM or 3D code here, so it runs under `node --test`.
(function (exports) {
  'use strict';

  const MAX_HEARTS = 6;
  const DAY_LENGTH = 420;      // seconds for a full day and night
  const NIGHT_START = 0.7;     // the clock runs 0..1; night is this slice of it
  const NIGHT_END = 0.95;
  const MAX_LEVEL = 3;
  const MEAT_HEALS = 2;

  // damage is listed per level. arc is how far round the swing reaches:
  // 1 = only straight ahead, -1 = all the way round.
  const WEAPONS = {
    stick: { name: 'Stick', damage: [1], reach: 2.6, time: 0.38, arc: 0.2, knock: 9, ranged: false },
    sword: { name: 'Sword', damage: [2, 3, 4], reach: 3.0, time: 0.3, arc: 0.1, knock: 9, ranged: false },
    axe: { name: 'Axe', damage: [4, 5, 7], reach: 3.3, time: 0.58, arc: -0.4, knock: 15, ranged: false },
    blaster: { name: 'Blaster', damage: [3, 4, 5], reach: 38, time: 0.42, arc: 0.5, knock: 6, ranged: true },
  };
  const WEAPON_ORDER = ['stick', 'sword', 'axe', 'blaster'];

  // What is inside the chest on each island.
  const CHESTS = { bloom: 'sword', bog: 'axe', pine: 'sword', dune: 'axe', frost: 'blaster', ash: 'blaster' };
  const ISLAND_COUNT = 7;

  function createState() {
    return {
      hearts: MAX_HEARTS,
      meat: 0,
      weapons: { stick: 1, sword: 0, axe: 0, blaster: 0 },   // level of each weapon; 0 = not found yet
      weapon: 'stick',                                       // the one in hand
      islands: ['home'],   // ids of islands the player has set foot on
      chests: [],          // ids of islands whose chest has been opened
      readNote: false,
      kills: 0,            // monsters beaten
      hunts: 0,            // animals hunted
      deaths: 0,
      elapsed: 0,          // seconds played
      clock: 0.14,         // time of day, 0..1. The game starts in the morning.
      sinceHurt: 99,       // seconds since the last hit
      regen: 0,
      promised: {},        // weapons already handed out by the promise in rollDrop (not saved)
    };
  }

  // ---------- hearts and meat ----------

  function hurt(s, amount) {
    s.hearts = Math.max(0, s.hearts - (amount === undefined ? 1 : amount));
    s.sinceHurt = 0;
    s.regen = 0;
    return { hearts: s.hearts, down: s.hearts === 0 };
  }

  function heal(s, amount) {
    const before = s.hearts;
    s.hearts = Math.min(MAX_HEARTS, s.hearts + amount);
    return s.hearts - before;
  }

  function revive(s) {
    s.hearts = MAX_HEARTS;
    s.deaths += 1;
    s.sinceHurt = 99;
  }

  // Out of danger for a while, hearts slowly come back. Returns true when one does.
  function tickRegen(s, dt) {
    s.sinceHurt += dt;
    if (s.hearts <= 0 || s.hearts >= MAX_HEARTS || s.sinceHurt < 8) return false;
    s.regen += dt;
    if (s.regen < 10) return false;
    s.regen = 0;
    s.hearts += 1;
    return true;
  }

  function addMeat(s, amount) {
    s.meat += amount;
    s.hunts += 1;
  }

  // Eats one piece of meat. Returns 'ate', 'none' (no meat) or 'full' (not hurt).
  function eatMeat(s) {
    if (s.meat <= 0) return 'none';
    if (s.hearts >= MAX_HEARTS) return 'full';
    s.meat -= 1;
    heal(s, MEAT_HEALS);
    return 'ate';
  }

  // ---------- weapons ----------

  function ownedWeapons(s) {
    return WEAPON_ORDER.filter((id) => s.weapons[id] > 0);
  }

  function weaponDamage(s, id) {
    const level = Math.max(1, s.weapons[id] || 1);
    const list = WEAPONS[id].damage;
    return list[Math.min(level, list.length) - 1];
  }

  function selectWeapon(s, id) {
    if (!WEAPONS[id] || !s.weapons[id]) return false;
    s.weapon = id;
    return true;
  }

  function cycleWeapon(s) {
    const owned = ownedWeapons(s);
    s.weapon = owned[(owned.indexOf(s.weapon) + 1) % owned.length];
    return s.weapon;
  }

  // What a beaten monster leaves behind: 'sword', 'axe', 'blaster', 'heart'
  // or null. `luck` comes from the monster, `roll` is a number 0..1. The
  // first sword and axe are promised after a few fights; the blaster is rare.
  function rollDrop(s, luck, roll) {
    s.kills += 1;
    for (const [id, after] of [['sword', 3], ['axe', 10], ['blaster', 45]]) {
      if (!s.weapons[id] && !s.promised[id] && s.kills >= after) {
        s.promised[id] = true; // dropped once; if it is left behind, luck takes over
        return id;
      }
    }
    const blaster = 0.022 * luck;
    const axe = blaster + 0.07 * luck;
    const sword = axe + 0.11 * luck;
    let drop = null;
    if (roll < blaster) drop = 'blaster';
    else if (roll < axe) drop = 'axe';
    else if (roll < sword) drop = 'sword';
    else if (roll < sword + 0.2) drop = 'heart';
    // A weapon that is already as good as it gets turns into a heart.
    if (drop && drop !== 'heart' && s.weapons[drop] >= MAX_LEVEL) drop = 'heart';
    return drop;
  }

  // Picking a weapon up: the first one is new, later ones make it stronger.
  function pickupWeapon(s, id) {
    if (!WEAPONS[id] || id === 'stick') return null;
    const isNew = s.weapons[id] === 0;
    if (s.weapons[id] < MAX_LEVEL) s.weapons[id] += 1;
    // Reach for a new weapon straight away if it beats the one in hand.
    if (isNew && WEAPON_ORDER.indexOf(id) > WEAPON_ORDER.indexOf(s.weapon)) s.weapon = id;
    return { id, isNew, level: s.weapons[id] };
  }

  // ---------- exploring ----------

  // Records landing on an island. Returns true the first time.
  function visitIsland(s, id) {
    if (s.islands.includes(id)) return false;
    s.islands.push(id);
    return true;
  }

  // Opens an island's chest. Returns the weapon inside, or null if it was
  // opened before (or there is no such chest).
  function openChest(s, id) {
    if (!CHESTS[id] || s.chests.includes(id)) return null;
    s.chests.push(id);
    return CHESTS[id];
  }

  function objective(s) {
    const chests = Object.keys(CHESTS).length;
    if (s.islands.length >= ISLAND_COUNT && s.chests.length >= chests) return 'Every island found and every chest opened. The sea is yours.';
    return 'Islands found: ' + s.islands.length + ' of ' + ISLAND_COUNT + '. Chests opened: ' + s.chests.length + ' of ' + chests + '.';
  }

  // ---------- day and night ----------

  function isNight(clock) {
    return clock >= NIGHT_START && clock < NIGHT_END;
  }

  // Moves the clock on. Returns 'dusk' or 'dawn' on the frame night starts or ends.
  function advanceClock(s, dt) {
    const before = isNight(s.clock);
    s.clock = (s.clock + dt / DAY_LENGTH) % 1;
    const after = isNight(s.clock);
    if (after && !before) return 'dusk';
    if (!after && before) return 'dawn';
    return null;
  }

  // Sleeping in the bed skips the night. Returns false in the daytime.
  function sleep(s) {
    if (!isNight(s.clock)) return false;
    s.clock = 0.02;
    s.hearts = MAX_HEARTS;
    return true;
  }

  // The sky: 0 = day, 1 = sunset or sunrise, 2 = night, and everything between.
  function moodAt(clock) {
    if (clock < 0.58) return 0;
    if (clock < 0.66) return (clock - 0.58) / 0.08;
    if (clock < 0.72) return 1 + (clock - 0.66) / 0.06;
    if (clock < 0.93) return 2;
    if (clock < 0.965) return 2 - (clock - 0.93) / 0.035;
    return 1 - (clock - 0.965) / 0.035;
  }

  // ---------- saving ----------

  function serialize(s) {
    return JSON.stringify(Object.assign({}, s, { promised: undefined }));
  }

  // Rebuilds a state from saved text. Returns null if the text is not a save.
  function restore(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return null;
    }
    if (!raw || typeof raw !== 'object' || !raw.weapons || !Array.isArray(raw.islands)) return null;
    const s = createState();
    const num = (v, lo, hi, fallback) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
    s.hearts = Math.round(num(raw.hearts, 1, MAX_HEARTS, MAX_HEARTS));
    s.meat = Math.round(num(raw.meat, 0, 9999, 0));
    for (const id of WEAPON_ORDER) s.weapons[id] = Math.round(num(raw.weapons[id], 0, MAX_LEVEL, 0));
    s.weapons.stick = 1;
    s.weapon = s.weapons[raw.weapon] ? raw.weapon : 'stick';
    const known = ['home'].concat(Object.keys(CHESTS));
    s.islands = known.filter((id) => id === 'home' || raw.islands.includes(id));
    s.chests = Object.keys(CHESTS).filter((id) => Array.isArray(raw.chests) && raw.chests.includes(id));
    s.readNote = !!raw.readNote;
    s.kills = Math.round(num(raw.kills, 0, 1e6, 0));
    s.hunts = Math.round(num(raw.hunts, 0, 1e6, 0));
    s.deaths = Math.round(num(raw.deaths, 0, 1e6, 0));
    s.elapsed = num(raw.elapsed, 0, 1e8, 0);
    s.clock = num(raw.clock, 0, 0.9999, 0.14);
    return s;
  }

  Object.assign(exports, {
    MAX_HEARTS, DAY_LENGTH, NIGHT_START, NIGHT_END, MAX_LEVEL, MEAT_HEALS, WEAPONS, WEAPON_ORDER, CHESTS, ISLAND_COUNT,
    createState, hurt, heal, revive, tickRegen, addMeat, eatMeat,
    ownedWeapons, weaponDamage, selectWeapon, cycleWeapon, rollDrop, pickupWeapon,
    visitIsland, openChest, objective, isNight, advanceClock, sleep, moodAt, serialize, restore,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.WS = window.WS || {}).Rules = {}));
