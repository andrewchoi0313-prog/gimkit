// Sound effects made with the Web Audio API, so the game needs no audio files.
(function () {
  'use strict';

  const RS = (window.RS = window.RS || {});

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

  // A quiet wash of wind and waves that loops for the whole game.
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

  RS.Sound = {
    init,
    toggleMute,
    isMuted: () => muted,
    heart() { tone(523, 0.12, { type: 'triangle' }); tone(784, 0.22, { type: 'triangle', delay: 0.1 }); },
    jump() { tone(300, 0.16, { type: 'triangle', volume: 0.12, slide: 260 }); },
    swing() { hiss(0.16, 0.16, 2400); },
    chop() { hiss(0.24, 0.2, 1400); tone(140, 0.18, { type: 'triangle', volume: 0.1, slide: -60 }); },
    shoot() { tone(900, 0.16, { type: 'square', volume: 0.1, slide: -620 }); hiss(0.08, 0.08, 4000); },
    hit() { tone(210, 0.12, { type: 'square', volume: 0.14, slide: -120 }); hiss(0.1, 0.12, 1200); },
    pop() { tone(160, 0.25, { type: 'sawtooth', volume: 0.14, slide: -110 }); hiss(0.22, 0.14, 900); },
    hurt() { tone(330, 0.26, { type: 'sawtooth', volume: 0.16, slide: -200 }); },
    splash() { hiss(0.4, 0.2, 700); },
    blip() { tone(520 + Math.random() * 120, 0.06, { type: 'triangle', volume: 0.1 }); },
    place() { tone(190, 0.07, { type: 'square', volume: 0.1, slide: -50 }); hiss(0.05, 0.1, 1800); },
    remove() { tone(260, 0.08, { type: 'triangle', volume: 0.12, slide: 140 }); },
    nope() { tone(150, 0.12, { type: 'sawtooth', volume: 0.08 }); },
    door() { tone(170, 0.2, { type: 'triangle', volume: 0.14, slide: 90 }); hiss(0.2, 0.06, 500); },
    weapon() { [659, 880, 1109].forEach((f, i) => tone(f, 0.18, { type: 'triangle', volume: 0.15, delay: i * 0.08 })); },
    portal() { tone(140, 0.9, { type: 'sine', volume: 0.2, slide: 700 }); tone(210, 0.9, { type: 'triangle', volume: 0.1, slide: 900, delay: 0.05 }); hiss(0.8, 0.1, 900); },
    crystal() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.34, { type: 'triangle', volume: 0.16, delay: i * 0.1 })); },
    dusk() { [220, 262, 311].forEach((f) => tone(f, 1.4, { type: 'sine', volume: 0.09 })); },
    dawn() { [392, 494, 587].forEach((f, i) => tone(f, 0.9, { type: 'sine', volume: 0.1, delay: i * 0.12 })); },
    roar() { tone(90, 0.9, { type: 'sawtooth', volume: 0.22, slide: -40 }); tone(134, 0.9, { type: 'sawtooth', volume: 0.12, slide: -60 }); hiss(0.7, 0.12, 500); },
    stomp() { tone(70, 0.5, { type: 'sine', volume: 0.3, slide: -30 }); hiss(0.45, 0.25, 420); },
    seal() { tone(880, 1.2, { type: 'sine', volume: 0.14, slide: -700 }); hiss(1, 0.12, 1500); },
    win() {
      [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i === 6 ? 1.2 : 0.3, { type: 'triangle', volume: 0.18, delay: i * 0.22 }));
      [196, 262, 330].forEach((f) => tone(f, 1.6, { type: 'sine', volume: 0.1, delay: 1.3 }));
    },
  };
})();
