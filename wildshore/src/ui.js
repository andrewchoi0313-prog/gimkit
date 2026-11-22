// Everything drawn over the 3D scene: hearts, meat, the weapon bar, the
// map, speech, prompts and the title and pause screens.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const Zones = WS.Zones;
  const $ = (id) => document.getElementById(id);

  const HEART_PATH = 'M12 21s-9-5.7-9-12.2a5 5 0 0 1 9-3 5 5 0 0 1 9 3C21 15.3 12 21 12 21z';
  const WEAPON_ICONS = {
    stick: '<path d="M5 19 19 5" stroke="#b9844f" stroke-width="3" stroke-linecap="round"/><path d="M13 11l3 1" stroke="#b9844f" stroke-width="2.4" stroke-linecap="round"/>',
    sword: '<path d="M8 16 19 5" stroke="#dfe7ef" stroke-width="3.2" stroke-linecap="round"/><path d="M6 13l5 5" stroke="#e2a83a" stroke-width="2.6" stroke-linecap="round"/><path d="M4.5 19.5 7 17" stroke="#8a5f3c" stroke-width="3" stroke-linecap="round"/>',
    axe: '<path d="M5 20 17 8" stroke="#8a5f3c" stroke-width="2.8" stroke-linecap="round"/><path d="M12 4c4.5 0 8 3.5 8 8l-5 1-4-4z" fill="#dfe7ef"/>',
    blaster: '<path d="M3 9h13l3 2v3H9l-1 5H4l1-5H3z" fill="#3b8d99"/><circle cx="19.5" cy="12.5" r="1.8" fill="#8ff6ff"/><path d="M6 11h7" stroke="#8ff6ff" stroke-width="1.6" stroke-linecap="round"/>',
  };

  const el = {
    hud: $('hud'), hearts: $('hearts'), meat: $('meat-count'), zone: $('zone-name'), clock: $('clock'),
    objective: $('objective'), toast: $('toast'), prompt: $('prompt'), promptText: $('prompt-text'),
    talk: $('talk'), talkName: $('talk-name'), talkText: $('talk-text'), touch: $('touch'), useBtn: $('btn-use'),
    fade: $('fade'), note: $('title-note'), mute: $('mute-btn'), slots: $('slots'), swingBtn: $('btn-swing'), eatBtn: $('eat-btn'),
  };

  const shown = { hearts: -1, meat: -1, prompt: null, bar: '' };

  function setHearts(count, max) {
    if (shown.hearts === count) return;
    shown.hearts = count;
    let html = '';
    for (let i = 0; i < max; i++) {
      html += '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="' + (i < count ? 'full' : 'empty') + '" d="' + HEART_PATH + '"/></svg>';
    }
    el.hearts.innerHTML = html;
    el.hearts.setAttribute('aria-label', count + ' of ' + max + ' hearts');
  }

  function setMeat(count) {
    if (shown.meat === count) return;
    if (shown.meat >= 0) {
      const pill = el.meat.parentElement;
      pill.classList.remove('bump');
      void pill.offsetWidth; // restart the animation
      pill.classList.add('bump');
    }
    shown.meat = count;
    el.meat.textContent = count;
    el.eatBtn.disabled = count === 0;
  }

  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const setObjective = (text) => setText(el.objective, text);
  const setZone = (text) => setText(el.zone, text);
  const setClock = (text) => setText(el.clock, text);

  let toastTimer = 0;
  function toast(text, ms) {
    el.toast.hidden = true;
    void el.toast.offsetWidth;
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms || 2800);
  }

  function setPrompt(text) {
    if (shown.prompt === text) return;
    shown.prompt = text;
    el.prompt.hidden = !text;
    el.useBtn.hidden = !text;
    if (text) el.promptText.textContent = text;
  }

  // ---------- hotbar ----------

  let slotHandler = null;

  // bar: { selected, swingLabel, slots: [{ id, name, level }] }: the weapons owned.
  function setBar(bar) {
    const signature = bar.slots.map((s) => s.id + s.level).join(',');
    if (signature !== shown.bar) {
      shown.bar = signature;
      el.slots.innerHTML = '';
      bar.slots.forEach((slot, n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot';
        b.title = slot.name;
        b.setAttribute('aria-label', slot.name);
        b.innerHTML = '<span class="num">' + (n + 1) + '</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + WEAPON_ICONS[slot.id] + '</svg>'
          + (slot.level > 1 ? '<span class="lvl">+' + (slot.level - 1) + '</span>' : '');
        b.addEventListener('click', () => { if (slotHandler) slotHandler(n); });
        el.slots.appendChild(b);
      });
    }
    [...el.slots.children].forEach((b, n) => b.classList.toggle('on', n === bar.selected));
    setText(el.swingBtn, bar.swingLabel);
  }

  // ---------- speech ----------

  let speech = null;

  function talk(speaker, lines, done) {
    speech = { lines, index: 0, done, openedAt: performance.now() };
    el.talkName.textContent = speaker;
    el.talkText.textContent = lines[0];
    el.talk.hidden = false;
    el.hud.classList.add('talking');
    setPrompt(null);
  }

  // Shows the next line. Returns false once the speech has finished.
  function advance() {
    if (!speech) return false;
    speech.index += 1;
    if (speech.index < speech.lines.length) {
      el.talkText.textContent = speech.lines[speech.index];
      return true;
    }
    const done = speech.done;
    closeTalk();
    if (done) done();
    return false;
  }

  // A tap on the speech box. The tap that opened the box can land on it too,
  // so taps in the first moments are ignored.
  function tapTalk() {
    if (!speech || performance.now() - speech.openedAt < 350) return false;
    return advance();
  }

  function closeTalk() {
    speech = null;
    el.talk.hidden = true;
    el.hud.classList.remove('talking');
  }

  // ---------- screens ----------

  const show = (id, visible) => { $(id).hidden = !visible; };
  const setHud = (visible) => { el.hud.hidden = !visible; };
  const setFade = (on) => { el.fade.classList.toggle('on', on); };
  const setMuted = (muted) => { el.mute.textContent = muted ? 'Sound off' : 'Sound on'; };

  function setTouch(on) {
    el.touch.hidden = !on;
    el.hud.classList.toggle('touch-on', on);
  }

  function setNote(text) {
    el.note.hidden = !text;
    el.note.textContent = text || '';
  }

  // ---------- map ----------

  const MAP_COLORS = {
    meadow: [122, 188, 88], forest: [74, 138, 78], desert: [228, 198, 128], snow: [238, 243, 248],
    swamp: [98, 134, 74], blight: [92, 84, 104], bloom: [150, 214, 104],
  };

  function paintMap(zone) {
    const def = zone.def;
    const res = 190;
    const reach = def.size / 2 * 0.97;
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d');
    const scale = (v) => (v / reach * 0.5 + 0.5) * res;
    const image = g.createImageData(res, res);
    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        const x = ((px + 0.5) / res * 2 - 1) * reach, z = ((py + 0.5) / res * 2 - 1) * reach;
        const h = zone.heightAt(x, z);
        let rgb;
        if (h < -1.3) rgb = [29, 84, 118];
        else if (h < 0.1) rgb = [58, 138, 160];
        else {
          const biome = zone.biomeAt(x, z);
          if (biome === 'swamp') rgb = h < 1 ? [108, 104, 74] : MAP_COLORS.swamp;
          else if (h < 1.25) rgb = [232, 214, 160];
          else rgb = MAP_COLORS[biome];
        }
        // Shade slopes so hills read on the map.
        const lit = h > 0.2 ? Math.max(0.78, Math.min(1.18, 1 + (zone.heightAt(x - 6, z - 6) - zone.heightAt(x + 6, z + 6)) * 0.02)) : 1;
        const i = (py * res + px) * 4;
        image.data[i] = Math.min(255, rgb[0] * lit);
        image.data[i + 1] = Math.min(255, rgb[1] * lit);
        image.data[i + 2] = Math.min(255, rgb[2] * lit);
        image.data[i + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
    return { canvas: c, reach };
  }

  function createMinimap() {
    const canvas = $('minimap');
    const g = canvas.getContext('2d');
    const size = canvas.width;
    const maps = {};
    let map = null;
    const at = (v) => (v / map.reach * 0.5 + 0.5) * size;

    function setZone(zone) {
      if (!maps[zone.def.id]) maps[zone.def.id] = paintMap(zone);
      map = maps[zone.def.id];
    }

    // marks: [{ x, z, kind: 'home' | 'boat' | 'chest', pulse }]
    function draw(player, marks, time) {
      if (!map) return;
      g.imageSmoothingEnabled = true;
      g.drawImage(map.canvas, 0, 0, size, size);
      for (const mark of marks) {
        const x = at(mark.x), y = at(mark.z);
        const beat = mark.pulse ? 0.5 + 0.5 * Math.sin(time * 3 + mark.x) : 0;
        if (mark.kind === 'home') {
          g.fillStyle = '#1d1730';
          g.fillRect(x - 9, y - 9, 18, 18);
          g.fillStyle = '#ffa94d';
          g.fillRect(x - 6, y - 6, 12, 12);
        } else if (mark.kind === 'boat') {
          g.fillStyle = '#1d1730';
          g.beginPath();
          g.arc(x, y, 8, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#f8f1e1';
          g.beginPath();
          g.arc(x, y, 5, 0, Math.PI * 2);
          g.fill();
        } else {
          // A chest: gold, and pulsing once its island has been reached.
          g.strokeStyle = 'rgba(29,23,48,0.9)';
          g.lineWidth = 8;
          g.beginPath();
          g.arc(x, y, 9 + beat * 4, 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = '#ffd24a';
          g.lineWidth = 4.5;
          g.stroke();
        }
      }
      // The player: an arrow pointing the way they face.
      g.save();
      g.translate(at(player.x), at(player.z));
      g.rotate(Math.PI - player.heading);
      g.beginPath();
      g.moveTo(0, -14);
      g.lineTo(10, 11);
      g.lineTo(0, 5);
      g.lineTo(-10, 11);
      g.closePath();
      g.fillStyle = '#f8f1e1';
      g.strokeStyle = '#1d1730';
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.stroke();
      g.fill();
      g.restore();
    }

    return { setZone, draw };
  }

  WS.UI = {
    setHearts, setMeat, setObjective, setZone, setClock, toast, setPrompt, setBar,
    onSlot(handler) { slotHandler = handler; },
    talk, advance, tapTalk, closeTalk,
    show, setHud, setTouch, setFade, setNote, setMuted, createMinimap,
  };
})();
