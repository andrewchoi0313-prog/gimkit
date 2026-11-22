// Everything drawn over the 3D scene: hearts, counters, the map, speech,
// prompts and the title, pause and win screens.
(function () {
  'use strict';

  const BI = (window.BI = window.BI || {});
  const Island = BI.Island;
  const $ = (id) => document.getElementById(id);

  const HEART_PATH = 'M12 21s-9-5.7-9-12.2a5 5 0 0 1 9-3 5 5 0 0 1 9 3C21 15.3 12 21 12 21z';

  const el = {
    hud: $('hud'), hearts: $('hearts'), shards: $('shard-count'), coins: $('coin-count'), key: $('key-badge'),
    objective: $('objective'), toast: $('toast'), prompt: $('prompt'), promptText: $('prompt-text'),
    talk: $('talk'), talkName: $('talk-name'), talkText: $('talk-text'), touch: $('touch'), useBtn: $('btn-use'),
    fade: $('fade'), note: $('title-note'), mute: $('mute-btn'),
  };

  const shown = { hearts: -1, shards: -1, coins: -1, prompt: null };

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

  function bump(node) {
    const pill = node.parentElement;
    pill.classList.remove('bump');
    void pill.offsetWidth; // restart the animation
    pill.classList.add('bump');
  }

  function setCounts(shards, coins, hasKey) {
    if (shown.shards !== shards) {
      if (shown.shards >= 0) bump(el.shards);
      shown.shards = shards;
      el.shards.textContent = shards;
    }
    if (shown.coins !== coins) {
      if (shown.coins >= 0) bump(el.coins);
      shown.coins = coins;
      el.coins.textContent = coins;
    }
    el.key.hidden = !hasKey;
  }

  function setObjective(text) {
    if (el.objective.textContent !== text) el.objective.textContent = text;
  }

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

  // A tap on the speech box. The tap that opened the box can land on it too,
  // so taps in the first moments are ignored. Returns true if a new line shows.
  function tapTalk() {
    if (!speech || performance.now() - speech.openedAt < 350) return false;
    return advance();
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

  function closeTalk() {
    speech = null;
    el.talk.hidden = true;
    el.hud.classList.remove('talking');
  }

  // ---------- screens ----------

  function show(id, visible) {
    $(id).hidden = !visible;
  }

  function setHud(visible) {
    el.hud.hidden = !visible;
  }

  function setTouch(on) {
    el.touch.hidden = !on;
    el.hud.classList.toggle('touch-on', on);
  }

  function setFade(on) {
    el.fade.classList.toggle('on', on);
  }

  function setNote(text) {
    el.note.hidden = !text;
    el.note.textContent = text || '';
  }

  function setMuted(muted) {
    el.mute.textContent = muted ? 'Sound off' : 'Sound on';
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function setWinStats(stats) {
    $('stat-time').textContent = formatTime(stats.time);
    $('stat-coins').textContent = stats.coins;
    $('stat-defeated').textContent = stats.defeated;
    $('stat-faints').textContent = stats.faints;
  }

  // ---------- map ----------

  function createMinimap(terrain) {
    const canvas = $('minimap');
    const g = canvas.getContext('2d');
    const size = canvas.width;
    const reach = 134; // world units from the centre of the map to its edge
    const toMap = (v) => (v / reach * 0.5 + 0.5) * size;

    // Paint the island once.
    const base = document.createElement('canvas');
    base.width = base.height = size;
    const bg = base.getContext('2d');
    const image = bg.createImageData(size, size);
    const m = Island.PLACES.mountain;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = ((px + 0.5) / size * 2 - 1) * reach;
        const z = ((py + 0.5) / size * 2 - 1) * reach;
        const h = terrain.heightAt(x, z);
        let r, gr, b;
        if (h < -1.3) { r = 29; gr = 84; b = 118; }
        else if (h < 0.1) { r = 58; gr = 138; b = 160; }
        else if (h < 1.25) { r = 232; gr = 214; b = 160; }
        else if (Island.distToPaths(x, z) < 1.7) { r = 176; gr = 138; b = 98; }
        else if (h > 21 && Island.dist(x, z, m.x, m.z) < 30) { r = 240; gr = 244; b = 248; }
        else if (h > 12) { r = 150; gr = 146; b = 140; }
        else if (Island.inForest(x, z)) { r = 74; gr = 138; b = 78; }
        else { r = 122; gr = 188; b = 88; }
        // Shade slopes so hills read on the map.
        const shade = h > 0.1 ? Math.max(0.75, Math.min(1.2, 1 + (terrain.heightAt(x - 2, z - 2) - terrain.heightAt(x + 2, z + 2)) * 0.05)) : 1;
        const i = (py * size + px) * 4;
        image.data[i] = Math.min(255, r * shade);
        image.data[i + 1] = Math.min(255, gr * shade);
        image.data[i + 2] = Math.min(255, b * shade);
        image.data[i + 3] = 255;
      }
    }
    bg.putImageData(image, 0, 0);

    // marks: [{ x, z, kind: 'shard' | 'lighthouse' }]
    function draw(player, marks, time) {
      g.drawImage(base, 0, 0);
      for (const mark of marks) {
        const x = toMap(mark.x);
        const y = toMap(mark.z);
        if (mark.kind === 'shard') {
          const pulse = 0.5 + 0.5 * Math.sin(time * 3 + mark.x);
          g.strokeStyle = 'rgba(15,34,56,0.85)';
          g.lineWidth = 7;
          g.beginPath();
          g.arc(x, y, 11 + pulse * 3, 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = '#7fe3e0';
          g.lineWidth = 4;
          g.stroke();
          g.fillStyle = '#f7efdc';
          g.beginPath();
          g.arc(x, y, 3.5, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = '#0f2238';
          g.beginPath();
          g.arc(x, y, 10, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#ffc857';
          g.beginPath();
          g.arc(x, y, 6.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      // The player: an arrow pointing the way they face.
      g.save();
      g.translate(toMap(player.x), toMap(player.z));
      g.rotate(Math.PI - player.heading);
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(9, 10);
      g.lineTo(0, 5);
      g.lineTo(-9, 10);
      g.closePath();
      g.fillStyle = '#f7efdc';
      g.strokeStyle = '#0f2238';
      g.lineWidth = 3.5;
      g.lineJoin = 'round';
      g.stroke();
      g.fill();
      g.restore();
    }

    return { draw };
  }

  BI.UI = {
    setHearts, setCounts, setObjective, toast, setPrompt,
    talk, advance, tapTalk, closeTalk,
    show, setHud, setTouch, setFade, setNote, setMuted, setWinStats, formatTime, createMinimap,
  };
})();
