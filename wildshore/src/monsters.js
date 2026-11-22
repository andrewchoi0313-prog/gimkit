// Creature behaviour. Every den owns one creature that appears when the
// player comes near. Monsters (blobs hop, brutes slam, wisps dive) only come
// out at night and fade at sunrise. Wild animals and fish are always about:
// they wander, run when hurt, and leave meat.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const { Zones, Rules, Physics, Actors, Sound } = WS;
  const dist = Zones.dist;

  function turnToward(from, to, step) {
    const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return Math.abs(diff) <= step ? to : from + Math.sign(diff) * step;
  }

  // G is the game: { state, player, particles, time, zone (the zone being
  // played), mode, hurtPlayer(amount, x, z), dropLoot(x, y, z, kind) }.
  function create(G) {
    function record(den) {
      const sp = Zones.SPECIES[den.species];
      return {
        id: den.id, den, sp, actor: null, alive: false, deadUntil: 0, dying: 0,
        x: den.x, y: 0, z: den.z, hp: sp.hp, face: 0, hurt: 0, kx: 0, kz: 0,
        wait: Math.random() * 1.5, hop: null, squash: 0, chasing: false,
        act: 'idle', actT: 0, cool: 0, phase: Math.random() * 6, dx: 0, dy: 0, dz: 0, goalX: den.x, goalZ: den.z, scared: 0,
      };
    }

    // Called once for each zone: one sleeping monster per den.
    function populate(rt) {
      rt.monsters = rt.data.layout.spawns.map((den) => record(den));
    }

    const swims = (m) => m.sp.body === 'fish' || m.sp.body === 'shark';
    const flies = (m) => m.sp.body === 'wisp' || swims(m); // not standing on the ground
    const always = (m) => !!(m.den.wild || m.den.sea);      // about by day as well as night
    const SWIM = -0.45; // fish keep just under the surface
    const centreY = (m) => (flies(m) ? m.y : m.y + m.actor.height / 2);
    const floorAt = (rt, x, z, feetY) => Physics.groundAt(rt.space, x, z, feetY);

    function appear(rt, m, x, z) {
      if (!m.actor) {
        m.actor = Actors.makeMonster(m.sp, m.den.tint);
        rt.view.group.add(m.actor.group);
      }
      m.alive = true;
      m.dying = 0;
      m.hp = m.sp.hp;
      m.x = x;
      m.z = z;
      m.y = m.sp.body === 'shark' ? -2.6 : m.sp.body === 'fish' ? (m.den.depth === undefined ? SWIM : m.den.depth) : floorAt(rt, x, z, 1e4) + (flies(m) ? 2.6 : 0);
      m.scared = 0;
      m.hop = null;
      m.hurt = 0;
      m.act = 'idle';
      m.wait = 0.4 + Math.random();
      m.actor.group.visible = true;
      m.actor.group.scale.setScalar(1);
      m.actor.mat.emissive.setHex(m.actor.rest);
      m.actor.group.position.set(m.x, m.y, m.z);
    }

    function vanish(m, puff) {
      m.alive = false;
      m.deadUntil = 0;
      if (m.actor) m.actor.group.visible = false;
      if (puff) G.particles.burst(m.x, m.y + 0.8, m.z, m.sp.color, 10, 3, 0.6);
    }

    // The player is close, in reach of the den, and not somewhere odd.
    function canSee(m, d) {
      const p = G.player;
      return G.mode === 'play' && d < 16 && dist(p.x, p.z, m.den.x, m.den.z) < 32 && Math.abs(p.y - m.y) < 7;
    }

    // Moves a walking or hopping monster to (x, z) if the way is clear and dry.
    function stepTo(rt, m, x, z) {
      const spot = { x, z };
      Physics.pushOut(rt.space, spot, m.y, m.actor.radius, m.actor.height * 0.8);
      const ground = floorAt(rt, spot.x, spot.z, m.y);
      if (ground < rt.dryLevel) return false;
      m.x = spot.x;
      m.z = spot.z;
      m.y = ground;
      return true;
    }

    // ---------- blobs ----------

    function planHop(rt, m, d) {
      const p = G.player;
      m.chasing = canSee(m, d);
      let tx, tz, length, height;
      if (m.chasing) {
        const step = Math.min(2.4, Math.max(0, d - 0.5));
        tx = m.x + ((p.x - m.x) / d) * step;
        tz = m.z + ((p.z - m.z) / d) * step;
        length = 0.4 / m.sp.speed;
        height = 0.75;
      } else {
        const hx = m.den.x - m.x, hz = m.den.z - m.z;
        const a = Math.hypot(hx, hz) > 5 ? Math.atan2(hx, hz) + Math.random() - 0.5 : Math.random() * Math.PI * 2;
        tx = m.x + Math.sin(a) * 1.4;
        tz = m.z + Math.cos(a) * 1.4;
        length = 0.5;
        height = 0.4;
      }
      // Stop short of anything solid, so a blob never hops through a wall.
      const end = Physics.sweep(rt.space, m.x, m.z, tx, tz, m.y, m.actor.radius, m.actor.height * 0.8);
      if (Math.hypot(end.x - m.x, end.z - m.z) < 0.25 || floorAt(rt, end.x, end.z, m.y) < rt.dryLevel) {
        m.wait = 0.45;
        return;
      }
      m.face = Math.atan2(end.x - m.x, end.z - m.z);
      m.hop = { fx: m.x, fz: m.z, tx: end.x, tz: end.z, t: 0, length, height };
    }

    function updateBlob(rt, m, dt, d) {
      let lift = 0;
      if (m.hop) {
        m.hop.t += dt / m.hop.length;
        const k = Math.min(1, m.hop.t);
        m.x = m.hop.fx + (m.hop.tx - m.hop.fx) * k;
        m.z = m.hop.fz + (m.hop.tz - m.hop.fz) * k;
        lift = Math.sin(k * Math.PI) * m.hop.height;
        if (k >= 1) {
          m.hop = null;
          m.wait = m.chasing ? 0.1 : 0.5 + Math.random();
          m.squash = 1;
        }
      } else {
        m.wait -= dt;
        if (m.wait <= 0) planHop(rt, m, d);
      }
      m.y = floorAt(rt, m.x, m.z, m.y + 0.3);
      m.squash = Math.max(0, m.squash - dt * 5);
      const g = m.actor.group;
      g.position.set(m.x, m.y + lift, m.z);
      g.scale.set(1 + m.squash * 0.25, 1 - m.squash * 0.3 + (lift > 0 ? 0.12 : 0), 1 + m.squash * 0.25);
      const p = G.player;
      if (G.mode === 'play' && p.invuln <= 0 && d < m.actor.radius + 0.5 && Math.abs(p.y - (m.y + lift)) < 1.5) {
        G.hurtPlayer(m.sp.dmg, m.x, m.z);
      }
    }

    // ---------- brutes ----------

    function updateBrute(rt, m, dt, d) {
      const p = G.player, a = m.actor;
      const reach = 1.5 + a.radius;
      let stride = 0, arms = 0.15;
      if (m.act === 'windup') {
        m.actT += dt;
        arms = -2.7 * Math.min(1, m.actT / 0.45);
        if (m.actT > 0.6) {
          m.act = 'recover';
          m.actT = 0;
          Sound.stomp();
          G.particles.burst(m.x + Math.sin(m.face) * 1.6, m.y + 0.2, m.z + Math.cos(m.face) * 1.6, 0xd8ccb0, 8, 3, 0.5, 3);
          const ahead = ((p.x - m.x) * Math.sin(m.face) + (p.z - m.z) * Math.cos(m.face)) / (d || 1);
          if (G.mode === 'play' && p.invuln <= 0 && d < reach + 1.1 && ahead > 0.2 && Math.abs(p.y - m.y) < 2) {
            G.hurtPlayer(m.sp.dmg, m.x, m.z);
          }
        }
      } else if (m.act === 'recover') {
        m.actT += dt;
        arms = 0.9 - m.actT;
        if (m.actT > 0.75) m.act = 'idle';
      } else if (canSee(m, d)) {
        m.face = Math.atan2(p.x - m.x, p.z - m.z);
        if (d > reach) {
          const v = 3.5 * m.sp.speed * dt;
          if (stepTo(rt, m, m.x + ((p.x - m.x) / d) * v, m.z + ((p.z - m.z) / d) * v)) stride = 1;
        } else {
          m.act = 'windup';
          m.actT = 0;
        }
      } else {
        // Amble about near the den.
        m.wait -= dt;
        if (m.wait <= 0) {
          const ang = Math.random() * 6.28;
          m.goalX = m.den.x + Math.cos(ang) * 6;
          m.goalZ = m.den.z + Math.sin(ang) * 6;
          m.wait = 3 + Math.random() * 4;
        }
        const gd = dist(m.x, m.z, m.goalX, m.goalZ);
        if (gd > 0.6) {
          m.face = Math.atan2(m.goalX - m.x, m.goalZ - m.z);
          if (stepTo(rt, m, m.x + ((m.goalX - m.x) / gd) * 1.4 * dt, m.z + ((m.goalZ - m.z) / gd) * 1.4 * dt)) stride = 0.5;
          else m.goalX = m.x, m.goalZ = m.z;
        }
      }
      m.phase += dt * 7 * stride;
      const s = Math.sin(m.phase) * 0.6 * Math.min(1, stride * 2);
      a.legL.rotation.x = s;
      a.legR.rotation.x = -s;
      a.armL.rotation.x += (arms - s * 0.5 - a.armL.rotation.x) * Math.min(1, dt * 18);
      a.armR.rotation.x += (arms + s * 0.5 - a.armR.rotation.x) * Math.min(1, dt * 18);
      a.group.position.set(m.x, m.y, m.z);
    }

    // ---------- wisps ----------

    function updateWisp(rt, m, dt, d) {
      const p = G.player, a = m.actor;
      const feet = m.y - 0.55;
      const move = (vx, vy, vz) => {
        const spot = { x: m.x + vx * dt, z: m.z + vz * dt };
        Physics.pushOut(rt.space, spot, feet, a.radius, 1.1);
        m.x = spot.x;
        m.z = spot.z;
        m.y += vy * dt;
      };
      const floor = Math.max(floorAt(rt, m.x, m.z, m.y), rt.dryLevel - 0.4);
      m.cool -= dt;
      if (m.act === 'dive') {
        m.actT += dt;
        move(m.dx * 13, m.dy * 13, m.dz * 13);
        if (m.y < floor + 0.6) m.y = floor + 0.6;
        const hit = Math.hypot(p.x - m.x, p.y + 1 - m.y, p.z - m.z) < a.radius + 0.6;
        if (hit && G.mode === 'play' && p.invuln <= 0) G.hurtPlayer(m.sp.dmg, m.x, m.z);
        if (m.actT > 0.75 || hit) {
          m.act = 'idle';
          m.cool = 1.9;
        }
      } else {
        const seen = canSee(m, d);
        // Hang back at a distance from the player, or drift round the den.
        let gx = m.den.x + Math.cos(G.time * 0.4 + m.phase) * 4, gz = m.den.z + Math.sin(G.time * 0.4 + m.phase) * 4;
        if (seen) {
          gx = p.x - ((p.x - m.x) / d) * 6.5;
          gz = p.z - ((p.z - m.z) / d) * 6.5;
          m.face = Math.atan2(p.x - m.x, p.z - m.z);
          if (d < 9 && m.cool <= 0) {
            // Line up on the player and swoop.
            const len = Math.hypot(p.x - m.x, p.y + 1 - m.y, p.z - m.z) || 1;
            m.dx = (p.x - m.x) / len;
            m.dy = (p.y + 1 - m.y) / len;
            m.dz = (p.z - m.z) / len;
            m.act = 'dive';
            m.actT = 0;
          }
        }
        const gd = dist(m.x, m.z, gx, gz);
        const speed = (seen ? 4.6 : 1.6) * m.sp.speed;
        const want = floor + 2.6 + Math.sin(G.time * 2 + m.phase) * 0.3;
        move(gd > 0.3 ? ((gx - m.x) / gd) * speed : 0, (want - m.y) * 2.5, gd > 0.3 ? ((gz - m.z) / gd) * speed : 0);
        if (!seen && gd > 0.3) m.face = Math.atan2(gx - m.x, gz - m.z);
      }
      a.group.position.set(m.x, m.y, m.z);
    }

    // ---------- wild animals ----------

    function updateAnimal(rt, m, dt, d) {
      const p = G.player, a = m.actor;
      let stride = 0;
      if (m.scared > 0) {
        // Run from the player.
        m.scared -= dt;
        const v = 5.6 * m.sp.speed * dt;
        m.face = Math.atan2(m.x - p.x, m.z - p.z) + Math.sin(G.time * 3 + m.phase) * 0.5;
        if (stepTo(rt, m, m.x + Math.sin(m.face) * v, m.z + Math.cos(m.face) * v)) stride = 1.6;
        else m.face += 1.6;
      } else {
        m.wait -= dt;
        if (m.wait <= 0) {
          const ang = Math.random() * 6.28, far = 2 + Math.random() * 8;
          m.goalX = m.den.x + Math.cos(ang) * far;
          m.goalZ = m.den.z + Math.sin(ang) * far;
          m.wait = 3 + Math.random() * 6;
        }
        const gd = dist(m.x, m.z, m.goalX, m.goalZ);
        if (gd > 0.6) {
          m.face = Math.atan2(m.goalX - m.x, m.goalZ - m.z);
          const v = 1.3 * m.sp.speed * dt;
          if (stepTo(rt, m, m.x + ((m.goalX - m.x) / gd) * v, m.z + ((m.goalZ - m.z) / gd) * v)) stride = 0.6;
          else m.goalX = m.x, m.goalZ = m.z;
        }
      }
      m.phase += dt * 9 * stride;
      const s = Math.sin(m.phase) * 0.55 * Math.min(1, stride * 2);
      a.legs.forEach((leg, n) => { leg.rotation.x = n % 3 === 0 ? s : -s; });
      a.group.position.set(m.x, m.y, m.z);
    }

    function updateFish(rt, m, dt) {
      const deep = m.den.depth !== undefined; // a reef fish, down among the coral
      const wet = (x, z) => { const h = rt.space.heightAt(x, z); return h < -0.55 && (deep || h > -3.5); };
      m.wait -= dt;
      if (m.scared > 0) m.scared -= dt;
      if (m.wait <= 0 || !wet(m.goalX, m.goalZ)) {
        const ang = Math.random() * 6.28, far = 2 + Math.random() * 7;
        const gx = m.den.x + Math.cos(ang) * far, gz = m.den.z + Math.sin(ang) * far;
        if (wet(gx, gz)) {
          m.goalX = gx;
          m.goalZ = gz;
        }
        m.wait = 2 + Math.random() * 3;
      }
      const gd = dist(m.x, m.z, m.goalX, m.goalZ);
      if (gd > 0.4) {
        const v = (m.scared > 0 ? 4 : 1.5) * dt;
        const nx = m.x + ((m.goalX - m.x) / gd) * v, nz = m.z + ((m.goalZ - m.z) / gd) * v;
        if (wet(nx, nz)) {
          m.x = nx;
          m.z = nz;
          m.face = Math.atan2(m.goalX - m.x, m.goalZ - m.z);
        }
      }
      m.y = Math.max(deep ? m.den.depth : SWIM, rt.space.heightAt(m.x, m.z) + 0.5) + Math.sin(G.time * 2 + m.phase) * 0.06;
      m.actor.inner.rotation.y = Math.sin(G.time * 8 + m.phase) * 0.25; // a wiggle
      m.actor.group.position.set(m.x, m.y, m.z);
    }

    // Sharks patrol the deep and go for anyone swimming there.
    function updateShark(rt, m, dt, d) {
      const p = G.player;
      const deepAt = (x, z) => rt.space.heightAt(x, z) < -3.2;
      const swimmer = G.mode === 'play' && !G.boat.riding && p.swimming;
      m.cool -= dt;
      const hunting = swimmer && d < 26 && m.cool <= 0;
      const gx = hunting ? p.x : m.den.x + Math.cos(G.time * 0.25 + m.phase) * 9;
      const gz = hunting ? p.z : m.den.z + Math.sin(G.time * 0.25 + m.phase) * 9;
      const gd = dist(m.x, m.z, gx, gz);
      if (gd > 0.3) {
        const v = (hunting ? 6.4 : 2.2) * dt;
        const nx = m.x + ((gx - m.x) / gd) * v, nz = m.z + ((gz - m.z) / gd) * v;
        if (deepAt(nx, nz)) {
          m.x = nx;
          m.z = nz;
        }
        m.face = Math.atan2(gx - m.x, gz - m.z);
      }
      const want = hunting ? Math.min(-0.9, p.y + 0.5) : -2.6;
      m.y += (Math.max(want, rt.space.heightAt(m.x, m.z) + 0.7) - m.y) * Math.min(1, dt * 2);
      if (swimmer && p.invuln <= 0 && Math.hypot(p.x - m.x, p.y + 0.8 - m.y, p.z - m.z) < 1.8) {
        G.hurtPlayer(m.sp.dmg, m.x, m.z);
        m.cool = 2.4; // circles away before the next pass
      }
      m.actor.inner.rotation.y = Math.sin(G.time * 5 + m.phase) * 0.14;
      m.actor.group.position.set(m.x, m.y, m.z);
    }

    // ---------- shared ----------

    function kill(rt, m) {
      m.alive = false;
      m.dying = 0.3;
      m.deadUntil = G.time + (m.den.wild ? 150 : 75) + Math.random() * 45;
      Sound.pop();
      G.particles.burst(m.x, centreY(m), m.z, m.sp.color, 16, 5, 0.8, 9, m.sp.scale);
      if (m.sp.meat) {
        // Animals leave meat. A fish's floats at the surface.
        for (let i = 0; i < m.sp.meat; i++) G.dropLoot(m.x, Math.max(centreY(m), 0.4), m.z, 'meat');
      } else {
        const drop = Rules.rollDrop(G.state, m.sp.luck, Math.random());
        if (drop) G.dropLoot(m.x, centreY(m), m.z, drop);
      }
      G.onKill(m);
    }

    // Hurts a monster and knocks it away from (fromX, fromZ).
    function damage(m, amount, fromX, fromZ, knock) {
      const rt = G.zone;
      m.hp -= amount;
      m.hop = null;
      if (m.act !== 'dive') m.act = 'idle';
      m.hurt = 0.35;
      if (m.den.wild) m.scared = 5;
      const dx = m.x - fromX, dz = m.z - fromZ, d = Math.hypot(dx, dz) || 1;
      const push = knock / (0.6 + m.sp.scale * 0.6);
      m.kx = (dx / d) * push;
      m.kz = (dz / d) * push;
      Sound.hit();
      G.particles.burst(m.x, centreY(m), m.z, 0xffffff, 6, 4, 0.4);
      if (m.hp <= 0) kill(rt, m);
    }

    function update(dt) {
      const rt = G.zone, p = G.player;
      const night = Rules.isNight(G.state.clock);
      for (let n = rt.monsters.length - 1; n >= 0; n--) {
        const m = rt.monsters[n];
        if (!m.alive) {
          if (m.dying > 0) {
            m.dying -= dt;
            m.actor.group.scale.setScalar(Math.max(0.001, m.dying / 0.3));
            if (m.dying <= 0) m.actor.group.visible = false;
          } else if (G.time >= m.deadUntil && (always(m) || night)) {
            // Animals are simply there; monsters step out of the dark, never right beside the player.
            const away = dist(m.den.x, m.den.z, p.x, p.z);
            if (away < (always(m) ? 100 : 85) && (always(m) || away > 24)) appear(rt, m, m.den.x, m.den.z);
          }
          continue;
        }
        const d = dist(m.x, m.z, p.x, p.z);
        if (!always(m) && !night) {
          vanish(m, d < 60); // monsters fade at sunrise
          continue;
        }
        if (d > 130) {
          vanish(m, false);
          continue;
        }
        if (d > 75) continue;
        if (m.hurt > 0) {
          m.hurt -= dt;
          const spot = { x: m.x + m.kx * dt, z: m.z + m.kz * dt };
          Physics.pushOut(rt.space, spot, flies(m) ? m.y - 0.55 : m.y, m.actor.radius, 1.1);
          const water = rt.space.heightAt(spot.x, spot.z);
          if (swims(m) ? water < (m.sp.body === 'shark' ? -3.2 : -0.55) : flies(m) || floorAt(rt, spot.x, spot.z, m.y) >= rt.dryLevel) {
            m.x = spot.x;
            m.z = spot.z;
          }
          m.kx *= Math.exp(-7 * dt);
          m.kz *= Math.exp(-7 * dt);
          m.actor.mat.emissive.setHex(m.hurt > 0.2 ? 0xffffff : m.actor.rest);
          if (!flies(m)) m.y = floorAt(rt, m.x, m.z, m.y + 0.3);
          m.actor.group.position.set(m.x, m.y, m.z);
          if (m.hurt <= 0) m.wait = 0.2;
        } else if (m.sp.body === 'animal') updateAnimal(rt, m, dt, d);
        else if (m.sp.body === 'fish') updateFish(rt, m, dt);
        else if (m.sp.body === 'shark') updateShark(rt, m, dt, d);
        else if (m.sp.body === 'brute') updateBrute(rt, m, dt, d);
        else if (m.sp.body === 'wisp') updateWisp(rt, m, dt, d);
        else updateBlob(rt, m, dt, d);
        m.actor.group.rotation.y = turnToward(m.actor.group.rotation.y, m.face, 9 * dt);
      }
    }

    // A swing lands: hurt every monster in the arc. Returns how many were hit.
    function strike(weapon, amount) {
      const p = G.player;
      const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
      let hits = 0;
      for (const m of G.zone.monsters) {
        if (!m.alive || m.hurt > 0.15) continue;
        const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 0.001;
        if (d > weapon.reach + m.actor.radius || Math.abs(centreY(m) - (p.y + 1)) > 2.7) continue;
        if (d > 1.3 + m.actor.radius && (dx * hx + dz * hz) / d < weapon.arc) continue;
        damage(m, amount, p.x, p.z, weapon.knock);
        hits++;
      }
      return hits;
    }

    // The nearest creature roughly in front of the player. With `hostile`,
    // animals and fish are ignored.
    function nearest(range, cone, hostile) {
      const p = G.player;
      const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
      let best = null;
      for (const m of G.zone.monsters) {
        if (!m.alive || (hostile && m.den.wild)) continue;
        const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 0.001;
        if (d > range || (d > 4 && (dx * hx + dz * hz) / d < cone)) continue;
        if (!best || d < best.d) best = { d, x: m.x, y: centreY(m), z: m.z };
      }
      return best;
    }

    // A blaster bolt at (x, y, z): hurts the first monster it touches.
    function boltHit(x, y, z, amount, knock) {
      for (const m of G.zone.monsters) {
        if (!m.alive) continue;
        if (Math.hypot(m.x - x, centreY(m) - y, m.z - z) > m.actor.radius + 0.45) continue;
        damage(m, amount, G.player.x, G.player.z, knock);
        return true;
      }
      return false;
    }

    // Sends every creature back to its den (after the player is knocked out).
    function reset(rt) {
      for (const m of rt.monsters) if (m.alive) vanish(m, false);
    }

    return { populate, update, strike, nearest, boltHit, damage, reset };
  }

  WS.Monsters = { create };
})();
