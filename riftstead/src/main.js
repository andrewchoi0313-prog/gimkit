// The game itself: the loop, the player's movement, fighting, building,
// portals between zones, pickups, the camera and saving.
(function () {
  'use strict';

  const RS = window.RS;
  const { Zones, Rules, Blocks, Physics, Actors, World, Builder, Input, Sound, UI } = RS;
  const T = Blocks.TYPES;
  const WEAPONS = Rules.WEAPONS;

  const SAVE_KEY = 'riftstead-save-v1';
  const WALK = 6.5;
  const RUN = 10.5;
  const JUMP = 9;          // upward speed at take-off
  const RADIUS = 0.4;      // the player is a cylinder this wide...
  const HEIGHT = 1.8;      // ...and this tall
  const CRYSTAL_COLORS = { ember: 0xff7a3a, frost: 0x8fdcff, cloud: 0xffe27a };
  const WEATHER = { frost: 'snow', ember: 'ember' };
  const DRY = { overworld: 0.4, ember: 0.6, frost: -50, cloud: -5 };    // monsters will not go lower than this
  const SAFE = { overworld: 0.35, ember: 0.7, frost: -50, cloud: -5 };  // standing above this is a safe place to return to
  const SEA = { overworld: 0, ember: 0, frost: -100, cloud: -15 };      // the camera stays above this

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
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 3000);
  const sky = World.createSky(scene);
  const particles = Actors.makeParticles(scene, 120);
  const input = Input.create(canvas);
  const minimap = UI.createMinimap();
  const ghost = Builder.createGhost(scene);

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist = Zones.dist;

  // Turns angle `from` towards `to` by at most `step`, the short way round.
  function turnToward(from, to, step) {
    const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return Math.abs(diff) <= step ? to : from + Math.sign(diff) * step;
  }

  // ---------- game state ----------

  const player = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    heading: Math.PI, onGround: true, coyote: 0, jumpBuffer: 0,
    swing: -1, swingLen: 0.3, swingHit: false, swingRest: 0, invuln: 0,
    safeX: 0, safeY: 0, safeZ: 0, safeClock: 0,
  };
  // Shared with the monsters and the giant.
  const G = { state: Rules.createState(), player, particles, time: 0, zone: null, mode: 'title', hurtPlayer, dropLoot, onKill, onBossDown };
  const monsters = RS.Monsters.create(G);

  const cam = { yaw: 0, pitch: 0.42, dist: 9.5, now: 9.5, x: 0, y: 0, z: 0 };
  const build = { on: false, slot: 0, eraser: false };
  const quality = { level: 0, sum: 0, frames: 0 };
  const bolts = [];
  let savedBlocks = {};    // zone id -> saved block list, for zones not built yet
  let dirty = false;
  let saveClock = 0;
  let mapClock = 0;
  let nagClock = 0;        // stops the same warning repeating every frame
  let portalCool = 0;
  let fade = null;         // { t, action }
  let winClock = -1;
  let lastMood = -1;
  let tips = { monster: false, weapon: false };

  // ---------- zones ----------

  const zones = {};

  // Builds a zone the first time it is needed.
  function zoneRuntime(id) {
    if (zones[id]) return zones[id];
    const data = Zones.buildZone(id);
    const view = World.buildZoneView(data);
    view.group.visible = false;
    scene.add(view.group);
    const store = Blocks.restore(savedBlocks[id]);
    const rt = {
      id, data, view, store,
      space: { heightAt: data.heightAt, grid: view.grid, store },
      blocksView: Builder.createView(view.group, store),
      monsters: [], loot: [], spots: [], noBuild: [], crystal: null, dryLevel: DRY[id],
    };
    for (const portal of view.portals) rt.noBuild.push({ x: portal.x, z: portal.z, r: 4.5, why: 'Keep the portal clear.' });
    if (data.layout.crystal) {
      const at = data.layout.crystal;
      const made = Actors.makeCrystal(CRYSTAL_COLORS[id]);
      made.group.position.set(at.x, at.y, at.z);
      view.group.add(made.group);
      rt.crystal = { x: at.x, y: at.y, z: at.z, group: made.group, gem: made.crystal, active: true };
      rt.noBuild.push({ x: at.x, z: at.z, r: 2.6, why: 'Keep the crystal clear.' });
    }
    monsters.populate(rt);
    zones[id] = rt;
    return rt;
  }

  function spot(rt, at, reach, label, act) {
    rt.spots.push({ x: at.x, z: at.z, y: rt.view.surfaceAt(at.x, at.z), reach, label, act });
  }

  // The overworld is always there: it is the backdrop for the title screen.
  savedBlocks = (load() || { blocks: {} }).blocks;
  const over = zoneRuntime('overworld');
  const O = over.data.def;
  over.view.group.visible = true;
  G.zone = over;

  const wren = Actors.makeFigure({ coat: 0x8a4f9e, legs: 0x4a3a2a, hat: 'brim', hatColor: 0x2f8f86, skin: 0xd9a57a, scarf: 0xf2c23a });
  wren.group.position.set(O.places.wren.x, over.data.heightAt(O.places.wren.x, O.places.wren.z), O.places.wren.z);
  wren.home = Math.atan2(O.places.start.x - O.places.wren.x, O.places.start.z - O.places.wren.z);
  wren.group.rotation.y = wren.home;
  over.view.group.add(wren.group);
  over.view.grid.add({ kind: 'cyl', x: O.places.wren.x, z: O.places.wren.z, r: 0.5, y0: -50, y1: 1e6, on: true });
  const wrenMark = Actors.makeMarker();
  wrenMark.position.y = 2.75;
  wren.group.add(wrenMark);
  over.noBuild.push({ x: O.places.wren.x, z: O.places.wren.z, r: 2.5, why: 'Leave Wren some room.' });
  over.noBuild.push({ x: O.fortress.x, z: O.fortress.z, r: O.fortress.half + 12, why: 'A dark force stops you building near the fortress.' });

  spot(over, O.places.wren, 3.2, () => 'Talk to Wren', () => say(Rules.wrenTalk(G.state, input.touch), O.places.wren));
  spot(over, over.view.spots.signs.home, 2.4, () => 'Read the sign', () => say({ speaker: 'Signpost', lines: ['This plot: yours to build on.', 'North: the crossroads, and everything beyond.'] }));
  spot(over, over.view.spots.signs.crossroads, 2.4, () => 'Read the sign', () => say({
    speaker: 'Signpost',
    lines: ['West: the forest and Windy Tor. East: the desert.', 'North: the snowy hills. North-east: the fortress. Keep out!'],
  }));
  spot(over, over.view.spots.gate, 3.4, () => (Rules.sealBroken(G.state) ? null : 'Look at the seal'), () => {
    Sound.nope();
    UI.toast('A wall of light bars the gate. Three rift crystals would break it. You have ' + G.state.crystals.length + '.', 3600);
  });
  const bossCtl = RS.Boss.create(G, over, monsters);

  // ---------- the builder ----------

  const hero = Actors.makeFigure({ coat: 0x2f8f6f, legs: 0x3a4a63, hat: 'cap', hatColor: 0xd9432f, scarf: 0xffa94d, pack: 0x8a5f3c, lantern: true });
  scene.add(hero.group);
  const held = {};
  for (const id of Rules.WEAPON_ORDER) {
    held[id] = Actors.makeWeapon(id);
    held[id].visible = false;
    hero.hand.add(held[id]);
  }
  held.block = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), new THREE.MeshLambertMaterial({ map: RS.Gfx.blockTexture('planks') }));
  held.block.position.set(0, 0.05, 0.3);
  held.block.visible = false;
  hero.hand.add(held.block);
  const heldTextures = {};

  function showHeld() {
    for (const id of Rules.WEAPON_ORDER) held[id].visible = !build.on && id === G.state.weapon;
    held.block.visible = build.on;
    if (build.on) {
      const id = Blocks.PALETTE[build.slot].id;
      if (!heldTextures[id]) heldTextures[id] = RS.Gfx.blockTexture(id === 'door' ? 'planks' : id);
      held.block.material.map = heldTextures[id];
      held.block.material.transparent = id === 'glass';
    }
  }

  for (let i = 0; i < 8; i++) {
    const mesh = Actors.makeBolt();
    scene.add(mesh);
    bolts.push({ mesh, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, amount: 0 });
  }

  function placePlayer(x, z, heading, y) {
    player.x = x;
    player.z = z;
    player.y = Physics.groundAt(G.zone.space, x, z, y === undefined ? 1e4 : y + 0.6);
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
    hero.group.position.set(player.x, player.y, player.z);
    hero.group.rotation.y = player.heading;
  }

  // ---------- saving ----------

  function save() {
    dirty = false;
    saveClock = 0;
    const blocks = Object.assign({}, savedBlocks);
    for (const id of Object.keys(zones)) blocks[id] = Blocks.serialize(zones[id].store);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, state: Rules.serialize(G.state), zone: G.zone.id, pos: [player.safeX, player.safeY, player.safeZ], heading: player.heading, blocks,
      }));
    } catch (err) { /* storage can be blocked or full: the game still plays */ }
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!raw || raw.v !== 1) return null;
      const state = Rules.restore(raw.state);
      if (!state) return null;
      const blocks = {};
      if (raw.blocks && typeof raw.blocks === 'object') {
        for (const id of Object.keys(Zones.DEFS)) if (Array.isArray(raw.blocks[id])) blocks[id] = raw.blocks[id];
      }
      const pos = Array.isArray(raw.pos) && raw.pos.length === 3 && raw.pos.every(Number.isFinite) ? raw.pos : null;
      return { state, blocks, zone: Zones.DEFS[raw.zone] ? raw.zone : 'overworld', pos, heading: Number.isFinite(raw.heading) ? raw.heading : Math.PI };
    } catch (err) {
      return null;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* nothing to clear */ }
  }

  // ---------- keeping the screen and the world in step with the state ----------

  function refreshHud() {
    const s = G.state;
    UI.setHearts(s.hearts, Rules.MAX_HEARTS);
    UI.setCrystals(s.crystals.length);
    UI.setObjective(Rules.objective(s));
  }

  function refreshBar() {
    const s = G.state;
    const owned = Rules.ownedWeapons(s);
    const swingLabel = WEAPONS[s.weapon].ranged ? 'Shoot' : 'Swing';
    if (build.on) {
      UI.setBar({ building: true, eraser: build.eraser, selected: build.slot, swingLabel, slots: Blocks.PALETTE.map((b) => ({ kind: 'block', id: b.id, name: b.name })) });
      UI.setHint(build.eraser ? 'Click a block to take it away' : 'Click to place a block. Right-click takes one away.');
    } else {
      UI.setBar({ building: false, eraser: false, selected: owned.indexOf(s.weapon), swingLabel, slots: owned.map((id) => ({ kind: 'weapon', id, name: WEAPONS[id].name, level: s.weapons[id] })) });
      UI.setHint(null);
    }
    showHeld();
  }

  function applySky(rt) {
    if (rt.id === 'overworld') {
      lastMood = Rules.moodAt(G.state.clock);
      sky.setMood(lastMood);
    } else {
      sky.setPalette(World.PALETTES[rt.id], World.PALETTES[rt.id], 0);
    }
    sky.setWeather(WEATHER[rt.id] || null);
    if (over.view.sea) over.view.sea.material.color.copy(sky.waterColor);
  }

  // Sets one zone's crystal, seal and marker to match the state.
  function syncZone(rt) {
    if (rt.crystal) {
      rt.crystal.active = !Rules.hasCrystal(G.state, rt.id);
      rt.crystal.group.visible = rt.crystal.active;
    }
    if (rt.id === 'overworld') {
      rt.view.setSeal(!Rules.sealBroken(G.state));
      wrenMark.visible = !G.state.metWren;
    }
  }

  // Makes `id` the zone being played. Coming through a portal, the player
  // steps out of the matching one on the other side.
  function enterZone(id, fromId) {
    G.zone.view.group.visible = false;
    ghost.hide();
    for (const b of bolts) b.live = b.mesh.visible = false;
    const rt = zoneRuntime(id);
    rt.view.group.visible = true;
    G.zone = rt;
    syncZone(rt);
    applySky(rt);
    minimap.setZone(rt.data);
    UI.setZone(rt.data.def.name);
    UI.setBoss(null);
    if (fromId) {
      const door = rt.view.portals.find((p) => p.def.to === fromId) || rt.view.portals[0];
      placePlayer(door.x + door.nx * 3.2, door.z + door.nz * 3.2, Math.atan2(door.nx, door.nz));
      cam.yaw += 0.9; // look past the arch, not through it
    }
    portalCool = 1.2;
  }

  // Empties every zone of blocks, loot and monsters for a brand new world.
  function wipeWorld() {
    savedBlocks = {};
    for (const rt of Object.values(zones)) {
      rt.blocksView.dispose();
      rt.store = Blocks.createStore();
      rt.space.store = rt.store;
      rt.blocksView = Builder.createView(rt.view.group, rt.store);
      for (const item of rt.loot) rt.view.group.remove(item.mesh);
      rt.loot.length = 0;
      monsters.reset(rt);
      for (const m of rt.monsters) m.deadUntil = 0;
    }
  }

  // ---------- starting, pausing, fading ----------

  function begin(saved) {
    Sound.init();
    if (!saved) wipeWorld();
    G.state = saved ? saved.state : Rules.createState();
    build.on = build.eraser = false;
    build.slot = 0;
    tips = { monster: false, weapon: false };
    fade = null;
    winClock = -1;
    enterZone(saved ? saved.zone : 'overworld', null);
    for (const rt of Object.values(zones)) syncZone(rt);
    bossCtl.sync();
    if (saved && saved.pos) placePlayer(saved.pos[0], saved.pos[2], saved.heading, saved.pos[1]);
    else placePlayer(O.places.start.x, O.places.start.z, Math.PI);
    player.invuln = 0;
    UI.closeTalk();
    UI.setPrompt(null);
    UI.setFade(false);
    UI.show('title', false);
    UI.show('win', false);
    UI.show('pause', false);
    UI.setHud(true);
    refreshHud();
    refreshBar();
    G.mode = 'play';
    if (!saved) {
      UI.toast('Welcome to the Stead. Wren is waiting by the campfire.', 3800);
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
    ghost.hide();
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

  function say(talk, facing) {
    G.mode = 'talk';
    player.vx = player.vz = 0;
    ghost.hide();
    if (facing) player.heading = Math.atan2(facing.x - player.x, facing.z - player.z);
    Sound.blip();
    UI.talk(talk.speaker, talk.lines, () => {
      G.mode = 'play';
      if (talk.effect && Rules.applyEffect(G.state, talk.effect)) {
        wrenMark.visible = false;
        UI.toast('The portals and the fortress are marked on your map.', 3600);
        refreshHud();
        dirty = true;
      }
    });
  }

  function gotCrystal() {
    const n = G.state.crystals.length;
    Sound.crystal();
    particles.burst(player.x, player.y + 1.3, player.z, CRYSTAL_COLORS[G.zone.id], 24, 5, 1, 3);
    if (Rules.sealBroken(G.state)) {
      over.view.setSeal(false);
      Sound.seal();
      UI.toast('All three crystals! Far away, the seal on the fortress shatters.', 4200);
    } else {
      UI.toast('Rift crystal found. ' + n + ' of 3. The portal leads home.', 3800);
    }
    refreshHud();
    save();
  }

  // Leaves something where a monster fell: 'heart', 'sword', 'axe' or 'blaster'.
  function dropLoot(x, y, z, kind) {
    const rt = G.zone;
    const mesh = kind === 'heart' ? Actors.makeHeart() : Actors.makeWeaponPickup(kind);
    mesh.position.set(x, y, z);
    rt.view.group.add(mesh);
    const a = Math.random() * 6.28;
    rt.loot.push({ kind, mesh, x, y, z, vx: Math.cos(a) * 1.8, vy: 6.5, vz: Math.sin(a) * 1.8, settled: false, age: 0 });
  }

  function onKill() {
    dirty = true;
  }

  function onBossDown() {
    Rules.defeatBoss(G.state);
    Sound.win();
    UI.toast('The Stone Giant crumbles!', 3600);
    refreshHud();
    save();
    winClock = 3.2;
  }

  function knockedOut() {
    fadeThrough(() => {
      const rt = G.zone;
      Rules.revive(G.state);
      monsters.reset(rt);
      bossCtl.reset(false);
      if (rt.id === 'overworld') {
        placePlayer(O.places.start.x, O.places.start.z, Math.PI);
      } else {
        const door = rt.view.portals[0];
        placePlayer(door.x + door.nx * 3.2, door.z + door.nz * 3.2, Math.atan2(door.nx, door.nz));
        cam.yaw += 0.9;
      }
      player.invuln = 2;
      UI.toast('You were knocked out. You wake up somewhere safe.', 3600);
      refreshHud();
      save();
    });
  }

  function hurtPlayer(amount, fromX, fromZ) {
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

  // ---------- fighting ----------

  function strike() {
    const id = G.state.weapon, W = WEAPONS[id];
    const amount = Rules.weaponDamage(G.state, id);
    const hx = Math.sin(player.heading), hz = Math.cos(player.heading);
    particles.burst(player.x + hx * 1.8, player.y + 1.1, player.z + hz * 1.8, 0xffe08a, id === 'axe' ? 10 : 5, 3, 0.35, 1);
    monsters.strike(W, amount);
    if (G.zone === over) bossCtl.strike(W, amount);
  }

  function fire(W) {
    const bolt = bolts.find((b) => !b.live) || bolts[0];
    let aim = monsters.nearest(W.reach, W.arc);
    const giant = G.zone === over ? bossCtl.nearest(W.reach) : null;
    if (giant && (!aim || giant.d < aim.d)) aim = giant;
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
    const rt = G.zone;
    for (const b of bolts) {
      if (!b.live) continue;
      for (let n = 0; n < 3 && b.live; n++) {
        b.x += (b.vx * dt) / 3;
        b.y += (b.vy * dt) / 3;
        b.z += (b.vz * dt) / 3;
        probe.x = b.x;
        probe.z = b.z;
        const struck = monsters.boltHit(b.x, b.y, b.z, b.amount, 6) || (rt === over && bossCtl.boltHit(b.x, b.y, b.z, b.amount));
        if (struck || b.y < rt.space.heightAt(b.x, b.z) || Physics.pushOut(rt.space, probe, b.y - 0.2, 0.12, 0.4)) {
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

  // ---------- the player ----------

  function updatePlayer(dt) {
    const rt = G.zone, space = rt.space, def = rt.data.def;
    // Camera first, because movement is relative to where it looks.
    if (input.lookX || input.lookY) {
      cam.yaw -= input.lookX * 0.0062;
      cam.pitch = clamp(cam.pitch + input.lookY * 0.0042, 0.06, 1.3);
    } else if (player.onGround) {
      cam.yaw -= input.moveX * 0.7 * dt; // drift round behind the player
    }
    cam.yaw -= input.turn * 2.2 * dt;
    if (input.zoom) cam.dist = clamp(cam.dist + input.zoom * 1.2, 4, 18);

    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const mx = fx * input.moveY + rx * input.moveX;
    const mz = fz * input.moveY + rz * input.moveX;
    const push = Math.min(1, Math.hypot(mx, mz));

    const wading = player.onGround && def.liquid === 'water' && player.y < -0.25;
    const icy = rt.id === 'frost' && player.onGround && player.y < 0.4 && rt.data.biomeAt(player.x, player.z) === 'ice';
    const top = (input.run ? RUN : WALK) * (wading ? 0.55 : 1);
    const grip = Math.min(1, (player.onGround ? (icy ? 1.5 : 12) : 3.5) * dt);
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
    if (def.wall && Math.hypot(next.x, next.z) > def.wall.r) {
      const out = Math.hypot(next.x, next.z);
      next.x *= def.wall.r / out;
      next.z *= def.wall.r / out;
      warn(def.wall.text);
    }

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

    // Remember the last safe spot, and go back to it after a fall into the
    // sea, the lava or the clouds.
    player.safeClock -= dt;
    if (player.onGround && player.y > SAFE[rt.id] && player.safeClock <= 0) {
      player.safeX = player.x;
      player.safeY = player.y;
      player.safeZ = player.z;
      player.safeClock = 0.3;
    }
    if (def.hazard && player.y < def.hazard.level) {
      Sound.splash();
      particles.burst(player.x, Math.max(player.y, SEA[rt.id]) + 0.2, player.z, def.liquid === 'lava' ? 0xffa040 : 0xdff6ff, 14, 5, 0.7);
      if (def.hazard.damage && Rules.hurt(G.state, def.hazard.damage).down) {
        refreshHud();
        knockedOut();
        return;
      }
      refreshHud();
      fadeThrough(() => {
        placePlayer(player.safeX, player.safeZ, undefined, player.safeY);
        player.invuln = 1.5;
        UI.toast(def.hazard.text, 2800);
      });
      return;
    }

    // Stepping into a portal.
    portalCool -= dt;
    if (portalCool <= 0) {
      for (const portal of rt.view.portals) {
        const px = player.x - portal.x, pz = player.z - portal.z;
        if (Math.abs(px * portal.nx + pz * portal.nz) < 0.6 && Math.abs(px * portal.tx + pz * portal.tz) < 1.25 && Math.abs(player.y - portal.y) < 2.5) {
          Sound.portal();
          const from = rt.id;
          fadeThrough(() => {
            enterZone(portal.def.to, from);
            UI.toast(G.zone.data.def.name, 2600);
            save();
          });
          return;
        }
      }
    }

    // Swinging, chopping or shooting. Asking to fight while building puts
    // the blocks away first.
    player.swingRest -= dt;
    const clicked = input.tap && input.tap.mouse && !input.tap.alt && !build.on;
    if ((input.swing || clicked || (input.swingHeld && !build.on)) && player.swing < 0 && player.swingRest <= 0) {
      if (build.on) toggleBuild();
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
          // Standing still: turn to face whatever is closest.
          let aim = monsters.nearest(5, -1);
          const giant = rt === over ? bossCtl.nearest(9) : null;
          if (giant && (!aim || giant.d < aim.d)) aim = giant;
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
    if (player.invuln > 0) player.invuln -= dt;
    if (Rules.tickRegen(G.state, dt)) refreshHud();
  }

  function drawPlayer(dt) {
    hero.group.position.set(player.x, player.y, player.z);
    hero.group.rotation.y = player.heading;
    hero.group.visible = player.invuln <= 0 || Math.floor(G.time * 16) % 2 === 0;
    Actors.animateFigure(hero, dt, {
      speed: G.mode === 'play' ? Math.hypot(player.vx, player.vz) / WALK : 0,
      airborne: !player.onGround,
      swing: player.swing >= 0 ? player.swing / player.swingLen : -1,
      armed: true,
      aim: !build.on && WEAPONS[G.state.weapon].ranged,
      time: G.time,
    });
  }

  // ---------- building ----------

  function toggleBuild() {
    build.on = !build.on;
    build.eraser = false;
    if (!build.on) ghost.hide();
    refreshBar();
  }

  function pickSlot(n) {
    if (build.on) {
      if (n < Blocks.PALETTE.length) build.slot = n;
      build.eraser = false;
    } else {
      const owned = Rules.ownedWeapons(G.state);
      if (n < owned.length) Rules.selectWeapon(G.state, owned[n]);
    }
    refreshBar();
  }

  function placeBlock(cell, type) {
    const rt = G.zone;
    const [i, j, k] = cell;
    // A door stands across the way the builder is looking.
    const turn = Math.abs(i + 0.5 - player.x) > Math.abs(j + 0.5 - player.z) ? 1 : 0;
    Blocks.place(rt.store, i, j, k, type, turn);
    rt.blocksView.add(i, j, k, type);
    G.state.placed += 1;
    Sound.place();
    particles.burst(i + 0.5, k + 0.5, j + 0.5, 0xf8f1e1, 4, 2, 0.3, 3);
    dirty = true;
  }

  function removeBlock(cell) {
    const rt = G.zone;
    for (const [i, j, k, type] of Blocks.remove(rt.store, cell[0], cell[1], cell[2])) {
      rt.blocksView.remove(i, j, k, type);
      particles.burst(i + 0.5, k + 0.5, j + 0.5, 0xc9c1cf, 5, 3, 0.4);
    }
    Sound.remove();
    dirty = true;
  }

  function updateBuild() {
    if (!build.on) return;
    const rt = G.zone;
    const type = Blocks.PALETTE[build.slot].type;
    const opts = { camera, canvas, store: rt.store, surfaceAt: rt.view.surfaceAt, player, eraser: build.eraser, type, noBuild: rt.noBuild };
    // The outline follows the mouse.
    const hover = input.pointer.inside ? Builder.aim(input.pointer.x, input.pointer.y, opts) : null;
    if (hover) ghost.show(hover.cell, hover.tall, hover.ok && !hover.remove);
    else ghost.hide();
    if (!input.tap) return;
    opts.eraser = build.eraser || input.tap.alt;
    const target = Builder.aim(input.tap.x, input.tap.y, opts);
    if (!target) return;
    if (!target.ok) {
      Sound.nope();
      warn(target.why);
    } else if (target.remove) {
      removeBlock(target.cell);
    } else {
      placeBlock(target.cell, type);
    }
  }

  // ---------- pickups ----------

  function collect(rt, item) {
    const s = G.state;
    if (item.kind === 'heart') {
      Rules.heal(s, 2);
      Sound.heart();
      particles.burst(item.x, item.y, item.z, 0xf0605d, 10, 3, 0.7, 2);
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
    rt.view.group.remove(item.mesh);
    refreshHud();
    dirty = true;
  }

  function updateLoot(dt) {
    const rt = G.zone;
    const reachY = player.y + 0.9;
    for (let n = rt.loot.length - 1; n >= 0; n--) {
      const item = rt.loot[n];
      item.age += dt;
      if (!item.settled) {
        item.vy -= 18 * dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.z += item.vz * dt;
        const rest = Physics.groundAt(rt.space, item.x, item.z, item.y + 1) + 1;
        if (item.vy < 0 && item.y <= rest) {
          item.y = rest;
          item.settled = true;
        }
      } else if (G.mode === 'play' && !(item.kind === 'heart' && G.state.hearts >= Rules.MAX_HEARTS)) {
        const dx = player.x - item.x, dz = player.z - item.z, dy = reachY - item.y;
        const d = Math.hypot(dx, dz);
        if (d < 3 && Math.abs(dy) < 2.4) {
          if (d < 1.15 && Math.abs(dy) < 1.9) {
            collect(rt, item);
            rt.loot.splice(n, 1);
            continue;
          }
          const pull = Math.min(1, dt * 9 * (1 - d / 3.2)); // drift towards the player
          item.x += dx * pull;
          item.z += dz * pull;
          item.y += dy * pull;
        }
      }
      // Hearts fade after a while; weapons wait.
      if (item.kind === 'heart' && item.age > 60) {
        rt.view.group.remove(item.mesh);
        rt.loot.splice(n, 1);
        continue;
      }
      item.mesh.position.set(item.x, item.y + (item.settled ? Math.sin(G.time * 2.4 + item.x) * 0.12 : 0), item.z);
      item.mesh.rotation.y += dt * 2.4;
    }
  }

  function updateCrystal(dt) {
    const c = G.zone.crystal;
    if (!c || !c.active) return;
    c.gem.rotation.y += dt * 1.4;
    c.group.position.y = c.y + Math.sin(G.time * 1.8) * 0.15;
    if (G.mode !== 'play' || dist(c.x, c.z, player.x, player.z) > 2.1 || Math.abs(player.y + 1 - c.y) > 2.8) return;
    if (Rules.collectCrystal(G.state, G.zone.id)) {
      c.active = false;
      c.group.visible = false;
      gotCrystal();
    }
  }

  // ---------- things to use with E ----------

  function findNearest() {
    const rt = G.zone;
    let best = null, bestD = Infinity;
    for (const s of rt.spots) {
      const d = dist(s.x, s.z, player.x, player.z);
      if (d > s.reach || d >= bestD || Math.abs(player.y - s.y) > 2.5) continue;
      const label = s.label();
      if (!label) continue;
      best = { label, act: s.act };
      bestD = d;
    }
    if (rt.store.turn.size) {
      // Doors the player has built.
      const pi = Math.floor(player.x), pj = Math.floor(player.z), pk = Math.floor(player.y + 0.5);
      for (let i = pi - 2; i <= pi + 2; i++) for (let j = pj - 2; j <= pj + 2; j++) for (let k = pk - 1; k <= pk + 1; k++) {
        if (Blocks.get(rt.store, i, j, k) !== T.door) continue;
        const d = dist(i + 0.5, j + 0.5, player.x, player.z);
        if (d > 1.9 || d >= bestD) continue;
        const open = rt.store.open.has(Blocks.key(i, j, k));
        best = {
          label: open ? 'Shut the door' : 'Open the door',
          act: () => {
            rt.blocksView.setDoor(i, j, k, Blocks.toggleDoor(rt.store, i, j, k));
            Sound.door();
          },
        };
        bestD = d;
      }
    }
    return best;
  }

  // ---------- camera ----------

  const camRay = { x: 0, y: 0, z: 0 }, camDir = { x: 0, y: 0, z: 0 };
  function followCamera(dt) {
    const rt = G.zone;
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
    // Step back during the giant's fight, so all of it fits on screen.
    const reach = rt === over && bossCtl.fighting() ? Math.max(cam.dist, 15) : cam.dist;
    const hit = Blocks.castRay(rt.store, camRay, camDir, reach, rt.space.heightAt);
    let want = hit ? Math.max(1.3, hit.dist - 0.4) : reach;
    // Big walls block the view too. The fortress gate counts as a wall here
    // even when it is open, so the camera stays inside the arena.
    for (let t = 1; t < want; t += 0.5) {
      const wx = cam.x + camDir.x * t, wy = cam.y + camDir.y * t, wz = cam.z + camDir.z * t;
      let inside = false;
      for (const s of rt.view.grid.near(wx, wz)) {
        if (s.kind === 'box' && wy < s.y1 && wx > s.x0 - 0.3 && wx < s.x1 + 0.3 && wz > s.z0 - 0.3 && wz < s.z1 + 0.3) inside = true;
      }
      if (inside) {
        want = Math.max(1.3, t - 0.6);
        break;
      }
    }
    cam.now = want < cam.now ? want : cam.now + (want - cam.now) * (1 - Math.exp(-5 * dt));
    const x = cam.x + camDir.x * cam.now, z = cam.z + camDir.z * cam.now;
    let y = cam.y + camDir.y * cam.now;
    const floor = Math.max(rt.space.heightAt(x, z), SEA[rt.id]) + 0.9; // never under the ground or the sea
    if (y < floor) y = floor;
    camera.position.set(x, y, z);
    camera.lookAt(cam.x, cam.y, cam.z);
  }

  function titleCamera() {
    const a = G.time * 0.05 + 0.5;
    camera.position.set(Math.sin(a) * 300, 135, Math.cos(a) * 300 + 30);
    camera.lookAt(0, 8, 20);
    // Shift the land clear of the title text.
    if (camera.aspect < 0.85) camera.rotateX(-0.2);
    else camera.rotateY(0.24);
  }

  // ---------- one frame ----------

  let nearest = null;
  function updatePlay(dt) {
    const s = G.state;
    s.elapsed += dt;
    if (input.build) toggleBuild();
    if (input.eraser && build.on) {
      build.eraser = !build.eraser;
      refreshBar();
    }
    if (input.slot) pickSlot(input.slot - 1);
    if (input.cycle) {
      if (build.on) build.slot = (build.slot + 1) % Blocks.PALETTE.length;
      else Rules.cycleWeapon(s);
      refreshBar();
    }

    const turn = Rules.advanceClock(s, dt);
    if (turn === 'dusk') {
      Sound.dusk();
      if (G.zone === over) UI.toast('Night is falling. Monsters are coming out!', 3800);
    } else if (turn === 'dawn') {
      Sound.dawn();
      if (G.zone === over) UI.toast('The sun is up. The night creatures fade away.', 3400);
    }

    updatePlayer(dt);
    if (G.mode !== 'play') return; // knocked out, fell or stepped through a portal
    updateBuild();
    nearest = findNearest();
    UI.setPrompt(nearest ? nearest.label : null);
    if (input.use && nearest) nearest.act();

    if (!tips.monster && monsters.nearest(11, -1)) {
      tips.monster = true;
      UI.toast(input.touch ? 'A monster! Tap Swing to fight it.' : 'A monster! Press F or click to swing.', 4200);
    }
    if (winClock > 0) {
      winClock -= dt;
      if (winClock <= 0) {
        G.mode = 'won';
        UI.setWinStats({ time: s.elapsed, kills: s.kills, placed: s.placed, deaths: s.deaths });
        UI.show('win', true);
        UI.setPrompt(null);
      }
    }
  }

  function tuneQuality(rawDt) {
    if (RS.debug.lockQuality || quality.level >= 2 || rawDt > 0.25 || G.mode !== 'play') return;
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

  const TITLE_FOCUS = { x: 0, y: 5, z: 60 };
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

    const rt = G.zone;
    if (G.mode !== 'pause') {
      monsters.update(dt);
      if (rt === over) bossCtl.update(dt);
      updateBolts(dt);
      updateLoot(dt);
      updateCrystal(dt);
      particles.update(dt);
      rt.blocksView.tick(dt);
      if (rt === over) {
        const near = G.mode !== 'title' && dist(O.places.wren.x, O.places.wren.z, player.x, player.z) < 9;
        wren.group.rotation.y = turnToward(wren.group.rotation.y, near ? Math.atan2(player.x - O.places.wren.x, player.z - O.places.wren.z) : wren.home, 4 * dt);
        Actors.animateFigure(wren, dt, { speed: 0, airborne: false, swing: -1, time: G.time });
        wrenMark.position.y = 2.75 + Math.sin(G.time * 3) * 0.12;
        const mood = Rules.moodAt(G.state.clock);
        if (Math.abs(mood - lastMood) > 0.003) {
          lastMood = mood;
          sky.setMood(mood);
          over.view.sea.material.color.copy(sky.waterColor);
        }
      }
      drawPlayer(dt);
      rt.view.tick(dt, G.time);
    }

    if (G.mode === 'title') titleCamera();
    else if (G.mode !== 'pause') followCamera(dt);
    sky.update(G.mode === 'pause' ? 0 : dt, G.time, G.mode === 'title' ? TITLE_FOCUS : player, camera);

    if (!document.getElementById('hud').hidden) {
      mapClock -= dt;
      if (mapClock <= 0) {
        mapClock = 0.1;
        drawMap(rt);
        const c = G.state.clock;
        UI.setClock(Rules.isNight(c) ? 'Night' : c >= 0.95 ? 'Dawn' : c >= 0.58 ? 'Dusk' : 'Day');
      }
    }

    if (G.mode === 'play') {
      saveClock += dt;
      if ((dirty && saveClock > 2) || saveClock > 15) save();
    }
    renderer.render(scene, camera);
    tuneQuality(rawDt);
    input.clear();
  }

  function drawMap(rt) {
    const s = G.state;
    const marks = [];
    if (rt === over) {
      marks.push({ x: O.places.home.x, z: O.places.home.z, kind: 'home' });
      if (s.metWren) {
        for (const p of over.view.portals) {
          marks.push({ x: p.x, z: p.z, kind: 'portal', color: '#' + p.def.color.toString(16).padStart(6, '0'), pulse: !Rules.hasCrystal(s, p.def.to) });
        }
        if (!s.bossDown) marks.push({ x: O.fortress.x, z: O.fortress.z, kind: 'fortress' });
      }
    } else {
      for (const p of rt.view.portals) marks.push({ x: p.x, z: p.z, kind: 'portal', color: '#7fe3a0' });
      if (rt.crystal && rt.crystal.active) marks.push({ x: rt.crystal.x, z: rt.crystal.z, kind: 'crystal', pulse: true });
    }
    minimap.draw(player, marks, G.time);
  }

  // ---------- buttons ----------

  const saved = load();
  if (saved) {
    startBtn.textContent = 'Continue';
    newBtn.hidden = false;
    const built = Object.values(saved.blocks).reduce((sum, list) => sum + list.length / 4, 0);
    UI.setNote((saved.state.bossDown ? 'The giant is beaten' : saved.state.crystals.length + ' of 3 crystals found') + ', ' + built + ' blocks placed.');
  }
  startBtn.addEventListener('click', () => begin(saved ? load() : null));
  let newArmed = false;
  newBtn.addEventListener('click', () => {
    // Ask twice, since this wipes everything that was built.
    if (!newArmed) {
      newArmed = true;
      newBtn.textContent = 'Really wipe this world?';
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
      restartBtn.textContent = 'Really wipe this world?';
      return;
    }
    clearSave();
    begin(null);
  });
  document.getElementById('mute-btn').addEventListener('click', () => {
    UI.setMuted(Sound.toggleMute());
    focusScene();
  });
  document.getElementById('mode-btn').addEventListener('click', () => {
    if (G.mode === 'play') toggleBuild();
    focusScene();
  });
  document.getElementById('erase-btn').addEventListener('click', () => {
    if (G.mode === 'play' && build.on) {
      build.eraser = !build.eraser;
      refreshBar();
    }
    focusScene();
  });
  UI.onSlot((n) => {
    if (G.mode === 'play') pickSlot(n);
    focusScene();
  });
  document.getElementById('talk').addEventListener('click', () => {
    if (G.mode === 'talk' && UI.tapTalk()) Sound.blip();
  });
  document.getElementById('explore-btn').addEventListener('click', () => {
    UI.show('win', false);
    G.mode = 'play';
    focusScene();
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
  RS.debug = {
    lockQuality: false,
    player, cam, build, zones, bossCtl, monsters,
    state: () => G.state,
    mode: () => G.mode,
    zone: () => G.zone,
    teleport(x, z) { placePlayer(x, z, player.heading); },
    travel(id) { enterZone(id, G.zone.id === id ? null : G.zone.id); },
    set(patch) {
      Object.assign(G.state, patch);
      for (const rt of Object.values(zones)) syncZone(rt);
      bossCtl.sync();
      refreshHud();
      refreshBar();
    },
    place(i, j, k, type) { placeBlock([i, j, k], type); },
    drop: dropLoot,
  };

  canvas.tabIndex = 0;
  minimap.setZone(over.data);
  applySky(over);
  syncZone(over);
  placePlayer(O.places.start.x, O.places.start.z, Math.PI);
  resize(true);
  requestAnimationFrame(frame);
})();
