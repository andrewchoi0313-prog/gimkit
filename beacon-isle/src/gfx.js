// Small drawing helpers shared by the world and the characters.
(function () {
  'use strict';

  const BI = (window.BI = window.BI || {});

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

  BI.Gfx = { lambert, basic, add, merge, glyphTexture, glowTexture };
})();
