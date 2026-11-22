// Drawing the placed blocks, the glowing outline that shows where the next
// one will go, and working out which cell the player is pointing at.
(function () {
  'use strict';

  const RS = (window.RS = window.RS || {});
  const Blocks = RS.Blocks;
  const { lambert, basic, blockTexture } = RS.Gfx;
  const T = Blocks.TYPES;

  const REACH = 10;      // how far from the player a block can be placed
  let materials = null;
  const cube = new THREE.BoxGeometry(1, 1, 1);

  function blockMaterials() {
    if (materials) return materials;
    materials = {};
    for (const item of Blocks.PALETTE) {
      const glass = item.id === 'glass';
      materials[item.type] = new THREE.MeshLambertMaterial({ map: blockTexture(item.id), transparent: glass, depthWrite: !glass });
    }
    return materials;
  }

  // Draws every block in `store` inside `group`. Cubes of one kind share one
  // instanced mesh, so thousands of blocks stay cheap. Doors are drawn singly.
  function createView(group, store) {
    const mats = blockMaterials();
    const layers = new Map(); // type -> { mesh, capacity, count, slots: Map(key -> slot), keys: [] }
    const doors = new Map();  // key -> { pivot, target }
    const matrix = new THREE.Matrix4();

    function layerFor(type) {
      let layer = layers.get(type);
      if (!layer) {
        layer = { mesh: null, capacity: 0, count: 0, slots: new Map(), keys: [] };
        layers.set(type, layer);
      }
      if (layer.count >= layer.capacity) {
        // Out of room: make a bigger mesh and copy the old blocks across.
        const capacity = Math.max(256, layer.capacity * 2);
        const mesh = new THREE.InstancedMesh(cube, mats[type], capacity);
        mesh.frustumCulled = false;
        mesh.castShadow = type !== T.glass;
        mesh.receiveShadow = true;
        if (layer.mesh) {
          mesh.instanceMatrix.array.set(layer.mesh.instanceMatrix.array);
          group.remove(layer.mesh);
          layer.mesh.dispose();
        }
        mesh.count = layer.count;
        group.add(mesh);
        layer.mesh = mesh;
        layer.capacity = capacity;
      }
      return layer;
    }

    function addDoor(i, j, k) {
      const n = Blocks.key(i, j, k);
      const turned = store.turn.get(n) === 1;
      const pivot = new THREE.Group();
      // The hinge is on one edge of the doorway; the panel hangs from it.
      pivot.position.set(turned ? i + 0.5 : i + 0.04, k, turned ? j + 0.04 : j + 0.5);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.96, 0.14), mats[T.door]);
      panel.position.set(0.46, 0.98, 0);
      panel.castShadow = panel.receiveShadow = true;
      const swing = new THREE.Group();
      swing.rotation.y = turned ? -Math.PI / 2 : 0;
      swing.add(panel);
      pivot.add(swing);
      group.add(pivot);
      doors.set(n, { pivot, swing, shut: swing.rotation.y, target: swing.rotation.y });
    }

    function add(i, j, k, type) {
      if (type === T.doorTop) return;
      if (type === T.door) return addDoor(i, j, k);
      const layer = layerFor(type);
      const n = Blocks.key(i, j, k);
      matrix.makeTranslation(i + 0.5, k + 0.5, j + 0.5);
      layer.mesh.setMatrixAt(layer.count, matrix);
      layer.slots.set(n, layer.count);
      layer.keys[layer.count] = n;
      layer.count += 1;
      layer.mesh.count = layer.count;
      layer.mesh.instanceMatrix.needsUpdate = true;
    }

    function remove(i, j, k, type) {
      const n = Blocks.key(i, j, k);
      if (type === T.door) {
        const door = doors.get(n);
        if (door) group.remove(door.pivot);
        doors.delete(n);
        return;
      }
      const layer = layers.get(type);
      if (!layer || !layer.slots.has(n)) return;
      // Fill the gap with the last block in the mesh.
      const slot = layer.slots.get(n), last = layer.count - 1;
      if (slot !== last) {
        layer.mesh.getMatrixAt(last, matrix);
        layer.mesh.setMatrixAt(slot, matrix);
        layer.keys[slot] = layer.keys[last];
        layer.slots.set(layer.keys[slot], slot);
      }
      layer.slots.delete(n);
      layer.count -= 1;
      layer.mesh.count = layer.count;
      layer.mesh.instanceMatrix.needsUpdate = true;
    }

    function setDoor(i, j, k, open) {
      const door = doors.get(Blocks.key(i, j, k));
      if (door) door.target = door.shut + (open ? -Math.PI / 2 : 0);
    }

    function tick(dt) {
      for (const door of doors.values()) {
        const diff = door.target - door.swing.rotation.y;
        if (Math.abs(diff) > 0.001) door.swing.rotation.y += diff * Math.min(1, dt * 10);
      }
    }

    // Takes every mesh back out of the scene (when a world is wiped).
    function dispose() {
      for (const layer of layers.values()) {
        if (!layer.mesh) continue;
        group.remove(layer.mesh);
        layer.mesh.dispose();
      }
      for (const door of doors.values()) group.remove(door.pivot);
      layers.clear();
      doors.clear();
    }

    for (const [n, type] of store.cells) add(...Blocks.unkey(n), type);
    return { add, remove, setDoor, tick, dispose };
  }

  // The outline that shows where a block will go (or which one will be removed).
  function createGhost(scene) {
    const group = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), basic(0xffc857, { transparent: true, opacity: 0.28, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03)), new THREE.LineBasicMaterial({ color: 0xffe08a }));
    group.add(fill);
    group.add(edges);
    group.visible = false;
    scene.add(group);
    return {
      hide() { group.visible = false; },
      // tall: two cells high, for a door. good: amber, otherwise red.
      show(cell, tall, good) {
        group.visible = true;
        group.position.set(cell[0] + 0.5, cell[2] + (tall ? 1 : 0.5), cell[1] + 0.5);
        group.scale.set(1, tall ? 2 : 1, 1);
        fill.material.color.setHex(good ? 0xffc857 : 0xff5a4a);
        edges.material.color.setHex(good ? 0xffe08a : 0xff8a7a);
      },
    };
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Works out what a click at screen point (px, py) would do.
  // opts: { camera, canvas, store, surfaceAt, player, eraser, type, noBuild }
  // Returns null when nothing is pointed at, or
  // { cell, tall, ok, why, remove } where `why` explains a refusal.
  function aim(px, py, opts) {
    const box = opts.canvas.getBoundingClientRect();
    pointer.set(((px - box.left) / box.width) * 2 - 1, -((py - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, opts.camera);
    const hit = Blocks.castRay(opts.store, raycaster.ray.origin, raycaster.ray.direction, 70, opts.surfaceAt);
    if (!hit) return null;
    const p = opts.player;
    const near = (cell) => Math.hypot(cell[0] + 0.5 - p.x, cell[1] + 0.5 - p.z) <= REACH && Math.abs(cell[2] + 0.5 - (p.y + 1)) <= REACH;

    if (opts.eraser) {
      if (hit.kind !== 'block') return null;
      let cell = hit.cell;
      if (Blocks.get(opts.store, ...cell) === T.doorTop) cell = [cell[0], cell[1], cell[2] - 1];
      const tall = Blocks.get(opts.store, ...cell) === T.door;
      return { cell, tall, remove: true, ok: near(cell), why: 'That block is too far away.' };
    }

    let cell;
    if (hit.kind === 'block') {
      cell = hit.before;
    } else {
      const [i, j] = hit.column;
      cell = [i, j, Blocks.groundCell(opts.store, i, j, opts.surfaceAt(i + 0.5, j + 0.5))];
    }
    const tall = opts.type === T.door;
    const result = { cell, tall, remove: false, ok: false, why: '' };
    const status = Blocks.canPlace(opts.store, cell[0], cell[1], cell[2], opts.type, opts.surfaceAt(cell[0] + 0.5, cell[1] + 0.5));
    if (status === 'taken') result.why = tall ? 'A door needs two clear spaces, one above the other.' : 'Something is already there.';
    else if (status !== 'ok') result.why = 'A block has to rest on the ground or touch another block.';
    else if (!near(cell)) result.why = 'That is too far away. Walk closer.';
    else {
      // Not on top of the builder...
      const cx = Math.max(cell[0], Math.min(p.x, cell[0] + 1)), cz = Math.max(cell[1], Math.min(p.z, cell[1] + 1));
      const top = cell[2] + (tall ? 2 : 1);
      if (Math.hypot(p.x - cx, p.z - cz) < 0.42 && p.y < top && p.y + 1.8 > cell[2]) result.why = 'You are standing there.';
      // ...and not where the game needs the way kept clear.
      for (const zone of opts.noBuild) {
        if (Math.hypot(cell[0] + 0.5 - zone.x, cell[1] + 0.5 - zone.z) < zone.r) result.why = zone.why;
      }
      result.ok = !result.why;
    }
    return result;
  }

  RS.Builder = { REACH, createView, createGhost, aim };
})();
