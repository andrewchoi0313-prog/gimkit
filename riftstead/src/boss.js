// The Stone Giant. It sleeps in the fortress until the seal breaks, then
// chases the player round the arena: it swipes up close, stomps to send a
// shockwave across the floor (jump it!), and calls shades when it is hurt.
(function () {
  'use strict';

  const RS = (window.RS = window.RS || {});
  const { Rules, Actors, Sound, UI } = RS;

  const SWIPE_REACH = 6;
  const WINDUP = 0.9;      // seconds the fist hangs in the air before a swipe lands
  const RING_SPEED = 12;

  function turnToward(from, to, step) {
    const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return Math.abs(diff) <= step ? to : from + Math.sign(diff) * step;
  }

  // G is the game (see monsters.js). rt is the overworld, where the arena is.
  function create(G, rt, monsters) {
    const A = rt.view.arena;
    const actor = Actors.makeBoss();
    rt.view.group.add(actor.group);

    const rings = [];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 0.7, 48, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff8ad8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      mesh.visible = false;
      rt.view.group.add(mesh);
      rings.push({ mesh, r: 0, live: false, hit: false });
    }

    const boss = {
      actor, x: A.x, z: A.z - 6, y: A.y, face: 0, hp: Rules.BOSS_HP,
      state: 'sleep',      // sleep, wake, idle, chase, swipe, stomp, dead, gone
      t: 0, stompCool: 3, swipeCool: 0, summoned: 0, away: 0, flash: 0, phase: 0, lift: 0,
    };

    const inArena = (p, pad) => Math.abs(p.x - A.x) < A.half + pad && Math.abs(p.z - A.z) < A.half + pad;
    const fighting = () => ['wake', 'chase', 'swipe', 'stomp'].includes(boss.state);
    const enraged = () => boss.hp < Rules.BOSS_HP / 2;

    function pose() {
      actor.group.position.set(boss.x, boss.y + boss.lift, boss.z);
      actor.group.rotation.y = boss.face;
    }

    // Stops the fight. Walk out of the arena and the giant is as good as new
    // (full = true). Get knocked out and it only gets some of its health
    // back, so every try gets a little further.
    function reset(full) {
      if (boss.state === 'gone' || boss.state === 'dead') return;
      boss.hp = full ? Rules.BOSS_HP : Math.min(Rules.BOSS_HP, boss.hp + 15);
      if (full) boss.summoned = 0;
      boss.x = A.x;
      boss.z = A.z - 6;
      boss.face = 0;
      boss.lift = 0;
      boss.stompCool = 3;
      boss.state = Rules.sealBroken(G.state) ? 'idle' : 'sleep';
      for (const ring of rings) ring.live = ring.mesh.visible = false;
      monsters.clearMinions(rt);
      UI.setBoss(null);
      pose();
    }

    // Matches the giant to a new or loaded game.
    function sync() {
      boss.state = 'sleep';
      actor.group.visible = !G.state.bossDown;
      actor.group.scale.setScalar(1);
      if (G.state.bossDown) boss.state = 'gone';
      else reset(true);
    }

    function hurt(amount) {
      if (!fighting()) return false;
      boss.hp -= amount;
      boss.flash = 0.12;
      Sound.hit();
      G.particles.burst(boss.x, boss.y + 4, boss.z, 0xd08bff, 8, 6, 0.6, 9, 1.6);
      UI.setBoss(boss.hp / Rules.BOSS_HP);
      if (boss.hp <= 0) {
        boss.state = 'dead';
        boss.t = 0;
        Sound.roar();
        monsters.clearMinions(rt);
        for (const ring of rings) ring.live = ring.mesh.visible = false;
        UI.setBoss(null);
      } else if (boss.summoned < 2 && boss.hp <= Rules.BOSS_HP * (boss.summoned === 0 ? 2 / 3 : 1 / 3)) {
        boss.summoned += 1;
        Sound.roar();
        monsters.summon(boss.x, boss.z, 3, 'shade');
        UI.toast('The giant calls shades to its side!', 2600);
      }
      return true;
    }

    function update(dt) {
      const p = G.player;
      if (boss.state === 'gone') return;
      const dx = p.x - boss.x, dz = p.z - boss.z, d = Math.hypot(dx, dz) || 0.001;
      boss.t += dt;
      boss.swipeCool -= dt;
      let stride = 0, armR = 0.1, armL = 0.1, head = 0;

      if (boss.state === 'sleep') {
        head = 0.5; // head bowed, waiting
        if (Rules.sealBroken(G.state)) boss.state = 'idle';
      } else if (boss.state === 'idle') {
        if (G.mode === 'play' && inArena(p, -1)) {
          boss.state = 'wake';
          boss.t = 0;
          Sound.roar();
          UI.setBoss(boss.hp / Rules.BOSS_HP);
          UI.toast('The Stone Giant wakes. Jump over its shockwaves!', 3600);
        }
      } else if (boss.state === 'wake') {
        armL = armR = -2.4 * Math.sin(Math.min(1, boss.t / 1.3) * Math.PI);
        boss.face = turnToward(boss.face, Math.atan2(dx, dz), 3 * dt);
        if (boss.t > 1.4) boss.state = 'chase';
      } else if (boss.state === 'chase') {
        boss.face = turnToward(boss.face, Math.atan2(dx, dz), 2.6 * dt);
        boss.stompCool -= dt;
        if (d > 4.4) {
          const v = (enraged() ? 4.6 : 3.2) * dt;
          const lim = A.half - 3;
          boss.x = Math.max(A.x - lim, Math.min(A.x + lim, boss.x + (dx / d) * v));
          boss.z = Math.max(A.z - lim, Math.min(A.z + lim, boss.z + (dz / d) * v));
          stride = 1;
        }
        if (d < SWIPE_REACH - 0.8 && boss.swipeCool <= 0) {
          boss.state = 'swipe';
          boss.t = 0;
        } else if (boss.stompCool <= 0) {
          boss.state = 'stomp';
          boss.t = 0;
        }
      } else if (boss.state === 'swipe') {
        // Raise the fist, then bring it down in front.
        armR = boss.t < WINDUP ? -2.9 * (boss.t / WINDUP) : -2.9 + Math.min(1, (boss.t - WINDUP) / 0.15) * 3.6;
        if (boss.t >= WINDUP && boss.t - dt < WINDUP) {
          Sound.stomp();
          G.particles.burst(boss.x + Math.sin(boss.face) * 4, boss.y + 0.3, boss.z + Math.cos(boss.face) * 4, 0xd8ccb0, 14, 6, 0.6, 5, 1.5);
          const ahead = (dx * Math.sin(boss.face) + dz * Math.cos(boss.face)) / d;
          if (G.mode === 'play' && p.invuln <= 0 && d < SWIPE_REACH && ahead > 0.1 && p.y - boss.y < 3.5) G.hurtPlayer(2, boss.x, boss.z);
        }
        if (boss.t > WINDUP + 0.65) {
          boss.state = 'chase';
          boss.swipeCool = 2;
        }
      } else if (boss.state === 'stomp') {
        // Crouch, leap, land: the landing sends a ring across the floor.
        armL = armR = -2.6 * Math.min(1, boss.t / 0.5);
        boss.lift = boss.t < 0.75 ? Math.sin((boss.t / 0.75) * Math.PI) * 2.2 : 0;
        if (boss.t >= 0.75 && boss.t - dt < 0.75) {
          Sound.stomp();
          G.particles.burst(boss.x, boss.y + 0.3, boss.z, 0xff8ad8, 24, 9, 0.7, 4, 1.6);
          const ring = rings.find((r) => !r.live) || rings[0];
          ring.live = true;
          ring.hit = false;
          ring.r = 2.5;
          ring.x = boss.x;
          ring.z = boss.z;
          ring.mesh.visible = true;
        }
        if (boss.t > 1.5) {
          boss.state = 'chase';
          boss.stompCool = enraged() ? 3.6 : 5.5;
        }
      } else if (boss.state === 'dead') {
        // Crumble, drop the spoils, and let the game know.
        actor.group.scale.setScalar(Math.max(0.001, 1 - boss.t / 1.8));
        actor.group.rotation.z = boss.t * 0.5;
        if (Math.random() < dt * 30) G.particles.burst(boss.x + (Math.random() - 0.5) * 4, boss.y + Math.random() * 6, boss.z + (Math.random() - 0.5) * 4, 0x8a8498, 3, 5, 0.8, 9, 2);
        if (boss.t > 1.8) {
          boss.state = 'gone';
          actor.group.visible = false;
          for (let i = 0; i < 3; i++) G.dropLoot(boss.x + (i - 1) * 1.6, boss.y + 2, boss.z, 'heart');
          if (!G.state.weapons.blaster) G.dropLoot(boss.x, boss.y + 2.5, boss.z + 1.6, 'blaster');
          G.onBossDown();
        }
        return;
      }

      // Walk away and the giant goes back to waiting, good as new.
      if (fighting()) {
        boss.away = inArena(p, 5) ? 0 : boss.away + dt;
        if (boss.away > 3) reset(true);
      }

      for (const ring of rings) {
        if (!ring.live) continue;
        ring.r += RING_SPEED * dt;
        ring.mesh.position.set(ring.x, A.y + 0.35, ring.z);
        ring.mesh.scale.set(ring.r, 1, ring.r);
        ring.mesh.material.opacity = Math.max(0, 0.75 - ring.r / 48);
        const pd = Math.hypot(p.x - ring.x, p.z - ring.z);
        if (!ring.hit && G.mode === 'play' && p.invuln <= 0 && Math.abs(pd - ring.r) < 0.8 && p.y - A.y < 0.75 && inArena(p, 0)) {
          ring.hit = true;
          G.hurtPlayer(1, ring.x, ring.z);
        }
        if (ring.r > 36) ring.live = ring.mesh.visible = false;
      }

      boss.phase += dt * 5 * stride;
      const s = Math.sin(boss.phase) * 0.45 * stride;
      const ease = Math.min(1, dt * 14);
      actor.legL.rotation.x = s;
      actor.legR.rotation.x = -s;
      actor.armL.rotation.x += (armL - s * 0.6 - actor.armL.rotation.x) * ease;
      actor.armR.rotation.x += (armR + s * 0.6 - actor.armR.rotation.x) * ease;
      actor.head.rotation.x += (head - actor.head.rotation.x) * ease;
      if (boss.flash > 0) boss.flash -= dt;
      actor.mat.emissive.setHex(boss.flash > 0 ? 0xffffff : enraged() ? 0x3a0a2a : actor.rest);
      actor.glowMat.color.setHex(boss.state === 'sleep' ? 0x5a3a78 : enraged() ? 0xff6a8a : 0xd08bff);
      actor.heart.rotation.y += dt * 1.5;
      pose();
    }

    // A swing from the player: does it reach the giant?
    function strike(weapon, amount) {
      const p = G.player;
      const dx = boss.x - p.x, dz = boss.z - p.z, d = Math.hypot(dx, dz) || 0.001;
      if (d - actor.radius > weapon.reach - 0.4) return false;
      if ((dx * Math.sin(p.heading) + dz * Math.cos(p.heading)) / d < Math.min(weapon.arc, 0.1)) return false;
      return hurt(amount);
    }

    function nearest(range) {
      if (!fighting()) return null;
      const d = Math.hypot(boss.x - G.player.x, boss.z - G.player.z);
      return d <= range ? { d, x: boss.x, y: boss.y + 3.6, z: boss.z } : null;
    }

    function boltHit(x, y, z, amount) {
      if (Math.hypot(boss.x - x, boss.z - z) > actor.radius + 0.3 || y < boss.y || y > boss.y + actor.height) return false;
      return hurt(amount) || fighting() || boss.state === 'sleep' || boss.state === 'idle';
    }

    sync();
    return { boss, update, strike, nearest, boltHit, reset, sync, fighting };
  }

  RS.Boss = { create };
})();
