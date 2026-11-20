// The rules of Riftstead: hearts, weapons and what monsters drop, rift
// crystals, the fortress seal, the day and night clock, what Wren says, and
// saving. No DOM or 3D code here, so it runs under `node --test`.
(function (exports) {
  'use strict';

  const MAX_HEARTS = 6;
  const CRYSTALS = ['ember', 'frost', 'cloud'];
  const BOSS_HP = 70;
  const DAY_LENGTH = 420;      // seconds for a full day and night
  const NIGHT_START = 0.7;     // the clock runs 0..1; night is this slice of it
  const NIGHT_END = 0.95;
  const MAX_LEVEL = 3;

  // damage is listed per level. arc is how far round the swing reaches:
  // 1 = only straight ahead, -1 = all the way round.
  const WEAPONS = {
    stick: { name: 'Stick', damage: [1], reach: 2.6, time: 0.38, arc: 0.2, knock: 9, ranged: false },
    sword: { name: 'Sword', damage: [2, 3, 4], reach: 3.0, time: 0.3, arc: 0.1, knock: 9, ranged: false },
    axe: { name: 'Axe', damage: [4, 5, 7], reach: 3.3, time: 0.58, arc: -0.4, knock: 15, ranged: false },
    blaster: { name: 'Blaster', damage: [3, 4, 5], reach: 38, time: 0.42, arc: 0.5, knock: 6, ranged: true },
  };
  const WEAPON_ORDER = ['stick', 'sword', 'axe', 'blaster'];

  const CRYSTAL_HINTS = {
    ember: 'The desert portal in the east leads to Ember Deep. Its crystal sits inside a ring of lava.',
    frost: 'The portal in the snowy hills to the north leads to Frost Hollow. Its crystal stands on an ice pillar in the frozen lake.',
    cloud: 'The portal on Windy Tor, in the western forest, leads to the Cloud Garden. Its crystal is on the last island.',
  };

  function createState() {
    return {
      hearts: MAX_HEARTS,
      weapons: { stick: 1, sword: 0, axe: 0, blaster: 0 },   // level of each weapon; 0 = not found yet
      weapon: 'stick',                                       // the one in hand
      crystals: [],
      bossDown: false,
      metWren: false,
      kills: 0,
      deaths: 0,
      placed: 0,           // blocks placed, for the stats
      elapsed: 0,          // seconds played
      clock: 0.14,         // time of day, 0..1. The game starts in the morning.
      sinceHurt: 99,       // seconds since the last hit
      regen: 0,
      promised: {},        // weapons already handed out by the promise below (not saved)
    };
  }

  // ---------- hearts ----------

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

  // What a defeated monster leaves behind: 'sword', 'axe', 'blaster',
  // 'heart' or null. `luck` comes from the monster, `roll` is a number 0..1.
  // The first sword and axe are promised after a few fights, so nobody is
  // stuck with the stick; the blaster stays rare.
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

  // ---------- crystals and the giant ----------

  function hasCrystal(s, id) {
    return s.crystals.includes(id);
  }

  function collectCrystal(s, id) {
    if (!CRYSTALS.includes(id) || hasCrystal(s, id)) return false;
    s.crystals.push(id);
    return true;
  }

  function missingCrystals(s) {
    return CRYSTALS.filter((id) => !hasCrystal(s, id));
  }

  function sealBroken(s) {
    return s.crystals.length === CRYSTALS.length;
  }

  function defeatBoss(s) {
    if (s.bossDown) return false;
    s.bossDown = true;
    return true;
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

  // The sky: 0 = day, 1 = sunset or sunrise, 2 = night, and everything between.
  function moodAt(clock) {
    if (clock < 0.58) return 0;
    if (clock < 0.66) return (clock - 0.58) / 0.08;
    if (clock < 0.72) return 1 + (clock - 0.66) / 0.06;
    if (clock < 0.93) return 2;
    if (clock < 0.965) return 2 - (clock - 0.93) / 0.035;
    return 1 - (clock - 0.965) / 0.035;
  }

  // ---------- guidance ----------

  function objective(s) {
    if (s.bossDown) return 'The giant is beaten. Build and explore as you like.';
    if (!s.metWren) return 'Talk to Wren at the homestead.';
    if (sealBroken(s)) return 'The seal is broken. Face the giant in the north-east fortress.';
    return 'Find the portals and bring back the rift crystals.';
  }

  // What Wren says. `touch` picks the wording for a touch screen.
  function wrenTalk(s, touch) {
    const speaker = 'Wren the wayfinder';
    if (!s.metWren) {
      return {
        speaker,
        lines: [
          'Welcome to the Stead! I am Wren. This flat patch of meadow is yours to build on.',
          touch
            ? 'Tap Build to start building. Pick a block, then tap where it should go. You never run out.'
            : 'Press B to start building. Pick a block with the number keys, then click where it should go. You never run out.',
          'Get some walls up before dark. Monsters come out at night, and they cannot get through blocks.',
          'Three portals hide in this land: in the eastern desert, in the snowy hills to the north, and on Windy Tor in the western forest.',
          'Each leads to a world that holds a rift crystal. Bring back all three and the seal on the giant\'s fortress will break. I have marked them on your map.',
        ],
        effect: 'meetWren',
      };
    }
    if (s.bossDown) {
      return { speaker, lines: ['You toppled the giant! The Stead is safe. Now, how about a tower?'] };
    }
    if (sealBroken(s)) {
      return { speaker, lines: ['All three crystals! The seal is broken.', 'The giant waits in the fortress to the north-east. Take your best weapon, and jump when it stomps.'] };
    }
    const lines = [s.crystals.length + ' of 3 crystals so far.', CRYSTAL_HINTS[missingCrystals(s)[0]]];
    if (!s.weapons.sword) lines.push('That stick will not do for long. Monsters drop swords and axes, so keep swinging.');
    return { speaker, lines };
  }

  function applyEffect(s, effect) {
    if (effect === 'meetWren') {
      s.metWren = true;
      return true;
    }
    return false;
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
    if (!raw || typeof raw !== 'object' || !raw.weapons || !Array.isArray(raw.crystals)) return null;
    const s = createState();
    const num = (v, lo, hi, fallback) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
    s.hearts = Math.round(num(raw.hearts, 1, MAX_HEARTS, MAX_HEARTS));
    for (const id of WEAPON_ORDER) s.weapons[id] = Math.round(num(raw.weapons[id], 0, MAX_LEVEL, 0));
    s.weapons.stick = 1;
    s.weapon = s.weapons[raw.weapon] ? raw.weapon : 'stick';
    s.crystals = CRYSTALS.filter((id) => raw.crystals.includes(id));
    s.bossDown = !!raw.bossDown && sealBroken(s);
    s.metWren = !!raw.metWren;
    s.kills = Math.round(num(raw.kills, 0, 1e6, 0));
    s.deaths = Math.round(num(raw.deaths, 0, 1e6, 0));
    s.placed = Math.round(num(raw.placed, 0, 1e7, 0));
    s.elapsed = num(raw.elapsed, 0, 1e8, 0);
    s.clock = num(raw.clock, 0, 0.9999, 0.14);
    return s;
  }

  Object.assign(exports, {
    MAX_HEARTS, CRYSTALS, BOSS_HP, DAY_LENGTH, NIGHT_START, NIGHT_END, MAX_LEVEL, WEAPONS, WEAPON_ORDER, CRYSTAL_HINTS,
    createState, hurt, heal, revive, tickRegen,
    ownedWeapons, weaponDamage, selectWeapon, cycleWeapon, rollDrop, pickupWeapon,
    hasCrystal, collectCrystal, missingCrystals, sealBroken, defeatBoss,
    isNight, advanceClock, moodAt, objective, wrenTalk, applyEffect, serialize, restore,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.RS = window.RS || {}).Rules = {}));
