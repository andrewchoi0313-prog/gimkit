// Quest rules for Beacon Isle: hearts, coins, lens shards, the rune puzzle,
// the vault gate, the trade and what each islander says.
// No DOM or 3D code here, so it runs in the browser and under `node --test`.
(function (exports) {
  'use strict';

  const SHARDS = ['grove', 'peak', 'vault', 'runes', 'trader'];
  const RUNE_ORDER = ['sun', 'moon', 'star'];
  const SHARD_PRICE = 20;
  const MAX_HEARTS = 5;
  const GROVE_GUARDS = 4;

  const SHARD_HINTS = {
    grove: 'One fell into Whisperwood, west of the Stone Ring. Gloomlings have gathered around it.',
    peak: 'One landed on the spire at the top of Mount Kestrel, to the north.',
    vault: 'One dropped inside the Old Vault in the east. Its gate needs a key.',
    runes: 'One sank under the Stone Ring in the middle of the isle. The tablet there tells how to wake it.',
    trader: 'Pip the trader picked one up. Pip camps west of the crossroads and loves coins.',
  };

  function createState() {
    return {
      hearts: MAX_HEARTS,
      coins: 0,
      shards: [],          // ids from SHARDS, in the order they were found
      hasKey: false,
      chestOpen: false,
      gateOpen: false,
      runeProgress: [],    // runes woken so far, in order
      runesSolved: false,
      groveDefeated: 0,
      defeated: 0,
      faints: 0,
      metKeeper: false,
      beaconLit: false,
      taken: {},           // ids of pickups already collected
      gone: {},            // ids of gloomlings already defeated
      elapsed: 0,          // seconds played
    };
  }

  // ---------- shards ----------

  function shardCount(s) {
    return s.shards.length;
  }

  function hasShard(s, id) {
    return s.shards.includes(id);
  }

  function collectShard(s, id) {
    if (!SHARDS.includes(id) || hasShard(s, id)) return false;
    s.shards.push(id);
    return true;
  }

  function missingShards(s) {
    return SHARDS.filter((id) => !hasShard(s, id));
  }

  // ---------- pickups and hearts ----------

  // Marks a pickup as taken. Returns false if it was taken before.
  function takePickup(s, id, kind) {
    if (s.taken[id]) return false;
    s.taken[id] = true;
    if (kind === 'coin') s.coins += 1;
    if (kind === 'heart') s.hearts = Math.min(MAX_HEARTS, s.hearts + 2);
    return true;
  }

  // Coins dropped by gloomlings are not tracked by id.
  function addCoins(s, amount) {
    s.coins += amount;
  }

  function hurt(s, amount) {
    s.hearts = Math.max(0, s.hearts - (amount === undefined ? 1 : amount));
    return { hearts: s.hearts, fainted: s.hearts === 0 };
  }

  function revive(s) {
    s.hearts = MAX_HEARTS;
    s.faints += 1;
  }

  // ---------- gloomlings ----------

  function defeat(s, id, group) {
    if (s.gone[id]) return { groveCleared: groveCleared(s), justCleared: false };
    const before = groveCleared(s);
    s.gone[id] = true;
    s.defeated += 1;
    if (group === 'grove') s.groveDefeated += 1;
    return { groveCleared: groveCleared(s), justCleared: !before && groveCleared(s) };
  }

  function groveCleared(s) {
    return s.groveDefeated >= GROVE_GUARDS;
  }

  // ---------- rune puzzle ----------

  // Returns 'progress', 'solved', 'wrong' (the stones reset) or 'ignored'.
  function pressRune(s, rune) {
    if (s.runesSolved || !RUNE_ORDER.includes(rune)) return 'ignored';
    if (s.runeProgress.includes(rune)) return 'ignored';
    if (RUNE_ORDER[s.runeProgress.length] !== rune) {
      s.runeProgress = [];
      return 'wrong';
    }
    s.runeProgress.push(rune);
    if (s.runeProgress.length === RUNE_ORDER.length) {
      s.runesSolved = true;
      return 'solved';
    }
    return 'progress';
  }

  // ---------- chest, gate, trade ----------

  function openChest(s) {
    if (s.chestOpen) return false;
    s.chestOpen = true;
    s.hasKey = true;
    return true;
  }

  // Returns 'opened', 'locked' or 'already'.
  function tryGate(s) {
    if (s.gateOpen) return 'already';
    if (!s.hasKey) return 'locked';
    s.gateOpen = true;
    return 'opened';
  }

  function canBuyShard(s) {
    return !hasShard(s, 'trader') && s.coins >= SHARD_PRICE;
  }

  function buyShard(s) {
    if (!canBuyShard(s)) return false;
    s.coins -= SHARD_PRICE;
    return collectShard(s, 'trader');
  }

  // ---------- the beacon ----------

  function canLightBeacon(s) {
    return !s.beaconLit && shardCount(s) === SHARDS.length;
  }

  function lightBeacon(s) {
    if (!canLightBeacon(s)) return false;
    s.beaconLit = true;
    return true;
  }

  // One line telling the player what to do next.
  function objective(s) {
    if (s.beaconLit) return 'The beacon is lit. Explore as long as you like.';
    if (!s.metKeeper) return 'Find the keeper at the lighthouse.';
    const n = shardCount(s);
    if (n === SHARDS.length) return 'Take the shards to the lighthouse door.';
    if (s.hasKey && !s.gateOpen) return 'Find the lens shards. Your key may fit the Old Vault.';
    return 'Find the lens shards scattered across the isle.';
  }

  // ---------- what people say ----------
  // Each returns { speaker, lines, effect }. The effect, if any, is applied
  // with applyEffect() once the player has read the lines.

  function keeperTalk(s) {
    const speaker = 'Odell the keeper';
    if (!s.metKeeper) {
      return {
        speaker,
        lines: [
          'You made it ashore! I am Odell, keeper of this light.',
          'Last night\'s storm cracked the beacon\'s lens. Five shards of it fell across the isle.',
          'Without the beam, ships cannot find the harbour after dark. Will you bring the shards back?',
          'I marked where I saw them fall on your map. Gloomlings crept out when the light died, so keep your lantern staff ready.',
        ],
        effect: 'meetKeeper',
      };
    }
    if (s.beaconLit) {
      return { speaker, lines: ['Look at her shine. The ships will be home tonight because of you.'] };
    }
    const missing = missingShards(s);
    if (missing.length === 0) {
      return { speaker, lines: ['All five! Set them in the lamp. The lighthouse door is right behind me.'] };
    }
    const n = shardCount(s);
    return {
      speaker,
      lines: [n === 0 ? 'No shards yet. The first is always the hardest.' : n + ' of 5 shards so far.', SHARD_HINTS[missing[0]]],
    };
  }

  function traderTalk(s) {
    const speaker = 'Pip the trader';
    if (hasShard(s, 'trader')) {
      return { speaker, lines: ['Pleasure doing business. Mind the gloomlings!'] };
    }
    if (canBuyShard(s)) {
      return {
        speaker,
        lines: [SHARD_PRICE + ' coins! A deal is a deal.', 'Here you go: one glowing shard, slightly sandy.'],
        effect: 'buyShard',
      };
    }
    return {
      speaker,
      lines: [
        'Psst. I found a glowing shard on the beach.',
        'It is yours for ' + SHARD_PRICE + ' coins. You have ' + s.coins + '.',
        'Coins turn up along the paths, and gloomlings drop them too.',
      ],
    };
  }

  function fisherTalk(s) {
    const speaker = 'Bram the fisher';
    if (!s.chestOpen) {
      return {
        speaker,
        lines: [
          'The tide left my old sea chest on that islet.',
          'Hop across the stones if you dare. Whatever is inside is yours.',
        ],
      };
    }
    if (!s.gateOpen) {
      return { speaker, lines: ['A key, was it? I would bet it fits the Old Vault in the east.'] };
    }
    return { speaker, lines: ['The fish are not biting. Too much glowing going on.'] };
  }

  function hikerTalk(s) {
    const speaker = 'Juniper the hiker';
    if (!hasShard(s, 'peak')) {
      return {
        speaker,
        lines: [
          'Phew. The spire on top of Mount Kestrel is a proper climb.',
          'Hold Shift to run and press Space to jump. I saw something glitter at the very top.',
        ],
      };
    }
    return { speaker, lines: ['You climbed the spire? I am impressed, and a bit jealous.'] };
  }

  function applyEffect(s, effect) {
    if (effect === 'meetKeeper') {
      s.metKeeper = true;
      return true;
    }
    if (effect === 'buyShard') return buyShard(s);
    return false;
  }

  // ---------- saving ----------

  function serialize(s) {
    return JSON.stringify(s);
  }

  // Rebuilds a state from saved text. Returns null if the text is not a save.
  function restore(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return null;
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.shards)) return null;
    const s = createState();
    const num = (v, lo, hi, fallback) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
    s.hearts = Math.round(num(raw.hearts, 1, MAX_HEARTS, MAX_HEARTS));
    s.coins = Math.round(num(raw.coins, 0, 9999, 0));
    s.shards = SHARDS.filter((id) => raw.shards.includes(id));
    s.shards.sort((a, b) => raw.shards.indexOf(a) - raw.shards.indexOf(b));
    s.hasKey = !!raw.hasKey;
    s.chestOpen = !!raw.chestOpen;
    s.gateOpen = !!raw.gateOpen;
    s.runesSolved = !!raw.runesSolved;
    s.runeProgress = s.runesSolved ? RUNE_ORDER.slice() : [];
    s.groveDefeated = Math.round(num(raw.groveDefeated, 0, GROVE_GUARDS, 0));
    s.defeated = Math.round(num(raw.defeated, 0, 9999, 0));
    s.faints = Math.round(num(raw.faints, 0, 9999, 0));
    s.metKeeper = !!raw.metKeeper;
    s.beaconLit = !!raw.beaconLit && s.shards.length === SHARDS.length;
    s.elapsed = num(raw.elapsed, 0, 1e7, 0);
    for (const key of ['taken', 'gone']) {
      if (raw[key] && typeof raw[key] === 'object') {
        for (const id of Object.keys(raw[key])) if (raw[key][id]) s[key][id] = true;
      }
    }
    return s;
  }

  Object.assign(exports, {
    SHARDS, RUNE_ORDER, SHARD_PRICE, MAX_HEARTS, GROVE_GUARDS, SHARD_HINTS,
    createState, shardCount, hasShard, collectShard, missingShards,
    takePickup, addCoins, hurt, revive, defeat, groveCleared, pressRune,
    openChest, tryGate, canBuyShard, buyShard, canLightBeacon, lightBeacon,
    objective, keeperTalk, traderTalk, fisherTalk, hikerTalk, applyEffect,
    serialize, restore,
  });
})(typeof module !== 'undefined' ? module.exports : ((window.BI = window.BI || {}).Rules = {}));
