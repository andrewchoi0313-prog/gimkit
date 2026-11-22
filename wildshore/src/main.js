// The game itself: the loop, walking and fighting, hunting and eating, the
// boat, finding islands and chests, the camera and saving.
(function () {
  'use strict';

  const WS = window.WS;
  const { Zones, Rules, Blocks, Physics, House, Actors, World, Builder, Input, Sound, UI } = WS;
  const T = Blocks.TYPES;
  const WEAPONS = Rules.WEAPONS;

  const SAVE_KEY = 'wildshore-save-v1';
  const WALK = 6.5;
  const RUN = 10.5;
  const JUMP = 9;          // upward speed at take-off
  const RADIUS = 0.4;      // the player is a cylinder this wide...
  const HEIGHT = 1.8;      // ...and this tall
  const ROW = 15;          // boat speed, and faster with Shift
  const ROW_FAST = 23;
  const KEEL = -0.45;      // the boat needs water at least this deep
  const DRY = 0.4;         // land creatures will not walk lower than this
  const SAFE = 0.35;       // standing above this counts as dry land
  const FLOAT = -1.25;     // feet this deep: the player floats with their head out of the water
  const HEAD_UNDER = -1.6; // feet below this: the head is under water

  const canvas = document.getElementById('scene');
  const startBtn = document.getElementById('start-btn');
  const newBtn = document.getElementById('new-btn');
  const restartBtn = document.getElementById('restart-btn');

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
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 4000);
  const sky = World.createSky(scene);
  const particles = Actors.makeParticles(scene, 120);
  const input = Input.create(canvas);
  const minimap = UI.createMinimap();

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist = Zones.dist;

  // Turns angle `from` towards `to` by at most `step`, the short way round.
  function turnToward(from, to, step) {
    const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return Math.abs(diff) <= step ? to : from + Math.sign(diff) * step;
  }

  // ---------- the world ----------

  const data = Zones.buildZone();
  const def = data.def;
  const heightAt = data.heightAt;
  const plan = House.plan(Zones.HOUSE.x, Zones.HOUSE.z, 4);
  const view = World.buildZoneView(data, plan);
  scene.add(view.group);
  // The house is made of blocks, so its walls, floors and door are solid.
  const store = Blocks.createStore();
  for (const [i, j, k, type, turn] of plan.blocks) Blocks.place(store, i, j, k, type, turn);
  const rt = {
    id: def.id, data, view, store,
    space: { heightAt, grid: view.grid, store },
    blocksView: Builder.createView(view.group, store),
    monsters: [], loot: [], spots: [], dryLevel: DRY,
  };

  // ---------- game state ----------

  const player = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    heading: Math.PI, onGround: true, coyote: 0, jumpBuffer: 0,
    swing: -1, swingLen: 0.3, swingHit: false, swingRest: 0, invuln: 0,
    safeX: 0, safeY: 0, safeZ: 0, safeClock: 0, swimming: false,
  };
  const boat = { x: data.layout.boat.x, z: data.layout.boat.z, heading: Math.PI, vx: 0, vz: 0, riding: false, stroke: 0 };
  // Shared with the creatures.
  const G = { state: Rules.createState(), player, boat, particles, time: 0, zone: rt, mode: 'title', hurtPlayer, dropLoot, onKill };
  const monsters = WS.Monsters.create(G);
  monsters.populate(rt);

  const cam = { yaw: 0, pitch: 0.42, dist: 9.5, now: 9.5, x: 0, y: 0, z: 0 };
  const quality = { level: 0, sum: 0, frames: 0 };
  const bolts = [];
  let dirty = false;
  let saveClock = 0;
  let mapClock = 0;
  let nagClock = 0;        // stops the same warning repeating every frame
  let islandClock = 0;
  let fade = null;         // { t, action }
  let lastMood = -1;
  let tips = { monster: false, shark: false, weapon: false, meat: false };
  let chokeClock = 0;      // time until the next heart is lost for want of air
  let swimTilt = 0;        // 0 standing, 1 stretched out swimming
  let underView = false;   // is the camera under water?

  // ---------- the explorer and the boat ----------

  const hero = Actors.makeFigure({ coat: 0x2f6fb0, legs: 0x4a3f33, hat: 'cap', hatColor: 0xf2c23a, scarf: 0xd9432f, pack: 0x8a5f3c, lantern: true });
  hero.group.rotation.order = 'YXZ'; // turn first, then tip forward to swim
  scene.add(hero.group);
  const heroMask = Actors.makeMask();
  heroMask.position.set(0, 0.32, 0.27);
  heroMask.visible = false;
  hero.head.add(heroMask);
  const held = {};
  for (const id of Rules.WEAPON_ORDER) {
    held[id] = Actors.makeWeapon(id);
    held[id].visible = false;
    hero.hand.add(held[id]);
  }
  const boatModel = Actors.makeBoat();
  scene.add(boatModel.group);

  for (let i = 0; i < 8; i++) {
    const mesh = Actors.makeBolt();
    scene.add(mesh);
    bolts.push({ mesh, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, amount: 0 });
  }

  function placePlayer(x, z, heading, y) {
    player.x = x;
    player.z = z;
    player.y = Physics.groundAt(rt.space, x, z, y === undefined ? 1e4 : y + 0.6);
    player.vx = player.vy = player.vz = 0;
    player.onGround = true;
    player.swing = -1;
    player.safeX = x;
    player.safeY = player.y;
    player.safeZ = z;
    if (heading !== undefined) {
      player.heading = heading;
      cam.yaw = heading + Math.PI; // behind the player
    }
    cam.x = x;
    cam.y = player.y + 1.5;
    cam.z = z;
  }

  // Back on the rug by the fire, with the camera low enough to fit indoors.
  function goHome() {
    placePlayer(plan.start.x, plan.start.z, plan.start.heading, plan.ground);
    cam.pitch = 0.2;
  }

  function moorBoat() {
    boat.x = data.layout.boat.x;
    boat.z = data.layout.boat.z;
    boat.heading = Math.PI;
    boat.vx = boat.vz = 0;
    boat.riding = false;
  }

  // ---------- things to use with E ----------

  function spot(at, reach, label, act) {
    rt.spots.push({ at, reach, label, act });
  }
  spot(plan.table, 2.6, () => 'Read the note', () => say({
    speaker: 'A note on the table',
    lines: [
      'Welcome home. The fire is lit and the bed is upstairs.',
      input.touch ? 'Sheep, cows, pigs, deer, chickens and fish live wild out here. Hunt one for meat, then tap Eat when you are hurt.' : 'Sheep, cows, pigs, deer, chickens and fish live wild out here. Hunt one for meat, then press R to eat when you are hurt.',
      (input.touch ? 'You can swim: in the water the buttons turn into Up and Dive.' : 'You can swim: Space swims up and Shift dives.') + ' There is coral down there. You can hold your breath for ten seconds, and there are sharks in the deep water. The snorkel mask on this table lets you stay under as long as you like.',
      'Nothing dangerous walks by day. At night the monsters come out, and they are gone again by morning. Sleep in the bed to skip the dark, or fight: they drop weapons.',
      'The boat is tied up at the dock, south of the door. Six more islands lie across the water, and each one hides a treasure chest.',
    ],
  }, () => {
    if (!G.state.readNote) {
      G.state.readNote = true;
      dirty = true;
    }
  }));
  spot(plan.mask, 2.2, () => (G.state.mask ? null : 'Take the snorkel mask'), () => {
    G.state.mask = true;
    view.mask.visible = false;
    heroMask.visible = true;
    Sound.weapon();
    UI.toast('A snorkel mask! Now you can stay under water as long as you like.', 4200);
    save();
  });
  spot(plan.bed, 2.6, () => 'Sleep in the bed', () => {
    if (!Rules.isNight(G.state.clock)) {
      UI.toast('You are not sleepy. The bed is for skipping the night.', 3000);
      return;
    }
    fadeThrough(() => {
      Rules.sleep(G.state);
      monsters.reset(rt, true); // the monsters go; the animals stay
      Sound.dawn();
      UI.toast('You sleep until morning. The monsters are gone.', 3400);
      refreshHud();
      save();
    });
  });
  for (const chest of view.chests) {
    spot(chest, 2.6, () => (G.state.chests.includes(chest.id) ? null : 'Open the chest'), () => {
      const prize = Rules.openChest(G.state, chest.id);
      if (!prize) return;
      chest.target = -1.9;
      chest.halo.visible = false;
      Sound.door();
      const got = Rules.pickupWeapon(G.state, prize);
      Sound.weapon();
      particles.burst(chest.x, chest.y + 1.2, chest.z, 0xffe08a, 20, 5, 1, 3);
      UI.toast(got.isNew ? 'Treasure! Inside the chest is ' + (prize === 'axe' ? 'an ' : 'a ') + prize + '.' : 'Treasure! Your ' + prize + ' is now level ' + got.level + '.', 4200);
      refreshHud();
      refreshBar();
      save();
    });
  }
  spot(boat, 5.5, () => (boat.riding ? null : 'Board the boat'), () => {
    boat.riding = true;
    player.vx = player.vy = player.vz = 0;
    player.swing = -1;
    cam.yaw = boat.heading + Math.PI;
    Sound.splash();
    UI.toast(input.touch ? 'Steer with the stick. Tap Use near land to step ashore.' : 'Row with W A S D. Press E near land to step ashore.', 4200);
  });

  function findNearest() {
    let best = null, bestD = Infinity;
    for (const s of rt.spots) {
      const d = dist(s.at.x, s.at.z, player.x, player.z);
      const y = s.at.y === undefined ? player.y : s.at.y;
      if (d > s.reach || d >= bestD || Math.abs(player.y - y) > 2.5) continue;
      const label = s.label();
      if (!label) continue;
      best = { label, act: s.act };
      bestD = d;
    }
    // The doors of the house.
    const pi = Math.floor(player.x), pj = Math.floor(player.z), pk = Math.floor(player.y + 0.5);
    for (let i = pi - 2; i <= pi + 2; i++) for (let j = pj - 2; j <= pj + 2; j++) for (let k = pk - 1; k <= pk + 1; k++) {
      if (Blocks.get(store, i, j, k) !== T.door) continue;
      const d = dist(i + 0.5, j + 0.5, player.x, player.z);
      if (d > 1.9 || d >= bestD) continue;
      const open = store.open.has(Blocks.key(i, j, k));
      best = {
        label: open ? 'Shut the door' : 'Open the door',
        act: () => {
          rt.blocksView.setDoor(i, j, k, Blocks.toggleDoor(store, i, j, k));
          Sound.door();
        },
      };
      bestD = d;
    }
    return best;
  }

  // ---------- saving ----------

  function save() {
    dirty = false;
    saveClock = 0;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, state: Rules.serialize(G.state), pos: [player.safeX, player.safeY, player.safeZ], heading: player.heading,
        boat: [boat.x, boat.z, boat.heading, boat.riding ? 1 : 0],
      }));
    } catch (err) { /* storage can be blocked: the game still plays */ }
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!raw || raw.v !== 1) return null;
      const state = Rules.restore(raw.state);
      if (!state) return null;
      const ok = (list, n) => Array.isArray(list) && list.length === n && list.every(Number.isFinite);
      return { state, pos: ok(raw.pos, 3) ? raw.pos : null, heading: Number.isFinite(raw.heading) ? raw.heading : Math.PI, boat: ok(raw.boat, 4) ? raw.boat : null };
    } catch (err) {
      return null;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* nothing to clear */ }
  }

  // ---------- keeping the screen in step with the state ----------

  function refreshHud() {
    const s = G.state;
    UI.setHearts(s.hearts, Rules.MAX_HEARTS);
    UI.setMeat(s.meat);
    UI.setObjective(Rules.objective(s));
  }

  function refreshBar() {
    const s = G.state;
    const owned = Rules.ownedWeapons(s);
    const inWater = player.swimming && !boat.riding;
    UI.setBar({
      selected: owned.indexOf(s.weapon),
      swingLabel: inWater ? 'Dive' : WEAPONS[s.weapon].ranged ? 'Shoot' : 'Swing',
      jumpLabel: inWater ? 'Up' : 'Jump',
      slots: owned.map((id) => ({ id, name: WEAPONS[id].name, level: s.weapons[id] })),
    });
    for (const id of Rules.WEAPON_ORDER) held[id].visible = id === s.weapon;
  }

  // ---------- starting, pausing, fading ----------

  function begin(saved) {
    Sound.init();
    G.state = saved ? saved.state : Rules.createState();
    tips = { monster: false, shark: false, weapon: false, meat: false };
    fade = null;
    for (const item of rt.loot) view.group.remove(item.mesh);
    rt.loot.length = 0;
    monsters.reset(rt);
    for (const m of rt.monsters) m.deadUntil = 0;
    for (const chest of view.chests) {
      const opened = G.state.chests.includes(chest.id);
      chest.target = opened ? -1.9 : 0;
      chest.halo.visible = !opened;
    }
    view.mask.visible = !G.state.mask;
    heroMask.visible = G.state.mask;
    moorBoat();
    if (saved && saved.boat) {
      const [bx, bz, bh, riding] = saved.boat;
      if (afloat(bx, bz)) Object.assign(boat, { x: bx, z: bz, heading: bh, riding: !!riding });
    }
    if (saved && saved.pos && !boat.riding) placePlayer(saved.pos[0], saved.pos[2], saved.heading, saved.pos[1]);
    else if (boat.riding) placePlayer(boat.x, boat.z, boat.heading);
    else goHome();
    player.invuln = 0;
    lastMood = -1;
    UI.closeTalk();
    UI.setPrompt(null);
    UI.setFade(false);
    UI.show('title', false);
    UI.show('pause', false);
    UI.setHud(true);
    refreshHud();
    refreshBar();
    G.mode = 'play';
    if (!saved) {
      UI.toast('Home. There is a note on the table.', 3800);
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

  let restartArmed = false;
  function setPaused(on) {
    if (on && G.mode !== 'play') return;
    if (!on && G.mode !== 'pause') return;
    G.mode = on ? 'pause' : 'play';
    UI.show('pause', on);
    restartBtn.textContent = 'Start over';
    restartArmed = false;
    if (on) save();
    else focusScene();
  }

  // Fades to dark, runs `action`, and fades back in.
  function fadeThrough(action) {
    G.mode = 'fade';
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
      if (G.mode === 'fade') G.mode = 'play';
    }
  }

  function warn(text) {
    if (nagClock > 0) return;
    nagClock = 2.6;
    UI.toast(text, 2600);
  }

  // ---------- events ----------

  function say(talk, done) {
    G.mode = 'talk';
    player.vx = player.vz = 0;
    Sound.blip();
    UI.talk(talk.speaker, talk.lines, () => {
      G.mode = 'play';
      if (done) done();
    });
  }

  // Leaves something where a creature fell: 'meat', 'heart' or a weapon.
  function dropLoot(x, y, z, kind) {
    const mesh = kind === 'heart' ? Actors.makeHeart() : kind === 'meat' ? Actors.makeMeat() : Actors.makeWeaponPickup(kind);
    mesh.position.set(x, y, z);
    view.group.add(mesh);
    const a = Math.random() * 6.28;
    rt.loot.push({ kind, mesh, x, y, z, vx: Math.cos(a) * 1.8, vy: 6.5, vz: Math.sin(a) * 1.8, settled: false, age: 0 });
  }

  function onKill() {
    dirty = true;
  }

  function knockedOut() {
    fadeThrough(() => {
      Rules.revive(G.state);
      monsters.reset(rt);
      moorBoat();
      goHome();
      player.invuln = 2;
      UI.toast('You were knocked out. You wake up at home, and the boat is back at the dock.', 4200);
      refreshHud();
      save();
    });
  }

  function hurtPlayer(amount, fromX, fromZ) {
    if (boat.riding || G.mode !== 'play') return;
    const result = Rules.hurt(G.state, amount);
    player.invuln = 1.3;
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
    if (result.down) knockedOut();
  }

  function eat() {
    const result = Rules.eatMeat(G.state);
    if (result === 'ate') {
      Sound.heart();
      particles.burst(player.x, player.y + 1.4, player.z, 0xf0605d, 8, 3, 0.6, 2);
      refreshHud();
      dirty = true;
    } else {
      Sound.nope();
      UI.toast(result === 'none' ? 'No meat. Hunt a wild animal first.' : 'You are not hurt. Save the meat for later.', 2800);
    }
  }

  // ---------- fighting ----------

  function strike() {
    const id = G.state.weapon, W = WEAPONS[id];
    const hx = Math.sin(player.heading), hz = Math.cos(player.heading);
    particles.burst(player.x + hx * 1.8, player.y + 1.1, player.z + hz * 1.8, 0xffe08a, id === 'axe' ? 10 : 5, 3, 0.35, 1);
    monsters.strike(W, Rules.weaponDamage(G.state, id));
  }

  function fire(W) {
    const bolt = bolts.find((b) => !b.live) || bolts[0];
    const aim = monsters.nearest(W.reach, W.arc, false);
    const oy = player.y + 1.35;
    let dx = Math.sin(player.heading), dy = 0, dz = Math.cos(player.heading);
    if (aim) {
      const len = Math.hypot(aim.x - player.x, aim.y - oy, aim.z - player.z) || 1;
      dx = (aim.x - player.x) / len;
      dy = (aim.y - oy) / len;
      dz = (aim.z - player.z) / len;
      player.heading = Math.atan2(dx, dz);
    }
    Object.assign(bolt, { live: true, x: player.x + dx * 0.9, y: oy, z: player.z + dz * 0.9, vx: dx * 46, vy: dy * 46, vz: dz * 46, life: 0.9, amount: Rules.weaponDamage(G.state, 'blaster') });
    bolt.mesh.visible = true;
    bolt.mesh.position.set(bolt.x, bolt.y, bolt.z);
    bolt.mesh.lookAt(bolt.x + dx, bolt.y + dy, bolt.z + dz);
    Sound.shoot();
  }

  const probe = { x: 0, z: 0 };
  function updateBolts(dt) {
    for (const b of bolts) {
      if (!b.live) continue;
      for (let n = 0; n < 3 && b.live; n++) {
        b.x += (b.vx * dt) / 3;
        b.y += (b.vy * dt) / 3;
        b.z += (b.vz * dt) / 3;
        probe.x = b.x;
        probe.z = b.z;
        if (monsters.boltHit(b.x, b.y, b.z, b.amount, 6) || b.y < Math.max(heightAt(b.x, b.z), -0.8) || Physics.pushOut(rt.space, probe, b.y - 0.2, 0.12, 0.4)) {
          particles.burst(b.x, b.y, b.z, 0x8ff6ff, 8, 4, 0.35, 2);
          b.live = false;
        }
      }
      b.life -= dt;
      if (b.life <= 0) b.live = false;
      b.mesh.visible = b.live;
      b.mesh.position.set(b.x, b.y, b.z);
    }
  }

  // ---------- on foot ----------

  function steer(dt) {
    if (input.lookX || input.lookY) {
      cam.yaw -= input.lookX * 0.0062;
      cam.pitch = clamp(cam.pitch + input.lookY * 0.0042, 0.06, 1.3);
    } else if (player.onGround || boat.riding) {
      cam.yaw -= input.moveX * 0.7 * dt; // drift round behind the player
    }
    cam.yaw -= input.turn * 2.2 * dt;
    if (input.zoom) cam.dist = clamp(cam.dist + input.zoom * 1.2, 4, 20);
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return { mx: fx * input.moveY + rx * input.moveX, mz: fz * input.moveY + rz * input.moveX };
  }

  // `mayStart` is false while the Swing button is being used to dive.
  function updateSwing(dt, push, mayStart) {
    player.swingRest -= dt;
    const clicked = input.tap && input.tap.mouse && !input.tap.alt;
    if (mayStart && (input.swing || clicked || input.swingHeld) && player.swing < 0 && player.swingRest <= 0) {
      const W = WEAPONS[G.state.weapon];
      player.swing = 0;
      player.swingLen = W.ranged ? 0.25 : W.time;
      player.swingHit = W.ranged;
      player.swingRest = W.time + 0.06;
      if (W.ranged) {
        fire(W);
      } else {
        Sound[G.state.weapon === 'axe' ? 'chop' : 'swing']();
        if (push < 0.1) {
          const aim = monsters.nearest(5, -1, false); // standing still: turn to face whatever is closest
          if (aim) player.heading = Math.atan2(aim.x - player.x, aim.z - player.z);
        }
      }
    }
    if (player.swing >= 0) {
      player.swing += dt;
      if (!player.swingHit && player.swing > player.swingLen * 0.3) {
        player.swingHit = true;
        strike();
      }
      if (player.swing >= player.swingLen) player.swing = -1;
    }
  }

  // In deep water the player floats at the surface, dives and comes back up.
  function swim(dt, mx, mz, push) {
    const space = rt.space;
    const grip = Math.min(1, 4 * dt);
    player.vx += (mx * 5 - player.vx) * grip;
    player.vz += (mz * 5 - player.vz) * grip;
    if (push > 0.1) player.heading = turnToward(player.heading, Math.atan2(mx, mz), 8 * dt);
    const edge = def.size / 2 - 6;
    const next = { x: player.x + player.vx * dt, z: player.z + player.vz * dt };
    Physics.pushOut(space, next, player.y, RADIUS, HEIGHT);
    next.x = clamp(next.x, -edge, edge);
    next.z = clamp(next.z, -edge, edge);
    // Jump swims up, Shift (or the on-screen Dive button) dives, and doing
    // neither drifts back to the surface.
    const rise = input.jumpHeld ? 3.6 : input.dive ? -4 : 1.4;
    const bed = Physics.groundAt(space, next.x, next.z, player.y + 0.4);
    player.x = next.x;
    player.z = next.z;
    player.y = Math.max(bed, Math.min(FLOAT, player.y + rise * dt));
    player.vy = 0;
    player.onGround = true;
    updateSwing(dt, push, !input.swingTouch);
    if (player.invuln > 0) player.invuln -= dt;
  }

  // Counts breath while the head is under water.
  function breathe(dt) {
    const s = G.state;
    const out = Rules.breathe(s, dt, !boat.riding && player.swimming && player.y < HEAD_UNDER);
    UI.setAir(s.air < Rules.AIR - 0.05 ? s.air / Rules.AIR : null);
    if (!out) {
      chokeClock = 0;
      return;
    }
    chokeClock -= dt;
    if (chokeClock > 0) return;
    chokeClock = 2;
    Sound.hurt();
    UI.toast('Out of air! Swim up with ' + (input.touch ? 'Jump' : 'Space') + '.', 2200);
    const result = Rules.hurt(s, 1);
    refreshHud();
    if (result.down) knockedOut();
  }

  function updatePlayer(dt) {
    const space = rt.space;
    const { mx, mz } = steer(dt);
    const push = Math.min(1, Math.hypot(mx, mz));
    const wasSwimming = player.swimming;
    player.swimming = heightAt(player.x, player.z) < FLOAT && player.y <= FLOAT + 0.12;
    if (player.swimming !== wasSwimming) refreshBar(); // the touch buttons read Up and Dive in the water
    if (player.swimming) {
      if (!wasSwimming) {
        Sound.splash();
        particles.burst(player.x, 0.2, player.z, 0xdff6ff, 10, 4, 0.6);
      }
      swim(dt, mx, mz, push);
      return;
    }

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
    const edge = def.size / 2 - 6;
    const next = { x: player.x + player.vx * dt, z: player.z + player.vz * dt };
    Physics.pushOut(space, next, player.y, RADIUS, HEIGHT);
    next.x = clamp(next.x, -edge, edge);
    next.z = clamp(next.z, -edge, edge);

    // Up and down.
    const wasOnGround = player.onGround;
    player.vy = Math.max(-40, player.vy - def.gravity * dt);
    let y = player.y + player.vy * dt;
    if (player.vy > 0) {
      const ceiling = Physics.ceilingAt(space, next.x, next.z, player.y + HEIGHT);
      if (y + HEIGHT > ceiling) {
        y = ceiling - HEIGHT;
        player.vy = 0;
      }
    }
    const ground = Physics.groundAt(space, next.x, next.z, player.y);
    const stick = wasOnGround && player.vy <= 0 && y - ground < 0.62; // hug slopes and stairs (half a block each) on the way down
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

    // Remember the last dry spot: that is where a saved game starts again.
    player.safeClock -= dt;
    if (player.onGround && player.y > SAFE && player.safeClock <= 0) {
      player.safeX = player.x;
      player.safeY = player.y;
      player.safeZ = player.z;
      player.safeClock = 0.3;
    }
    updateSwing(dt, push, true);
    if (player.invuln > 0) player.invuln -= dt;
  }

  // ---------- in the boat ----------

  // Deep enough for the keel, and not under the pier.
  const pier = data.layout.dock;
  const afloat = (x, z) => heightAt(x, z) < KEEL && !(Math.abs(x - pier.x) < 2.2 && z > pier.z0 - 1 && z < pier.z1 + 1.6);

  // The nearest dry spot to step out onto, or null out at sea.
  function landing() {
    const d = data.layout.dock;
    if (dist(boat.x, boat.z, d.x, d.z1 - 1.5) < 6) return { x: d.x, z: d.z1 - 1.5, y: d.top };
    for (let r = 2; r <= 12; r += 1) {
      for (let n = 0; n < 16; n++) {
        const x = boat.x + Math.cos(n * 0.3927) * r, z = boat.z + Math.sin(n * 0.3927) * r;
        if (heightAt(x, z) > SAFE + 0.05) return { x, z };
      }
    }
    return null;
  }

  function updateBoat(dt) {
    const { mx, mz } = steer(dt);
    const top = input.run ? ROW_FAST : ROW;
    const pull = Math.min(1, 1.6 * dt);
    boat.vx += (mx * top - boat.vx) * pull;
    boat.vz += (mz * top - boat.vz) * pull;
    const speed = Math.hypot(boat.vx, boat.vz);
    if (speed > 0.6) boat.heading = turnToward(boat.heading, Math.atan2(boat.vx, boat.vz), 2.4 * dt);
    // Slide along the shore instead of stopping dead.
    const edge = def.size / 2 - 12;
    const nx = clamp(boat.x + boat.vx * dt, -edge, edge), nz = clamp(boat.z + boat.vz * dt, -edge, edge);
    if (afloat(nx, nz)) {
      boat.x = nx;
      boat.z = nz;
    } else if (afloat(nx, boat.z)) {
      boat.x = nx;
      boat.vz *= 0.4;
    } else if (afloat(boat.x, nz)) {
      boat.z = nz;
      boat.vx *= 0.4;
    } else {
      boat.vx *= 0.3;
      boat.vz *= 0.3;
    }
    boat.stroke += dt * (1.5 + speed * 0.35);
    if (speed > 4 && Math.random() < dt * 14) particles.burst(boat.x - Math.sin(boat.heading) * 2.2, 0.15, boat.z - Math.cos(boat.heading) * 2.2, 0xdff6ff, 1, 1.5, 0.5, 2);
    player.x = boat.x;
    player.z = boat.z;
    player.y = 0.3;
    player.heading = boat.heading;
    player.onGround = true;

    const shore = landing();
    UI.setPrompt(shore ? 'Step ashore' : null);
    if (input.use) {
      if (!shore) {
        warn('Bring the boat closer to land first.');
        return;
      }
      boat.riding = false;
      boat.vx = boat.vz = 0;
      placePlayer(shore.x, shore.z, Math.atan2(shore.x - boat.x, shore.z - boat.z), shore.y);
      Sound.splash();
      save();
    }
  }

  function drawPlayer(dt) {
    boatModel.group.position.set(boat.x, Math.sin(G.time * 1.7 + boat.x) * 0.08 + 0.05, boat.z);
    boatModel.group.rotation.set(Math.sin(G.time * 1.3) * 0.03, boat.heading, Math.sin(G.time * 1.1) * 0.04);
    const row = boat.riding ? Math.sin(boat.stroke) * 0.5 : 0;
    boatModel.oars[0].rotation.y = row;
    boatModel.oars[1].rotation.y = -row;
    // Swimming, the body lies flat just under the surface.
    swimTilt += ((player.swimming && !boat.riding ? 1 : 0) - swimTilt) * Math.min(1, dt * 8);
    hero.group.position.set(player.x, player.y + (boat.riding ? boatModel.group.position.y : 0) + swimTilt * 0.95, player.z);
    hero.group.rotation.y = player.heading;
    hero.group.rotation.x = swimTilt * 1.15;
    hero.group.visible = player.invuln <= 0 || Math.floor(G.time * 16) % 2 === 0;
    Actors.animateFigure(hero, dt, {
      speed: G.mode === 'play' && !boat.riding ? Math.hypot(player.vx, player.vz) / WALK : 0,
      airborne: !player.onGround,
      swing: player.swing >= 0 ? player.swing / player.swingLen : -1,
      armed: true,
      aim: WEAPONS[G.state.weapon].ranged,
      time: G.time,
    });
  }

  // ---------- pickups ----------

  function collect(item) {
    const s = G.state;
    if (item.kind === 'heart') {
      Rules.heal(s, 2);
      Sound.heart();
      particles.burst(item.x, item.y, item.z, 0xf0605d, 10, 3, 0.7, 2);
    } else if (item.kind === 'meat') {
      Rules.addMeat(s, 1);
      Sound.blip();
      particles.burst(item.x, item.y, item.z, 0xffc890, 8, 3, 0.6, 2);
      if (!tips.meat) {
        tips.meat = true;
        UI.toast(input.touch ? 'Meat! Tap Eat when you are hurt to win back two hearts.' : 'Meat! Press R when you are hurt to win back two hearts.', 4200);
      }
    } else {
      const got = Rules.pickupWeapon(s, item.kind);
      const name = WEAPONS[item.kind].name;
      Sound.weapon();
      particles.burst(item.x, item.y, item.z, 0xffe08a, 14, 4, 0.8, 2);
      if (got.isNew) {
        const more = item.kind === 'blaster' ? ' A rare find! It shoots bolts from far away.' : tips.weapon ? '' : (input.touch ? ' Tap it in the bar to use it.' : ' Number keys or Q switch weapons.');
        UI.toast('You found ' + (item.kind === 'axe' ? 'an ' : 'a ') + name.toLowerCase() + '!' + more, 4200);
        tips.weapon = true;
      } else {
        UI.toast(name + ' is now level ' + got.level + '. It hits harder.', 3200);
      }
      refreshBar();
    }
    view.group.remove(item.mesh);
    refreshHud();
    dirty = true;
  }

  function updateLoot(dt) {
    const reachY = player.y + 0.9;
    for (let n = rt.loot.length - 1; n >= 0; n--) {
      const item = rt.loot[n];
      item.age += dt;
      if (!item.settled) {
        item.vy -= 18 * dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.z += item.vz * dt;
        const rest = Math.max(Physics.groundAt(rt.space, item.x, item.z, item.y + 1), -0.4) + 1; // floats on the sea
        if (item.vy < 0 && item.y <= rest) {
          item.y = rest;
          item.settled = true;
        }
      } else if (G.mode === 'play' && !(item.kind === 'heart' && G.state.hearts >= Rules.MAX_HEARTS)) {
        const dx = player.x - item.x, dz = player.z - item.z, dy = reachY - item.y;
        const d = Math.hypot(dx, dz);
        if (d < 3.4 && Math.abs(dy) < 2.6) {
          if (d < 1.2 && Math.abs(dy) < 2) {
            collect(item);
            rt.loot.splice(n, 1);
            continue;
          }
          const pull = Math.min(1, dt * 9 * (1 - d / 3.6)); // drift towards the player
          item.x += dx * pull;
          item.z += dz * pull;
          item.y += dy * pull;
        }
      }
      // Hearts and meat fade after a while; weapons wait.
      if ((item.kind === 'heart' || item.kind === 'meat') && item.age > 90) {
        view.group.remove(item.mesh);
        rt.loot.splice(n, 1);
        continue;
      }
      item.mesh.position.set(item.x, item.y + (item.settled ? Math.sin(G.time * 2.4 + item.x) * 0.12 : 0), item.z);
      item.mesh.rotation.y += dt * 2.4;
    }
  }

  // ---------- camera ----------

  const camRay = { x: 0, y: 0, z: 0 }, camDir = { x: 0, y: 0, z: 0 };
  function followCamera(dt) {
    const k = 1 - Math.exp(-10 * dt);
    cam.x += (player.x - cam.x) * k;
    cam.y += (player.y + 1.5 - cam.y) * k;
    cam.z += (player.z - cam.z) * k;
    const flat = Math.cos(cam.pitch);
    camDir.x = Math.sin(cam.yaw) * flat;
    camDir.y = Math.sin(cam.pitch);
    camDir.z = Math.cos(cam.yaw) * flat;
    // Pull the camera in when a wall or a hill is between it and the player.
    camRay.x = cam.x;
    camRay.y = cam.y;
    camRay.z = cam.z;
    const reach = boat.riding ? Math.max(cam.dist, 15) : cam.dist; // step back to see the sea
    const hit = Blocks.castRay(store, camRay, camDir, reach, heightAt);
    const want = hit ? Math.max(1.3, hit.dist - 0.4) : reach;
    cam.now = want < cam.now ? want : cam.now + (want - cam.now) * (1 - Math.exp(-5 * dt));
    const x = cam.x + camDir.x * cam.now, z = cam.z + camDir.z * cam.now;
    let y = cam.y + camDir.y * cam.now;
    // Never under the ground. Under the sea only when the player's head is,
    // and then the camera stays down there with them.
    const diving = player.swimming && !boat.riding && player.y < HEAD_UNDER;
    const floor = diving ? heightAt(x, z) + 0.6 : Math.max(heightAt(x, z), 0) + 0.9;
    if (y < floor && !plan.inside(cam.x, cam.z)) y = floor;
    if (diving && y > -0.3) y = -0.3;
    camera.position.set(x, y, z);
    camera.lookAt(cam.x, cam.y, cam.z);
  }

  function titleCamera() {
    const a = G.time * 0.04 + 2.6;
    camera.position.set(Zones.HOUSE.x + Math.sin(a) * 150, 62, Zones.HOUSE.z + 40 + Math.cos(a) * 150);
    camera.lookAt(Zones.HOUSE.x, 6, Zones.HOUSE.z + 30);
    // Shift the land clear of the title text.
    if (camera.aspect < 0.85) camera.rotateX(-0.2);
    else camera.rotateY(0.24);
  }

  // ---------- one frame ----------

  function updatePlay(dt) {
    const s = G.state;
    s.elapsed += dt;
    if (input.slot) {
      const owned = Rules.ownedWeapons(s);
      if (input.slot - 1 < owned.length) Rules.selectWeapon(s, owned[input.slot - 1]);
      refreshBar();
    }
    if (input.cycle) {
      Rules.cycleWeapon(s);
      refreshBar();
    }
    if (input.eat) eat();

    const turn = Rules.advanceClock(s, dt);
    if (turn === 'dusk') {
      Sound.dusk();
      UI.toast('Night is falling. Monsters are coming out! Home has a bed.', 4200);
    } else if (turn === 'dawn') {
      Sound.dawn();
      UI.toast('The sun is up. The monsters are gone.', 3400);
    }

    if (boat.riding) {
      if (player.swimming) {
        player.swimming = false;
        refreshBar();
      }
      updateBoat(dt);
    } else {
      updatePlayer(dt);
      if (G.mode !== 'play') return; // knocked out or swept back
      const nearest = findNearest();
      UI.setPrompt(nearest ? nearest.label : null);
      if (input.use && nearest) nearest.act();
      if (!tips.monster && monsters.nearest(11, -1, 'monster')) {
        tips.monster = true;
        UI.toast(input.touch ? 'A monster! Tap Swing to fight it.' : 'A monster! Press F or click to swing.', 4200);
      }
      if (!tips.shark && player.swimming && monsters.nearest(16, -1, 'shark')) {
        tips.shark = true;
        UI.toast('A shark! Swim for the shallows: it cannot follow you there.', 4200);
      }
    }
    if (Rules.tickRegen(s, dt)) refreshHud(); // hearts mend on foot and in the boat

    breathe(dt);

    // Which island is this? Stepping onto a new one is worth a cheer.
    islandClock -= dt;
    if (islandClock <= 0) {
      islandClock = 0.5;
      const here = Zones.nearestIsland(player.x, player.z);
      UI.setZone(here.edge < 40 ? here.island.name : 'The open sea');
      // (The shore wanders either side of an island's rim, so dry land a little beyond it still counts.)
      if (!boat.riding && !player.swimming && player.onGround && player.y > SAFE && here.edge < 60 && Rules.visitIsland(s, here.island.id)) {
        Sound.weapon();
        UI.toast('You have landed on ' + here.island.name + '! Islands found: ' + s.islands.length + ' of ' + Rules.ISLAND_COUNT + '.', 4600);
        refreshHud();
        save();
      }
    }
  }

  function tuneQuality(rawDt) {
    if (WS.debug.lockQuality || quality.level >= 2 || rawDt > 0.25 || G.mode !== 'play') return;
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
      sky.sun.castShadow = false;
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

  const TITLE_FOCUS = { x: Zones.HOUSE.x, y: 5, z: Zones.HOUSE.z + 20 };
  let touchShown = false;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 0.05);
    if (G.mode !== 'pause') G.time += dt;
    resize(false);
    input.poll();
    if (input.touch && !touchShown) {
      touchShown = true;
      UI.setTouch(true);
    }
    if (input.mute) UI.setMuted(Sound.toggleMute());
    if (input.pause) setPaused(G.mode === 'play');
    if (nagClock > 0) nagClock -= dt;

    if (G.mode === 'play') updatePlay(dt);
    else if (G.mode === 'talk') {
      if ((input.use || input.jump) && UI.advance()) Sound.blip();
    } else if (G.mode === 'fade') updateFade(dt);

    if (G.mode !== 'pause') {
      monsters.update(dt);
      updateBolts(dt);
      updateLoot(dt);
      particles.update(dt);
      rt.blocksView.tick(dt);
      const mood = Rules.moodAt(G.state.clock);
      if (Math.abs(mood - lastMood) > 0.003) {
        lastMood = mood;
        sky.setMood(mood);
        view.sea.material.color.copy(sky.waterColor);
        // The belt lantern is turned down by day.
        const dark = Math.min(1, mood);
        hero.light.intensity = 0.05 + 0.2 * dark;
        hero.glow.material.opacity = 0.12 + 0.88 * dark;
      }
      drawPlayer(dt);
      view.tick(dt, G.time);
    }

    if (G.mode === 'title') titleCamera();
    else if (G.mode !== 'pause') followCamera(dt);
    sky.update(G.mode === 'pause' ? 0 : dt, G.time, G.mode === 'title' ? TITLE_FOCUS : player, camera);

    if (!document.getElementById('hud').hidden) {
      mapClock -= dt;
      if (mapClock <= 0) {
        mapClock = 0.1;
        const s = G.state;
        const marks = [{ x: Zones.HOUSE.x, z: Zones.HOUSE.z, kind: 'home' }, { x: boat.x, z: boat.z, kind: 'boat' }];
        for (const chest of view.chests) if (!s.chests.includes(chest.id)) marks.push({ x: chest.x, z: chest.z, kind: 'chest', pulse: s.islands.includes(chest.id) });
        minimap.draw(player, marks, G.time);
        UI.setClock(Rules.isNight(s.clock) ? 'Night' : s.clock >= 0.95 ? 'Dawn' : s.clock >= 0.58 ? 'Dusk' : 'Day');
      }
    }

    if (G.mode === 'play') {
      saveClock += dt;
      if ((dirty && saveClock > 2) || saveClock > 15) save();
    }
    // Under the surface everything fades into blue-green murk.
    const below = camera.position.y < -0.05 && G.mode !== 'title';
    if (below) {
      scene.fog.color.copy(sky.murk);
      scene.fog.near = 1;
      scene.fog.far = 46;
    }
    if (below !== underView) {
      underView = below;
      sky.setUnder(below);
      if (!below) sky.setMood(Rules.moodAt(G.state.clock));
    }
    view.cull(camera.position, scene.fog.far + 30); // skip trees and coral too far off to see
    renderer.render(scene, camera);
    tuneQuality(rawDt);
    input.clear();
  }

  // ---------- buttons ----------

  const saved = load();
  if (saved) {
    startBtn.textContent = 'Continue';
    newBtn.hidden = false;
    UI.setNote(saved.state.islands.length + ' of ' + Rules.ISLAND_COUNT + ' islands found, ' + saved.state.chests.length + ' chests opened.');
  }
  startBtn.addEventListener('click', () => begin(saved ? load() : null));
  let newArmed = false;
  newBtn.addEventListener('click', () => {
    // Ask twice, since this wipes the saved game.
    if (!newArmed) {
      newArmed = true;
      newBtn.textContent = 'Really start again?';
      return;
    }
    clearSave();
    begin(null);
  });
  document.getElementById('pause-btn').addEventListener('click', () => {
    focusScene();
    setPaused(true);
  });
  document.getElementById('resume-btn').addEventListener('click', () => setPaused(false));
  restartBtn.addEventListener('click', () => {
    if (!restartArmed) {
      restartArmed = true;
      restartBtn.textContent = 'Really start again?';
      return;
    }
    clearSave();
    begin(null);
  });
  document.getElementById('mute-btn').addEventListener('click', () => {
    UI.setMuted(Sound.toggleMute());
    focusScene();
  });
  document.getElementById('eat-btn').addEventListener('click', () => {
    if (G.mode === 'play') eat();
    focusScene();
  });
  UI.onSlot((n) => {
    if (G.mode === 'play') {
      const owned = Rules.ownedWeapons(G.state);
      if (n < owned.length) Rules.selectWeapon(G.state, owned[n]);
      refreshBar();
    }
    focusScene();
  });
  document.getElementById('talk').addEventListener('click', () => {
    if (G.mode === 'talk' && UI.tapTalk()) Sound.blip();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'play') {
      save();
      setPaused(true);
    }
  });
  window.addEventListener('resize', () => resize(false));
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) input.touch = true;

  // Handy for testing from the browser console.
  WS.debug = {
    lockQuality: false,
    player, cam, boat, rt, monsters, plan, renderer,
    state: () => G.state,
    mode: () => G.mode,
    zone: () => rt,
    teleport(x, z, y) { placePlayer(x, z, player.heading, y); },
    set(patch) {
      Object.assign(G.state, patch);
      lastMood = -1;
      refreshHud();
      refreshBar();
    },
    drop: dropLoot,
  };

  canvas.tabIndex = 0;
  minimap.setZone(data);
  sky.setMood(Rules.moodAt(G.state.clock));
  goHome();
  resize(true);
  requestAnimationFrame(frame);
})();
