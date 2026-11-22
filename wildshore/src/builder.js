// Draws the blocks the house is made of, and swings its door.
(function () {
  'use strict';

  const WS = (window.WS = window.WS || {});
  const Blocks = WS.Blocks;
  const { blockTexture } = WS.Gfx;
  const T = Blocks.TYPES;

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

  WS.Builder = { createView };
})();
