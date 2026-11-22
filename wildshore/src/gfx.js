// Small drawing helpers shared by the world and the characters.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});

  function lambert(color, extra) {
    return new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, extra || {}));
  }

  function basic(color, extra) {
    return new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));
  }

  function add(parent, geometry, material, x, y, z, castShadow) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = castShadow !== false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // Joins geometries into one flat-shaded geometry.
  function merge(parts) {
    const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    let total = 0;
    for (const g of list) total += g.attributes.position.array.length;
    const positions = new Float32Array(total);
    let offset = 0;
    for (const g of list) {
      positions.set(g.attributes.position.array, offset);
      offset += g.attributes.position.array.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    out.computeVertexNormals();
    return out;
  }

  function glyphTexture(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.translate(64, 64);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.lineCap = 'round';
    if (kind === 'sun') {
      g.beginPath();
      g.arc(0, 0, 22, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.beginPath();
        g.moveTo(Math.cos(a) * 34, Math.sin(a) * 34);
        g.lineTo(Math.cos(a) * 50, Math.sin(a) * 50);
        g.stroke();
      }
    } else if (kind === 'moon') {
      g.beginPath();
      g.arc(0, 0, 42, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(20, -10, 36, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 'star') {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 50 : 21;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    } else {
      g.font = 'bold 110px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind, 0, 8);
    }
    return new THREE.CanvasTexture(c);
  }

  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ---------- block textures ----------
  // Each block face is a tiny 32 x 32 painting, drawn here so the game needs
  // no image files. `paintBlock` returns the canvas.

  function paintBlock(id) {
    const tall = id === 'door';
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = tall ? 64 : 32;
    const g = c.getContext('2d');
    let seed = id.length * 7919 + id.charCodeAt(0) * 31;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const speckle = (colors, amount) => {
      for (let n = 0; n < amount; n++) {
        g.fillStyle = colors[Math.floor(rnd() * colors.length)];
        g.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * c.height), 1 + Math.floor(rnd() * 2), 1);
      }
    };
    if (id === 'planks') {
      g.fillStyle = '#c99a5b';
      g.fillRect(0, 0, 32, 32);
      speckle(['#d6a868', '#b98a4d', '#c08f52'], 140);
      g.fillStyle = '#946a38';
      for (let y = 7; y < 32; y += 8) g.fillRect(0, y, 32, 1);
      [[10, 0], [26, 8], [5, 16], [20, 24]].forEach(([x, y]) => g.fillRect(x, y, 1, 7));
    } else if (id === 'log') {
      g.fillStyle = '#7b5637';
      g.fillRect(0, 0, 32, 32);
      for (let x = 0; x < 32; x += 1) {
        g.fillStyle = ['#6a482d', '#86603f', '#7b5637', '#5d3f27'][Math.floor(rnd() * 4)];
        g.fillRect(x, 0, 1, 32);
      }
      speckle(['#4f351f', '#94704c'], 60);
    } else if (id === 'stone') {
      g.fillStyle = '#9b9b9d';
      g.fillRect(0, 0, 32, 32);
      for (let n = 0; n < 26; n++) {
        g.fillStyle = ['#8a8a8d', '#a9a9ab', '#929296'][n % 3];
        g.fillRect(Math.floor(rnd() * 30), Math.floor(rnd() * 30), 2 + Math.floor(rnd() * 5), 2 + Math.floor(rnd() * 3));
      }
      speckle(['#77777b', '#b6b6b8'], 50);
    } else if (id === 'brick') {
      g.fillStyle = '#d9cfbf';
      g.fillRect(0, 0, 32, 32);
      for (let row = 0; row < 4; row++) {
        for (let n = -1; n < 2; n++) {
          g.fillStyle = ['#b5553d', '#a94b35', '#c05f45'][Math.floor(rnd() * 3)];
          g.fillRect(n * 16 + (row % 2) * 8 + 1, row * 8 + 1, 15, 7);
        }
      }
      speckle(['#9c4530', '#c96a50'], 50);
    } else if (id === 'glass') {
      g.fillStyle = 'rgba(190, 232, 245, 0.28)';
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = 'rgba(255, 255, 255, 0.55)';
      for (let n = 0; n < 9; n++) {
        g.fillRect(6 + n, 14 - n, 1, 1);
        g.fillRect(16 + n, 24 - n, 1, 1);
      }
      g.fillStyle = '#eef8fb';
      g.fillRect(0, 0, 32, 2);
      g.fillRect(0, 30, 32, 2);
      g.fillRect(0, 0, 2, 32);
      g.fillRect(30, 0, 2, 32);
    } else if (id === 'roof') {
      g.fillStyle = '#b24a3b';
      g.fillRect(0, 0, 32, 32);
      speckle(['#bf5646', '#a23f31'], 90);
      g.fillStyle = '#7f2f25';
      for (let row = 0; row < 4; row++) {
        g.fillRect(0, row * 8 + 7, 32, 1);
        for (let x = (row % 2) * 4; x < 32; x += 8) g.fillRect(x, row * 8, 1, 7);
      }
    } else {
      g.fillStyle = '#9c6b3f';
      g.fillRect(0, 0, 32, 64);
      for (let x = 0; x < 32; x += 8) {
        g.fillStyle = ['#a87646', '#93633a'][(x / 8) % 2];
        g.fillRect(x, 0, 8, 64);
      }
      g.fillStyle = '#6b4526';
      g.fillRect(0, 0, 32, 3);
      g.fillRect(0, 61, 32, 3);
      g.fillRect(0, 0, 3, 64);
      g.fillRect(29, 0, 3, 64);
      g.fillRect(3, 30, 26, 2);
      g.fillStyle = '#e8c04a';
      g.fillRect(23, 34, 3, 4);
    }
    return c;
  }

  function blockTexture(id) {
    const texture = new THREE.CanvasTexture(paintBlock(id));
    texture.magFilter = THREE.NearestFilter; // keep the pixels crisp
    return texture;
  }

  WS.Gfx = { lambert, basic, add, merge, glyphTexture, glowTexture, paintBlock, blockTexture };
})();
