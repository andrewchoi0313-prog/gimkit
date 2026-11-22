// Keyboard, mouse and touch controls, gathered into one small object the
// game loop reads each frame.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});

  const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyJ', 'KeyE', 'Enter', 'KeyP', 'KeyM',
    'KeyQ', 'KeyR',
  ]);

  function create(canvas) {
    const keys = {};
    const input = {
      moveX: 0,        // -1 (left) .. 1 (right)
      moveY: 0,        // -1 (back) .. 1 (forward)
      turn: 0,         // -1 .. 1 from the arrow keys
      run: false,
      lookX: 0,        // camera drag since the last frame, in pixels
      lookY: 0,
      zoom: 0,
      swingHeld: false,
      jumpHeld: false,
      dive: false,       // Shift, or the on-screen Swing button held: dive when swimming
      swingTouch: false, // the on-screen Swing button is down
      // These are set for one frame after a press:
      jump: false,
      swing: false,
      use: false,
      pause: false,
      mute: false,
      eat: false,      // eat a piece of meat
      cycle: false,    // next weapon
      slot: 0,         // 1..9 when a number key is pressed
      tap: null,       // { x, y, alt, mouse } for a click or tap on the scene
      touch: false,    // true once the player has touched the screen
    };
    let stickX = 0, stickY = 0, touchRun = false, touchSwing = false, touchJump = false;

    function onKey(e, down) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const digit = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0;
      if (!GAME_KEYS.has(e.code) && e.code !== 'Escape' && !digit) return;
      // Let Enter and Space press a focused button as usual.
      if (tag === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space')) return;
      if (e.code !== 'Escape') e.preventDefault(); // stop Space and the arrows scrolling the page
      if (down && !e.repeat) {
        if (digit) input.slot = digit;
        if (e.code === 'Space') input.jump = true;
        if (e.code === 'KeyF' || e.code === 'KeyJ') input.swing = true;
        if (e.code === 'KeyE' || e.code === 'Enter') input.use = true;
        if (e.code === 'KeyP' || e.code === 'Escape') input.pause = true;
        if (e.code === 'KeyM') input.mute = true;
        if (e.code === 'KeyR') input.eat = true;
        if (e.code === 'KeyQ') input.cycle = true;
      }
      keys[e.code] = down;
    }
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => {
      for (const k of Object.keys(keys)) keys[k] = false;
    });

    // Drag on the scene to look around. A press that does not move is a tap.
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') input.touch = true;
      if (drag) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, at: performance.now(), mouse: e.pointerType === 'mouse', alt: e.button === 2 };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      input.lookX += dx;
      input.lookY += dy;
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.type === 'pointerup' && drag.moved < 7 && performance.now() - drag.at < 400) {
        input.tap = { x: e.clientX, y: e.clientY, alt: drag.alt, mouse: drag.mouse };
      }
      drag = null;
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      input.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    // Touch: a thumb stick on the left and buttons on the right.
    const pad = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    if (pad && knob) {
      let stick = null;
      const reach = 44;
      const place = (e) => {
        let dx = e.clientX - stick.x, dy = e.clientY - stick.y;
        const len = Math.hypot(dx, dy);
        touchRun = len > reach * 1.5; // drag well past the edge to run
        if (len > reach) {
          dx = (dx / len) * reach;
          dy = (dy / len) * reach;
        }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        stickX = dx / reach;
        stickY = -dy / reach;
      };
      pad.addEventListener('pointerdown', (e) => {
        input.touch = true;
        const box = pad.getBoundingClientRect();
        stick = { id: e.pointerId, x: box.left + box.width / 2, y: box.top + box.height / 2 };
        try { pad.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        place(e);
        e.preventDefault();
      });
      pad.addEventListener('pointermove', (e) => {
        if (stick && e.pointerId === stick.id) place(e);
      });
      const release = (e) => {
        if (!stick || e.pointerId !== stick.id) return;
        stick = null;
        stickX = stickY = 0;
        touchRun = false;
        knob.style.transform = '';
      };
      pad.addEventListener('pointerup', release);
      pad.addEventListener('pointercancel', release);
    }
    const press = (id, field, held) => {
      const el = document.getElementById(id);
      if (!el) return;
      const hold = (down) => {
        if (held === 'swing') touchSwing = down;
        if (held === 'jump') touchJump = down;
      };
      el.addEventListener('pointerdown', (e) => {
        input.touch = true;
        input[field] = true;
        hold(true);
        e.preventDefault();
      });
      if (held) {
        const up = () => hold(false);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
      }
    };
    press('btn-jump', 'jump', 'jump');
    press('btn-swing', 'swing', 'swing');
    press('btn-use', 'use');

    // Call once per frame, before reading.
    input.poll = function () {
      const k = (code) => (keys[code] ? 1 : 0);
      let x = k('KeyD') - k('KeyA') + stickX;
      let y = Math.max(k('KeyW'), k('ArrowUp')) - Math.max(k('KeyS'), k('ArrowDown')) + stickY;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      input.moveX = x;
      input.moveY = y;
      input.turn = k('ArrowRight') - k('ArrowLeft');
      input.run = !!(keys.ShiftLeft || keys.ShiftRight || touchRun);
      input.swingHeld = !!(keys.KeyF || keys.KeyJ || touchSwing);
      input.jumpHeld = !!(keys.Space || touchJump);
      input.dive = !!(keys.ShiftLeft || keys.ShiftRight || touchSwing);
      input.swingTouch = touchSwing;
    };

    // Call once per frame, after reading.
    input.clear = function () {
      input.jump = input.swing = input.use = input.pause = input.mute = false;
      input.eat = input.cycle = false;
      input.slot = 0;
      input.tap = null;
      input.lookX = input.lookY = input.zoom = 0;
    };

    return input;
  }

  WS.Input = { create };
})();
