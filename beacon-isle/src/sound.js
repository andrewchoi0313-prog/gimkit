// Sound effects made with the Web Audio API, so the game needs no audio files.
(function () {
  'use strict';

  const BI = (window.BI = window.BI || {});

  let ctx = null;
  let master = null;
  let muted = false;

  // Browsers only allow sound after a click or key press, so this is called
  // from the Start button.
  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      startSea();
    } catch (err) {
      ctx = null;
    }
  }

  function tone(freq, length, options) {
    if (!ctx) return;
    const o = Object.assign({ type: 'sine', volume: 0.2, slide: 0, delay: 0 }, options);
    const start = ctx.currentTime + o.delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, start);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + o.slide), start + length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(o.volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + length + 0.03);
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function hiss(length, volume, cutoff) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(length);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  // A quiet wash of waves that loops for the whole game.
  function startSea() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const swell = ctx.createOscillator();
    const depth = ctx.createGain();
    swell.frequency.value = 0.13;
    depth.gain.value = 0.035;
    swell.connect(depth);
    depth.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    swell.start();
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  BI.Sound = {
    init,
    toggleMute,
    isMuted: () => muted,
    coin() { tone(988, 0.07, { type: 'square', volume: 0.08 }); tone(1319, 0.16, { type: 'square', volume: 0.08, delay: 0.07 }); },
    heart() { tone(523, 0.12, { type: 'triangle' }); tone(784, 0.22, { type: 'triangle', delay: 0.1 }); },
    jump() { tone(300, 0.16, { type: 'triangle', volume: 0.12, slide: 260 }); },
    swing() { hiss(0.16, 0.16, 2400); },
    hit() { tone(210, 0.12, { type: 'square', volume: 0.14, slide: -120 }); hiss(0.1, 0.12, 1200); },
    pop() { tone(160, 0.25, { type: 'sawtooth', volume: 0.14, slide: -110 }); hiss(0.22, 0.14, 900); },
    hurt() { tone(330, 0.26, { type: 'sawtooth', volume: 0.16, slide: -200 }); },
    splash() { hiss(0.4, 0.2, 700); },
    blip() { tone(520 + Math.random() * 120, 0.06, { type: 'triangle', volume: 0.1 }); },
    rune() { tone(392, 0.5, { type: 'sine', volume: 0.18 }); tone(784, 0.5, { type: 'sine', volume: 0.07 }); },
    wrong() { tone(196, 0.3, { type: 'sawtooth', volume: 0.13 }); tone(185, 0.34, { type: 'sawtooth', volume: 0.13, delay: 0.05 }); },
    open() { tone(180, 0.3, { type: 'triangle', volume: 0.16, slide: 120 }); hiss(0.3, 0.08, 600); },
    key() { [784, 988, 1175].forEach((f, i) => tone(f, 0.16, { type: 'triangle', volume: 0.14, delay: i * 0.09 })); },
    shard() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.34, { type: 'triangle', volume: 0.16, delay: i * 0.1 })); },
    win() {
      [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i === 6 ? 1.2 : 0.3, { type: 'triangle', volume: 0.18, delay: i * 0.22 }));
      [196, 262, 330].forEach((f) => tone(f, 1.6, { type: 'sine', volume: 0.1, delay: 1.3 }));
    },
  };
})();
