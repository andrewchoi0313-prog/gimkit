// The game itself: the loop, the player's movement, gloomlings, pickups,
// conversations and the quest, wired to the 3D world and the screen.
(function () {
  'use strict';

  const BI = window.BI;
  const { Island, Rules, Actors, World, Input, Sound, UI } = BI;
  const P = Island.PLACES;

  const SAVE_KEY = 'beacon-isle-save-v1';
  const WALK = 6.5;
  const RUN = 10.5;
  const JUMP = 9;          // upward speed at take-off
  const GRAVITY = 24;
  const RADIUS = 0.45;     // the player is a cylinder this wide...
  const HEIGHT = 1.8;      // ...and this tall
  const STEP_UP = 0.55;    // ledges lower than this are walked up
  const SWING_TIME = 0.4;
  const DEEP_WATER = -1.3;

  const canvas = document.getElementById('scene');
  const startBtn = document.getElementById('start-btn');
  const newBtn = document.getElementById('new-btn');

  let renderer = null;
  try {
    if (!window.THREE) throw new Error('3D library missing');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    UI.setNote('This game needs WebGL, and this browser has it switched off.');
    startBtn.disabled = true;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2400);
  const terrain = Island.buildTerrain();
  const layout = Island.buildLayout(terrain);
  const heightAt = terrain.heightAt;
  const world = World.build(scene, terrain, layout);
  const solids = world.solids;
  const particles = Actors.makeParticles(scene, 90);
  const input = Input.create(canvas);
  const minimap = UI.createMinimap(terrain);

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Turns angle `from` towards `to` by at most `step`, the short way round.
  function turnToward(from, to, step) {
    const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return Math.abs(diff) <= step ? to : from + Math.sign(diff) * step;
  }

  // ---------- who and what is on the island ----------

  const hero = Actors.makeFigure({ coat: 0x1f8f8a, scarf: 0xd9432f, pack: 0x8a5f3c, staff: true });
  scene.add(hero.group);

  function islander(spot, look, faces) {
    const figure = Actors.makeFigure(look);
    figure.group.position.set(spot.x, heightAt(spot.x, spot.z), spot.z);
    figure.home = Math.atan2(faces.x - spot.x, faces.z - spot.z);
    figure.group.rotation.y = figure.home;
    figure.spot = spot;
    scene.add(figure.group);
    solids.push({ kind: 'cyl', x: spot.x, z: spot.z, r: 0.5, y0: -50, y1: 1e6, on: true });
    return figure;
  }
  const keeper = islander(world.spots.keeper, { coat: 0x27456b, legs: 0x2b2f3a, hat: 'souwester', hatColor: 0xf2c23a, beard: true }, P.start);
  const trader = islander(world.spots.trader, { coat: 0x8a4f9e, legs: 0x4a3a2a, hat: 'brim', hatColor: 0x2f8f86, skin: 0xd9a57a }, P.crossroads);
  const fisher = islander(world.spots.fisher, { coat: 0x6b7f3a, legs: 0x4f5a66, hat: 'bucket', hatColor: 0x3f6fa8, skin: 0xe6b48a, rod: true }, P.islet);
  const hiker = islander(world.spots.hiker, { coat: 0xe2813a, legs: 0x3b4a3a, hat: 'beanie', hatColor: 0xc23b3b, pack: 0x4f8a4a, skin: 0xc98f66 }, P.ring);
  const islanders = [keeper, trader, fisher, hiker];
  const keeperMark = Actors.makeMarker();
  keeperMark.position.y = 2.75;
  keeper.group.add(keeperMark);

  const pickups = [];
  function addPickup(id, kind, x, y, z) {
    const mesh = kind === 'coin' ? Actors.makeCoin() : Actors.makeHeart();
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const p = { id, kind, x, y, z, homeX: x, homeY: y, homeZ: z, mesh, taken: false, drop: false, settled: true, vx: 0, vy: 0, vz: 0, phase: x * 0.7 + z };
    pickups.push(p);
    return p;
  }
  for (const c of layout.coins) addPickup(c.id, 'coin', c.x, c.y, c.z);
  for (const h of layout.hearts) addPickup(h.id, 'heart', h.x, h.y, h.z);

  const shards = {};
  for (const id of Object.keys(world.spots.shards)) {
    const at = world.spots.shards[id];
    const made = Actors.makeShard();
    made.group.position.set(at.x, at.y, at.z);
    scene.add(made.group);
    shards[id] = { id, x: at.x, y: at.y, z: at.z, group: made.group, crystal: made.crystal, active: true, rise: 1 };
  }

  const glooms = layout.gloomlings.map((g) => {
    const mesh = Actors.makeGloomling();
    scene.add(mesh.group);
    return { id: g.id, team: g.group, homeX: g.x, homeZ: g.z, x: g.x, y: g.y, z: g.z, mesh, hp: 2, alive: true, hop: null, wait: Math.random() * 1.5, hurt: 0, kx: 0, kz: 0, dying: 0, face: 0, squash: 0, chasing: false };
  });

  // ---------- game state ----------

  let state = Rules.createState();
  let mode = 'title';      // title, play, talk, pause, fade, finale, won
  let time = 0;
  let dirty = false;       // true when there is progress to save
  let saveClock = 0;
  let mapClock = 0;
  let nagClock = 0;        // stops the same warning repeating every frame
  let dropCount = 0;
  let fade = null;         // { t, action, done }
  let finale = null;
  let nearest = null;      // the thing the E key would use right now
  let swingTipShown = false;

  const player = {
    x: P.start.x, y: 0, z: P.start.z,
    vx: 0, vy: 0, vz: 0,
    heading: Math.PI,       // facing north, away from the sea
    onGround: true,
    coyote: 0, jumpBuffer: 0,
    swing: -1, swingHit: false, swingRest: 0,
    invuln: 0,
    safeX: P.start.x, safeZ: P.start.z, safeClock: 0,
  };
  const cam = { yaw: 0, pitch: 0.4, dist: 9.5, x: 0, y: 0, z: 0 };
  const mood = { now: 0, target: 0 };
  const quality = { level: 0, sum: 0, frames: 0 };
  const TITLE_FOCUS = { x: 0, y: 5, z: 20 };
  const BEACON_FOCUS = { x: P.lighthouse.x, y: 6, z: P.lighthouse.z };

  // ---------- collisions ----------

  // The height of whatever is under (x, z): the ground or the top of a solid.
  // Only tops the feet are above (or within a step of) count.
  function groundAt(x, z, feetY) {
    let top = heightAt(x, z);
    for (const s of solids) {
      if (!s.on || s.y1 > 1e5 || s.y1 <= top || feetY < s.y1 - STEP_UP) continue;
      if (s.kind === 'cyl') {
        const dx = x - s.x, dz = z - s.z, r = s.r + 0.15;
        if (dx * dx + dz * dz > r * r) continue;
      } else if (x < s.x0 - 0.15 || x > s.x1 + 0.15 || z < s.z0 - 0.15 || z > s.z1 + 0.15) {
        continue;
      }
      top = s.y1;
    }
    return top;
  }

  // Moves point p out of any solid whose side it is touching.
  function pushOut(p, feetY, radius, height) {
    for (const s of solids) {
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
      } else {
        const cx = clamp(p.x, s.x0, s.x1), cz = clamp(p.z, s.z0, s.z1);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * radius;
          p.z = cz + (dz / d) * radius;
        } else {
          // The centre is inside the box: leave by the nearest side.
          const left = p.x - s.x0, right = s.x1 - p.x, back = p.z - s.z0, front = s.z1 - p.z;
          const least = Math.min(left, right, back, front);
          if (least === left) p.x = s.x0 - radius;
          else if (least === right) p.x = s.x1 + radius;
          else if (least === back) p.z = s.z0 - radius;
          else p.z = s.z1 + radius;
        }
      }
    }
  }

  // The underside of a solid just above the head, or Infinity.
  function ceilingAt(x, z, headY) {
    let low = Infinity;
    for (const s of solids) {
      if (!s.on || s.y0 < headY - 0.05 || s.y0 >= low) continue;
      if (s.kind === 'cyl') {
        const dx = x - s.x, dz = z - s.z;
        if (dx * dx + dz * dz > s.r * s.r) continue;
      } else if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) {
        continue;
      }
      low = s.y0;
    }
    return low;
  }

  function placePlayer(x, z, heading) {
    player.x = x;
    player.z = z;
    player.y = groundAt(x, z, 1e4);
    player.vx = player.vy = player.vz = 0;
    player.onGround = true;
    player.swing = -1;
    player.safeX = x;
    player.safeZ = z;
    if (heading !== undefined) {
      player.heading = heading;
      cam.yaw = heading + Math.PI; // behind the player
    }
    cam.x = x;
    cam.y = player.y + 1.5;
    cam.z = z;
    hero.group.position.set(player.x, player.y, player.z);
    hero.group.rotation.y = player.heading;
  }

  // ---------- saving ----------

  function save() {
    dirty = false;
    saveClock = 0;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: Rules.serialize(state), pos: [player.safeX, player.safeZ], heading: player.heading }));
    } catch (err) { /* storage can be blocked: the game still plays */ }
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!raw || raw.v !== 1) return null;
      const saved = Rules.restore(raw.state);
      if (!saved) return null;
      const ok = Array.isArray(raw.pos) && raw.pos.length === 2 && raw.pos.every(Number.isFinite) && heightAt(raw.pos[0], raw.pos[1]) > -1;
      return { state: saved, pos: ok ? raw.pos : null, heading: Number.isFinite(raw.heading) ? raw.heading : Math.PI };
    } catch (err) {
      return null;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* nothing to clear */ }
  }

  // ---------- keeping the world in step with the state ----------

  const moodFor = (s) => (s.beaconLit ? 2 : Rules.shardCount(s) / Rules.SHARDS.length);

  function refreshHud() {
    UI.setHearts(state.hearts, Rules.MAX_HEARTS);
    UI.setCounts(Rules.shardCount(state), state.coins, state.hasKey && !state.gateOpen);
    UI.setObjective(Rules.objective(state));
  }

  // Sets every object in the world to match `state`: used for a new game and a loaded one.
  function syncWorld() {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (p.drop) {
        scene.remove(p.mesh);
        pickups.splice(i, 1);
        continue;
      }
      p.taken = !!state.taken[p.id];
      p.mesh.visible = !p.taken;
      p.x = p.homeX;
      p.y = p.homeY;
      p.z = p.homeZ;
    }
    for (const id of Object.keys(shards)) {
      const s = shards[id];
      s.active = !Rules.hasShard(state, id) && (id !== 'runes' || state.runesSolved);
      s.group.visible = s.active;
      s.rise = 1;
    }
    for (const g of glooms) {
      g.alive = !state.gone[g.id] && !state.beaconLit;
      g.hp = 2;
      g.x = g.homeX;
      g.z = g.homeZ;
      g.y = heightAt(g.x, g.z);
      g.hop = null;
      g.hurt = 0;
      g.dying = 0;
      g.mesh.group.visible = g.alive;
      g.mesh.group.scale.setScalar(1);
      g.mesh.group.position.set(g.x, g.y, g.z);
      g.mesh.mat.emissive.setHex(0x1a0f2e);
    }
    world.setGate(state.gateOpen, true);
    world.setChest(state.chestOpen, false);
    world.setRunes(state.runeProgress, false);
    world.setBeacon(state.beaconLit);
    world.setSeal(!Rules.groveCleared(state) && !Rules.hasShard(state, 'grove'));
    mood.now = mood.target = moodFor(state);
    world.setMood(mood.now);
    keeperMark.visible = !state.metKeeper;
    UI.closeTalk();
    UI.setPrompt(null);
    refreshHud();
  }

  // ---------- starting, pausing, fading ----------

  function begin(saved) {
    Sound.init();
    state = saved ? saved.state : Rules.createState();
    syncWorld();
    if (saved && saved.pos) placePlayer(saved.pos[0], saved.pos[1], saved.heading);
    else placePlayer(P.start.x, P.start.z, Math.PI);
    player.invuln = 0;
    finale = null;
    fade = null;
    UI.setFade(false);
    UI.show('title', false);
    UI.show('win', false);
    UI.show('pause', false);
    UI.setHud(true);
    mode = 'play';
    if (!saved) {
      UI.toast('You have washed ashore on Beacon Isle.', 3600);
      save();
    }
    focusScene();
  }

  // Keeps the keyboard on the scene, so Space jumps instead of pressing
  // whichever button was clicked last.
  function focusScene() {
    if (document.activeElement && document.activeElement !== canvas && document.activeElement.blur) document.activeElement.blur();
    canvas.focus({ preventScroll: true });
  }

  function setPaused(on) {
    if (on && mode !== 'play') return;
    if (!on && mode !== 'pause') return;
    mode = on ? 'pause' : 'play';
    UI.show('pause', on);
    restartBtn.textContent = 'Start over';
    restartArmed = false;
    if (on) save();
    else focusScene();
  }

  // Fades to dark, runs `action`, and fades back in.
  function fadeThrough(action) {
    mode = 'fade';
    fade = { t: 0, action };
    UI.setFade(true);
    UI.setPrompt(null);
  }

  function updateFade(dt) {
    fade.t += dt;
    if (fade.action && fade.t > 0.4) {
      fade.action();
      fade.action = null;
      UI.setFade(false);
    }
    if (!fade.action && fade.t > 0.7) {
      fade = null;
      if (mode === 'fade') mode = 'play';
    }
  }

  function warn(text) {
    if (nagClock > 0) return;
    nagClock = 3.2;
    UI.toast(text, 3000);
  }

  // ---------- quest events ----------

  function say(talk, figure) {
    mode = 'talk';
    player.vx = player.vz = 0;
    if (figure) player.heading = Math.atan2(figure.spot.x - player.x, figure.spot.z - player.z);
    Sound.blip();
    UI.talk(talk.speaker, talk.lines, () => {
      mode = 'play';
      if (talk.effect) {
        const worked = Rules.applyEffect(state, talk.effect);
        if (talk.effect === 'meetKeeper') {
          keeperMark.visible = false;
          UI.toast('The shards are marked on your map.', 3400);
        }
        if (talk.effect === 'buyShard' && worked) gotShard();
        refreshHud();
        dirty = true;
      }
    });
  }

  function gotShard() {
    const count = Rules.shardCount(state);
    Sound.shard();
    particles.burst(player.x, player.y + 1.3, player.z, 0x9ff3ff, 20, 5, 1, 3);
    UI.toast(count === Rules.SHARDS.length ? 'All five shards! Take them to the lighthouse.' : 'Lens shard found. ' + count + ' of 5.', 3600);
    mood.target = moodFor(state);
    refreshHud();
    save();
  }

  function pressRune(kind) {
    const result = Rules.pressRune(state, kind);
    if (result === 'ignored') return;
    if (result === 'wrong') {
      Sound.wrong();
      world.setRunes([], true);
      UI.toast('The stones go dark. That was not the right order.', 3000);
      return;
    }
    Sound.rune();
    world.setRunes(state.runeProgress, false);
    const at = world.spots.runes[kind];
    particles.burst(at.x, heightAt(at.x, at.z) + 2.2, at.z, 0xffd66b, 12, 3, 0.9, 2);
    if (result === 'solved') {
      const s = shards.runes;
      s.active = true;
      s.group.visible = true;
      s.rise = 0;
      Sound.key();
      UI.toast('The altar hums. A shard rises out of the stone!', 3600);
    }
    dirty = true;
  }

  function openChest() {
    if (!Rules.openChest(state)) return;
    world.setChest(true, true);
    Sound.open();
    Sound.key();
    UI.toast('Inside the chest: the Vault key!', 3400);
    refreshHud();
    save();
  }

  function tryGate() {
    const result = Rules.tryGate(state);
    if (result === 'locked') {
      Sound.wrong();
      UI.toast('Locked tight. The keyhole is shaped like an anchor.', 3000);
    } else if (result === 'opened') {
      world.setGate(true, false);
      Sound.open();
      UI.toast('The key turns, and the gate sinks into the ground.', 3200);
      refreshHud();
      save();
    }
  }

  function tryBeacon() {
    if (!state.metKeeper) {
      UI.toast('The door is shut. The keeper is standing just beside it.', 3000);
    } else if (!Rules.canLightBeacon(state)) {
      UI.toast('The lamp needs all five shards. You have ' + Rules.shardCount(state) + '.', 3000);
    } else {
      Rules.lightBeacon(state);
      save();
      mode = 'finale';
      finale = { t: 0, lit: false, angle: Math.atan2(camera.position.x - P.lighthouse.x, camera.position.z - P.lighthouse.z), look: new THREE.Vector3(player.x, player.y + 1.5, player.z) };
      UI.setHud(false);
      UI.setPrompt(null);
      Sound.win();
    }
  }

  // Things the player can walk up to and use.
  const spots = [];
  function spot(at, reach, label, act) {
    spots.push({ x: at.x, z: at.z, y: heightAt(at.x, at.z), reach, label, act });
  }
  spot(world.spots.keeper, 3.2, () => 'Talk to Odell', () => say(Rules.keeperTalk(state), keeper));
  spot(world.spots.trader, 3.2, () => 'Talk to Pip', () => say(Rules.traderTalk(state), trader));
  spot(world.spots.fisher, 3.2, () => 'Talk to Bram', () => say(Rules.fisherTalk(state), fisher));
  spot(world.spots.hiker, 3.2, () => 'Talk to Juniper', () => say(Rules.hikerTalk(state), hiker));
  spot(world.spots.door, 2.4, () => (state.beaconLit ? null : Rules.canLightBeacon(state) ? 'Light the beacon' : 'Try the lighthouse door'), tryBeacon);
  spot(world.spots.chest, 2.4, () => (state.chestOpen ? null : 'Open the chest'), openChest);
  spot(world.spots.gate, 2.8, () => (state.gateOpen ? null : state.hasKey ? 'Unlock the gate' : 'Look at the gate'), tryGate);
  spot(world.spots.tablet, 2.6, () => 'Read the tablet', () => say({
    speaker: 'Stone tablet',
    lines: ['Wake the stones as the sky does.', 'First the one that starts the day. Then the one that rides the night. Last, the one that guides the lost at sea.'],
  }));
  for (const kind of Object.keys(world.spots.runes)) {
    spot(world.spots.runes[kind], 2.5, () => (state.runesSolved || state.runeProgress.includes(kind) ? null : 'Touch the ' + kind + ' stone'), () => pressRune(kind));
  }
  spot(world.spots.signs.beach, 2.4, () => 'Read the sign', () => say({ speaker: 'Signpost', lines: ['East along the beach: the lighthouse.', 'North: the crossroads and the Stone Ring.'] }));
  spot(world.spots.signs.crossroads, 2.4, () => 'Read the sign', () => say({ speaker: 'Signpost', lines: ['North: the Stone Ring. West: Pip\'s camp and the fishing shore.', 'South: the landing beach and the lighthouse.'] }));
  spot(world.spots.signs.ring, 2.4, () => 'Read the sign', () => say({ speaker: 'Signpost', lines: ['West: Whisperwood. East: the Old Vault.', 'North: Mount Kestrel. Mind the spire.'] }));

  // ---------- the player ----------

  function hurtPlayer(fromX, fromZ) {
    const result = Rules.hurt(state, 1);
    player.invuln = 1.4;
    const dx = player.x - fromX, dz = player.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    player.vx = (dx / d) * 9;
    player.vz = (dz / d) * 9;
    player.vy = 5.5;
    player.onGround = false;
    Sound.hurt();
    particles.burst(player.x, player.y + 1, player.z, 0xf0605d, 8, 4, 0.6);
    refreshHud();
    dirty = true;
    if (result.fainted) {
      fadeThrough(() => {
        Rules.revive(state);
        // Wake up at whichever resting place is closest.
        const rests = [P.start, P.crossroads, { x: P.ring.x, z: P.ring.z + 9 }, world.spots.keeper];
        let best = rests[0];
        for (const r of rests) {
          if (Island.dist(r.x, r.z, player.x, player.z) < Island.dist(best.x, best.z, player.x, player.z)) best = r;
        }
        placePlayer(best.x + 1.5, best.z + 1.5, player.heading);
        for (const g of glooms) {
          if (g.alive) {
            g.x = g.homeX;
            g.z = g.homeZ;
            g.hop = null;
          }
        }
        UI.toast('You fainted. A warm light led you somewhere safe.', 3600);
        refreshHud();
        save();
      });
    }
  }

  function updatePlayer(dt) {
    // Camera first, because movement is relative to where it looks.
    if (input.lookX || input.lookY) {
      cam.yaw -= input.lookX * 0.0062;
      cam.pitch = clamp(cam.pitch + input.lookY * 0.0042, 0.06, 1.3);
    } else if (player.onGround) {
      cam.yaw -= input.moveX * 0.7 * dt; // drift round behind the player
    }
    cam.yaw -= input.turn * 2.2 * dt;
    if (input.zoom) cam.dist = clamp(cam.dist + input.zoom * 1.2, 5, 17);

    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const mx = fx * input.moveY + rx * input.moveX;
    const mz = fz * input.moveY + rz * input.moveX;
    const push = Math.min(1, Math.hypot(mx, mz));

    const wading = player.onGround && player.y < -0.25;
    const top = (input.run ? RUN : WALK) * (wading ? 0.55 : 1);
    const grip = Math.min(1, (player.onGround ? 12 : 3.5) * dt);
    player.vx += (mx * top - player.vx) * grip;
    player.vz += (mz * top - player.vz) * grip;
    if (push > 0.1) player.heading = turnToward(player.heading, Math.atan2(mx, mz), 13 * dt);

    // Jumping, with a little forgiveness either side of the edge.
    player.coyote = player.onGround ? 0.12 : player.coyote - dt;
    player.jumpBuffer = input.jump ? 0.14 : player.jumpBuffer - dt;
    if (player.jumpBuffer > 0 && player.coyote > 0) {
      player.vy = JUMP;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuffer = 0;
      Sound.jump();
    }

    // Sideways movement, then pushing out of anything solid.
    const next = { x: player.x + player.vx * dt, z: player.z + player.vz * dt };
    pushOut(next, player.y, RADIUS, HEIGHT);
    next.x = clamp(next.x, -Island.HALF + 4, Island.HALF - 4);
    next.z = clamp(next.z, -Island.HALF + 4, Island.HALF - 4);

    // Up and down.
    const wasOnGround = player.onGround;
    player.vy = Math.max(-40, player.vy - GRAVITY * dt);
    let y = player.y + player.vy * dt;
    if (player.vy > 0) {
      const ceiling = ceilingAt(next.x, next.z, player.y + HEIGHT);
      if (y + HEIGHT > ceiling) {
        y = ceiling - HEIGHT;
        player.vy = 0;
      }
    }
    const ground = groundAt(next.x, next.z, player.y);
    const stick = wasOnGround && player.vy <= 0 && y - ground < 0.45; // hug slopes on the way down
    if (y <= ground || stick) {
      if (!wasOnGround && player.vy < -9) particles.burst(next.x, ground + 0.1, next.z, 0xe8dcc0, 5, 2, 0.4, 2);
      y = ground;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
    player.x = next.x;
    player.y = y;
    player.z = next.z;

    // Remember the last dry spot, and go back to it if the sea gets too deep.
    player.safeClock -= dt;
    if (player.onGround && player.y > 0.35 && player.safeClock <= 0) {
      player.safeX = player.x;
      player.safeZ = player.z;
      player.safeClock = 0.3;
    }
    if (player.y < DEEP_WATER) {
      Sound.splash();
      particles.burst(player.x, 0.2, player.z, 0xdff6ff, 14, 5, 0.7);
      fadeThrough(() => {
        placePlayer(player.safeX, player.safeZ);
        UI.toast('The current is too strong out there.', 2600);
      });
      return;
    }

    // Swinging the lantern staff.
    player.swingRest -= dt;
    if (input.swing && player.swing < 0 && player.swingRest <= 0) {
      player.swing = 0;
      player.swingHit = false;
      player.swingRest = SWING_TIME + 0.08;
      Sound.swing();
      if (push < 0.1) {
        // Standing still: turn to face the nearest gloomling in reach.
        let best = null;
        for (const g of glooms) {
          const d = Island.dist(g.x, g.z, player.x, player.z);
          if (g.alive && d < 4.5 && (!best || d < best.d)) best = { g, d };
        }
        if (best) player.heading = Math.atan2(best.g.x - player.x, best.g.z - player.z);
      }
    }
    if (player.swing >= 0) {
      player.swing += dt;
      if (!player.swingHit && player.swing > SWING_TIME * 0.3) {
        player.swingHit = true;
        strike();
      }
      if (player.swing >= SWING_TIME) player.swing = -1;
    }
    if (player.invuln > 0) player.invuln -= dt;
  }

  function drawPlayer(dt) {
    hero.group.position.set(player.x, player.y, player.z);
    hero.group.rotation.y = player.heading;
    hero.group.visible = player.invuln <= 0 || Math.floor(time * 16) % 2 === 0;
    Actors.animateFigure(hero, dt, {
      speed: mode === 'play' ? Math.hypot(player.vx, player.vz) / WALK : 0,
      airborne: !player.onGround,
      swing: player.swing >= 0 ? player.swing / SWING_TIME : -1,
      time,
    });
    hero.lantern.halo.scale.setScalar(1.6 + Math.sin(time * 9) * 0.08 + (player.swing >= 0 ? 1.2 : 0));
  }

  // The swing lands: scatter gloomlings in front of the player.
  function strike() {
    const hx = Math.sin(player.heading), hz = Math.cos(player.heading);
    particles.burst(player.x + hx * 1.7, player.y + 1.1, player.z + hz * 1.7, 0xffd27a, 6, 3, 0.35, 1);
    for (const g of glooms) {
      if (!g.alive || g.hurt > 0.15) continue;
      const dx = g.x - player.x, dz = g.z - player.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d > 3.2 || Math.abs(g.y - player.y) > 2.4) continue;
      if (d > 1.3 && (dx * hx + dz * hz) / d < 0.15) continue; // behind the player
      g.hp -= 1;
      g.hop = null;
      g.hurt = 0.4;
      g.kx = (dx / d) * 10;
      g.kz = (dz / d) * 10;
      Sound.hit();
      particles.burst(g.x, g.y + 0.8, g.z, 0xb99cff, 8, 4, 0.5);
      if (g.hp <= 0) scatter(g, true);
    }
  }

  function scatter(g, withCoins) {
    g.alive = false;
    g.dying = 0.3;
    particles.burst(g.x, g.y + 0.7, g.z, 0x6a4fa8, 16, 5, 0.8);
    if (!withCoins) return;
    Sound.pop();
    for (let i = 0; i < 2; i++) {
      const p = addPickup('drop-' + dropCount++, 'coin', g.x, g.y + 0.9, g.z);
      p.drop = true;
      p.settled = false;
      const a = Math.random() * Math.PI * 2;
      p.vx = Math.cos(a) * 2.2;
      p.vz = Math.sin(a) * 2.2;
      p.vy = 6.5;
    }
    const result = Rules.defeat(state, g.id, g.team);
    if (result.justCleared) {
      world.setSeal(false);
      Sound.key();
      UI.toast('The gloom around the shard melts away.', 3400);
    }
    dirty = true;
  }

  // ---------- gloomlings ----------

  function planHop(g) {
    const dx = player.x - g.x, dz = player.z - g.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const strayed = Island.dist(player.x, player.z, g.homeX, g.homeZ);
    g.chasing = mode === 'play' && d < 13 && strayed < 26 && Math.abs(player.y - g.y) < 5 && player.y > -0.4;
    if (g.chasing && !swingTipShown) {
      swingTipShown = true;
      UI.toast(input.touch ? 'A gloomling! Tap Swing to scatter it.' : 'A gloomling! Press F or click to swing your staff.', 4200);
    }
    let tx, tz, length, height;
    if (g.chasing) {
      const step = Math.min(2.4, Math.max(0, d - 0.5));
      tx = g.x + (dx / d) * step;
      tz = g.z + (dz / d) * step;
      length = 0.4;
      height = 0.75;
    } else {
      const hx = g.homeX - g.x, hz = g.homeZ - g.z;
      const a = Math.hypot(hx, hz) > 4 ? Math.atan2(hx, hz) + Math.random() - 0.5 : Math.random() * Math.PI * 2;
      tx = g.x + Math.sin(a) * 1.4;
      tz = g.z + Math.cos(a) * 1.4;
      length = 0.5;
      height = 0.4;
    }
    const target = { x: tx, z: tz };
    pushOut(target, heightAt(tx, tz), 0.6, 1.2);
    if (heightAt(target.x, target.z) < 0.5) {
      g.wait = 0.4; // gloomlings will not hop into the sea
      return;
    }
    g.face = Math.atan2(target.x - g.x, target.z - g.z);
    g.hop = { fx: g.x, fz: g.z, tx: target.x, tz: target.z, t: 0, length, height };
  }

  function updateGloom(g, dt) {
    const m = g.mesh.group;
    if (!g.alive) {
      if (g.dying > 0) {
        g.dying -= dt;
        m.scale.setScalar(Math.max(0.001, g.dying / 0.3));
        if (g.dying <= 0) m.visible = false;
      }
      return;
    }
    let lift = 0;
    if (g.hurt > 0) {
      g.hurt -= dt;
      const nx = g.x + g.kx * dt, nz = g.z + g.kz * dt;
      if (heightAt(nx, nz) > 0.5) {
        g.x = nx;
        g.z = nz;
      }
      g.kx *= Math.exp(-7 * dt);
      g.kz *= Math.exp(-7 * dt);
      g.mesh.mat.emissive.setHex(g.hurt > 0.22 ? 0xd8c8ff : 0x1a0f2e);
      if (g.hurt <= 0) g.wait = 0.25;
    } else if (g.hop) {
      g.hop.t += dt / g.hop.length;
      const k = Math.min(1, g.hop.t);
      g.x = g.hop.fx + (g.hop.tx - g.hop.fx) * k;
      g.z = g.hop.fz + (g.hop.tz - g.hop.fz) * k;
      lift = Math.sin(k * Math.PI) * g.hop.height;
      if (k >= 1) {
        g.hop = null;
        g.wait = g.chasing ? 0.1 : 0.5 + Math.random();
        g.squash = 1;
      }
    } else {
      g.wait -= dt;
      if (g.wait <= 0) planHop(g);
    }
    g.y = heightAt(g.x, g.z);
    g.squash = Math.max(0, g.squash - dt * 5);
    m.position.set(g.x, g.y + lift, g.z);
    m.scale.set(1 + g.squash * 0.25, 1 - g.squash * 0.3 + (lift > 0 ? 0.12 : 0), 1 + g.squash * 0.25);
    m.rotation.y = turnToward(m.rotation.y, g.face, 9 * dt);

    if (mode === 'play' && g.hurt <= 0 && player.invuln <= 0) {
      if (Island.dist(g.x, g.z, player.x, player.z) < 1.15 && Math.abs(player.y - (g.y + lift)) < 1.5) hurtPlayer(g.x, g.z);
    }
  }

  // ---------- pickups and shards ----------

  function collect(p) {
    if (p.drop) Rules.addCoins(state, 1);
    else if (!Rules.takePickup(state, p.id, p.kind)) return;
    p.taken = true;
    p.mesh.visible = false;
    if (p.kind === 'coin') {
      Sound.coin();
      particles.burst(p.x, p.y, p.z, 0xffd84a, 6, 3, 0.45, 4);
    } else {
      Sound.heart();
      particles.burst(p.x, p.y, p.z, 0xf0605d, 10, 3, 0.7, 2);
    }
    refreshHud();
    dirty = true;
  }

  function updatePickups(dt) {
    const reachY = player.y + 0.9;
    for (const p of pickups) {
      if (p.taken) continue;
      if (!p.settled) {
        p.vy -= 18 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const rest = heightAt(p.x, p.z) + 1;
        if (p.vy < 0 && p.y <= rest) {
          p.y = rest;
          p.settled = true;
        }
      } else if (mode === 'play' && !(p.kind === 'heart' && state.hearts >= Rules.MAX_HEARTS)) {
        const dx = player.x - p.x, dz = player.z - p.z, dy = reachY - p.y;
        const d = Math.hypot(dx, dz);
        if (d < 3 && Math.abs(dy) < 2.2) {
          if (d < 1.15 && Math.abs(dy) < 1.8) {
            collect(p);
            continue;
          }
          // Close enough: drift towards the player.
          const pull = Math.min(1, dt * 9 * (1 - d / 3.2));
          p.x += dx * pull;
          p.z += dz * pull;
          p.y += dy * pull;
        }
      }
      p.mesh.position.set(p.x, p.y + (p.settled ? Math.sin(time * 2.4 + p.phase) * 0.12 : 0), p.z);
      p.mesh.rotation.y += dt * 2.6;
    }
  }

  function updateShards(dt) {
    for (const id of Object.keys(shards)) {
      const s = shards[id];
      if (!s.active) continue;
      if (s.rise < 1) s.rise = Math.min(1, s.rise + dt * 0.6);
      s.crystal.rotation.y += dt * 1.4;
      s.group.position.y = s.y - (1 - s.rise) * 2.4 + Math.sin(time * 1.8 + s.x) * 0.15;
      if (mode !== 'play' || s.rise < 1) continue;
      if (Island.dist(s.x, s.z, player.x, player.z) > 1.9 || Math.abs(player.y + 1 - s.y) > 2.6) continue;
      if (id === 'grove' && !Rules.groveCleared(state)) {
        warn('Gloom seals this shard. Scatter the gloomlings in the grove first.');
        continue;
      }
      if (Rules.collectShard(state, id)) {
        s.active = false;
        s.group.visible = false;
        gotShard();
      }
    }
  }

  // ---------- camera ----------

  function followCamera(dt) {
    const k = 1 - Math.exp(-10 * dt);
    cam.x += (player.x - cam.x) * k;
    cam.y += (player.y + 1.5 - cam.y) * k;
    cam.z += (player.z - cam.z) * k;
    const flat = Math.cos(cam.pitch) * cam.dist;
    const x = cam.x + Math.sin(cam.yaw) * flat;
    const z = cam.z + Math.cos(cam.yaw) * flat;
    let y = cam.y + Math.sin(cam.pitch) * cam.dist;
    const floor = Math.max(heightAt(x, z), 0) + 0.9; // never under the ground or the sea
    if (y < floor) y = floor;
    camera.position.set(x, y, z);
    camera.lookAt(cam.x, cam.y, cam.z);
  }

  function titleCamera() {
    const a = time * 0.06 + 0.35;
    camera.position.set(Math.sin(a) * 215, 78, Math.cos(a) * 215 + 8);
    camera.lookAt(0, 8, 6);
    // Shift the island clear of the title text.
    if (camera.aspect < 0.85) camera.rotateX(-0.2);
    else camera.rotateY(0.24);
  }

  function finaleCamera(dt) {
    const L = P.lighthouse;
    const a = finale.angle + finale.t * 0.16;
    const k = 1 - Math.exp(-1.5 * dt);
    const tx = L.x + Math.sin(a) * 58, tz = L.z + Math.cos(a) * 58;
    const ty = Math.max(heightAt(tx, tz), 0) + 16;
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    finale.look.x += (L.x - finale.look.x) * k;
    finale.look.y += (world.lampY - 7 - finale.look.y) * k;
    finale.look.z += (L.z - finale.look.z) * k;
    camera.lookAt(finale.look);
  }

  function updateFinale(dt) {
    finale.t += dt;
    if (!finale.lit && finale.t > 1.6) {
      finale.lit = true;
      world.setBeacon(true);
      mood.target = 2;
      particles.burst(P.lighthouse.x, world.lampY, P.lighthouse.z, 0xfff0a8, 40, 9, 1.6, 2);
      for (const g of glooms) if (g.alive) scatter(g, false);
    }
    if (mode === 'finale' && finale.t > 8) {
      mode = 'won';
      UI.setWinStats({ time: state.elapsed, coins: state.coins, defeated: state.defeated, faints: state.faints });
      UI.show('win', true);
    }
  }

  // ---------- one frame ----------

  function findNearest() {
    let best = null;
    let bestD = Infinity;
    for (const s of spots) {
      const d = Island.dist(s.x, s.z, player.x, player.z);
      if (d > s.reach || d >= bestD || Math.abs(player.y - s.y) > 2.5) continue;
      const label = s.label();
      if (!label) continue;
      best = { spot: s, label };
      bestD = d;
    }
    return best;
  }

  function updatePlay(dt) {
    state.elapsed += dt;
    updatePlayer(dt);
    if (mode !== 'play') return; // fainted or fell in the sea this frame
    nearest = findNearest();
    UI.setPrompt(nearest ? nearest.label : null);
    if (input.use && nearest) nearest.spot.act();
  }

  function tuneQuality(rawDt) {
    if (BI.debug.lockQuality || quality.level >= 2 || rawDt > 0.25 || mode !== 'play') return;
    quality.sum += rawDt;
    quality.frames += 1;
    if (quality.frames < 90) return;
    const average = quality.sum / quality.frames;
    quality.sum = quality.frames = 0;
    if (average < 0.036) return;
    // Too slow: first render fewer pixels, then drop the shadows.
    quality.level += 1;
    if (quality.level === 1) {
      renderer.setPixelRatio(1);
      resize(true);
    } else {
      renderer.shadowMap.enabled = false;
      world.sun.castShadow = false;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
  }

  let lastW = 0, lastH = 0;
  function resize(force) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (!force && w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 55 + (1 - w / h) * 40 : 55; // see more to the sides on a tall phone
    camera.updateProjectionMatrix();
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 0.05);
    if (mode !== 'pause') time += dt;
    resize(false);
    input.poll();
    if (input.touch && !touchShown) {
      touchShown = true;
      UI.setTouch(true);
    }
    if (input.mute) UI.setMuted(Sound.toggleMute());
    if (input.pause) setPaused(mode === 'play');
    if (nagClock > 0) nagClock -= dt;

    if (mode === 'play') updatePlay(dt);
    else if (mode === 'talk') {
      if (input.use || input.jump) {
        if (UI.advance()) Sound.blip();
      }
    } else if (mode === 'fade') updateFade(dt);
    if (finale) updateFinale(dt);

    if (mode !== 'pause') {
      for (const g of glooms) updateGloom(g, dt);
      updatePickups(dt);
      updateShards(dt);
      particles.update(dt);
      for (const f of islanders) {
        // Islanders turn to look at the player when they come close.
        const near = Island.dist(f.spot.x, f.spot.z, player.x, player.z) < 9 && mode !== 'title';
        const want = near ? Math.atan2(player.x - f.spot.x, player.z - f.spot.z) : f.home;
        f.group.rotation.y = turnToward(f.group.rotation.y, want, 4 * dt);
        Actors.animateFigure(f, dt, { speed: 0, airborne: false, swing: -1, time: time + f.spot.x });
      }
      keeperMark.position.y = 2.75 + Math.sin(time * 3) * 0.12;
      drawPlayer(dt);
      if (mood.now !== mood.target) {
        const step = dt * 0.32;
        mood.now = Math.abs(mood.target - mood.now) <= step ? mood.target : mood.now + Math.sign(mood.target - mood.now) * step;
        world.setMood(mood.now);
      }
    }

    if (mode === 'title') titleCamera();
    else if (finale) finaleCamera(dt);
    else if (mode !== 'pause') followCamera(dt);

    // The shadows follow whatever the camera is watching.
    const focus = mode === 'title' ? TITLE_FOCUS : finale ? BEACON_FOCUS : player;
    world.update(mode === 'pause' ? 0 : dt, time, focus, camera);

    if (!document.getElementById('hud').hidden) {
      mapClock -= dt;
      if (mapClock <= 0) {
        mapClock = 0.1;
        const marks = [{ x: P.lighthouse.x, z: P.lighthouse.z, kind: 'lighthouse' }];
        if (state.metKeeper) {
          const where = { grove: P.grove, peak: P.mountain, vault: P.vault, runes: P.ring, trader: P.trader };
          for (const id of Rules.missingShards(state)) marks.push({ x: where[id].x, z: where[id].z, kind: 'shard' });
        }
        minimap.draw(player, marks, time);
      }
    }

    if (mode === 'play') {
      saveClock += dt;
      if ((dirty && saveClock > 2) || saveClock > 12) save();
    }
    renderer.render(scene, camera);
    tuneQuality(rawDt);
    input.clear();
  }

  // ---------- buttons ----------

  let touchShown = false;
  let restartArmed = false;
  const restartBtn = document.getElementById('restart-btn');
  const saved = load();
  if (saved) {
    startBtn.textContent = 'Continue';
    newBtn.hidden = false;
    UI.setNote(saved.state.beaconLit ? 'The beacon is lit. Carry on exploring, or start a new game.' : Rules.shardCount(saved.state) + ' of 5 shards found so far.');
  }
  startBtn.addEventListener('click', () => begin(saved ? load() : null));
  newBtn.addEventListener('click', () => {
    clearSave();
    begin(null);
  });
  document.getElementById('pause-btn').addEventListener('click', () => {
    focusScene();
    setPaused(true);
  });
  document.getElementById('resume-btn').addEventListener('click', () => setPaused(false));
  restartBtn.addEventListener('click', () => {
    // Ask twice, since this wipes the saved game.
    if (!restartArmed) {
      restartArmed = true;
      restartBtn.textContent = 'Really start over?';
      return;
    }
    clearSave();
    begin(null);
  });
  document.getElementById('mute-btn').addEventListener('click', () => {
    UI.setMuted(Sound.toggleMute());
    focusScene();
  });
  document.getElementById('talk').addEventListener('click', () => {
    if (mode === 'talk' && UI.tapTalk()) Sound.blip();
  });
  document.getElementById('explore-btn').addEventListener('click', () => {
    UI.show('win', false);
    focusScene();
    fadeThrough(() => {
      finale = null;
      UI.setHud(true);
      placePlayer(world.spots.door.x - 2, world.spots.door.z + 2, player.heading);
      refreshHud();
    });
  });
  document.getElementById('again-btn').addEventListener('click', () => {
    clearSave();
    begin(null);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'play') {
      save();
      setPaused(true);
    }
  });
  window.addEventListener('resize', () => resize(false));
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) input.touch = true;

  // Handy for testing from the browser console.
  BI.debug = {
    lockQuality: false,
    player,
    cam,
    state: () => state,
    mode: () => mode,
    glooms,
    world,
    teleport(x, z) { placePlayer(x, z, player.heading); },
    set(patch) { Object.assign(state, patch); syncWorld(); },
  };

  canvas.tabIndex = 0;
  syncWorld();
  resize(true);
  requestAnimationFrame(frame);
})();
