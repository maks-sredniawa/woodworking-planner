import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/addons/OrbitControls.js';
import { SPECIES, blank, cornersActive, extents, outline, projectBounds, sceneBasis } from './model.js';

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const CLICK_SLOP_PX = 5;
const GRAIN_MM = { along: 900, across: 220 };
const CURVED_EDGE_DEG = 10;
const DOWEL_SEGMENTS = 48;
const VIEWS = {
  iso: new THREE.Vector3(0.62, 0.45, 0.85),
  front: new THREE.Vector3(0, 0.02, 1),
  side: new THREE.Vector3(1, 0.02, 0),
  top: new THREE.Vector3(0, 1, 0.002),
};
const THEMES = {
  light: { background: 0xe6e9ec, gridMajor: 0xbcc3ca, gridMinor: 0xd3d8dd, select: 0x0f766e },
  dark: { background: 0x16191c, gridMajor: 0x363d44, gridMinor: 0x262b30, select: 0x2dd4bf },
};
const STEEL = 0xc4cbd2;
const COUNTERSINK = 0x2b2f33;
const HEAD_MM = 1.5;
const NO_PLACEMENT = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

function placementMatrix({ m, o }) {
  return new THREE.Matrix4().set(m[0], m[1], m[2], o[0], m[3], m[4], m[5], o[1], m[6], m[7], m[8], o[2], 0, 0, 0, 1);
}

export function createScene(container, { onSelect, onDrag, dragKind }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const fullPixelRatio = () => Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(fullPixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 10, 100000);
  camera.position.set(1800, 1400, 2200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  let grid = null;

  const boards = new THREE.Group();
  scene.add(boards);
  const hardware = new THREE.Group();
  scene.add(hardware);
  let hingeLine = null;
  const xray = new THREE.Group();
  xray.renderOrder = 2;
  scene.add(xray);
  let placementOf = () => NO_PLACEMENT;
  const grain = new Map();
  let selectedId = null;
  let fitted = false;
  let lastBox = null;
  let theme = THEMES.light;
  let dirty = true;
  let potato = false;
  let lastParts = [];
  let lastExtras = {};
  const invalidate = () => {
    dirty = true;
  };
  controls.addEventListener('change', invalidate);

  function grainTexture(species) {
    if (grain.has(species)) return grain.get(species);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = SPECIES[species].color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = [...species].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const y = random() * canvas.height;
      const wave = 1 + random() * 3;
      ctx.strokeStyle = `rgba(60, 35, 15, ${0.04 + random() * 0.12})`;
      ctx.lineWidth = 0.5 + random() * 1.8;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const dy = Math.sin((x / canvas.width) * Math.PI * 2 * wave + i) * 2.5;
        if (x === 0) ctx.moveTo(x, y + dy);
        else ctx.lineTo(x, y + dy);
      }
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    grain.set(species, texture);
    return texture;
  }

  function woodMaterial(part, repeat) {
    const map = grainTexture(part.species).clone();
    map.needsUpdate = true;
    map.repeat.set(...repeat);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0 });
  }

  function dowelGeometry(part) {
    const geometry = new THREE.CylinderGeometry(part.dowelDiameter / 2, part.dowelDiameter / 2, part.length, DOWEL_SEGMENTS);
    const { position, normal, uv } = geometry.attributes;
    const around = Math.PI * part.dowelDiameter;
    for (let i = 0; i < uv.count; i++) {
      const onSide = Math.abs(normal.getY(i)) < 0.5;
      if (onSide) uv.setXY(i, position.getY(i), uv.getX(i) * around);
      else uv.setXY(i, position.getX(i), position.getZ(i));
    }
    return geometry.rotateZ(Math.PI / 2);
  }

  function outlineGeometry(part) {
    const { points, holes } = outline(part);
    const toVectors = (list) => list.map(([u, v]) => new THREE.Vector2(u, v));
    const shape = new THREE.Shape(toVectors(points));
    shape.holes = holes.map((hole) => new THREE.Path(toVectors(hole)));
    const { thickness } = blank(part);
    return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 })
      .translate(0, 0, -thickness / 2)
      .rotateX(-Math.PI / 2);
  }

  function pieceGeometry(part) {
    if (part.shape === 'board' && !cornersActive(part)) {
      return {
        geometry: new THREE.BoxGeometry(part.length, part.thickness, part.width),
        repeat: [part.length / GRAIN_MM.along, Math.max(part.width, part.thickness) / GRAIN_MM.across],
        edgeAngle: 1,
      };
    }
    return {
      geometry: part.shape === 'dowel' ? dowelGeometry(part) : outlineGeometry(part),
      repeat: [1 / GRAIN_MM.along, 1 / GRAIN_MM.across],
      edgeAngle: CURVED_EDGE_DEG,
    };
  }

  function boardMesh(part) {
    const { geometry, repeat, edgeAngle } = pieceGeometry(part);
    const material = potato ? new THREE.MeshLambertMaterial({ color: SPECIES[part.species].color }) : woodMaterial(part, repeat);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !potato;
    mesh.receiveShadow = !potato;
    mesh.userData.partId = part.id;

    const basis = sceneBasis(part.pose).map((column) => new THREE.Vector3(...column));
    mesh.userData.pose = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...basis));

    placeMesh(mesh, part);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, edgeAngle),
      new THREE.LineBasicMaterial({ color: 0x3b2a1a, transparent: true, opacity: 0.55 }),
    );
    edges.raycast = () => {};
    mesh.add(edges);
    return mesh;
  }

  function placeMesh(mesh, part) {
    const size = extents(part);
    const placement = placementOf(part.id);
    const turn = new THREE.Quaternion().setFromRotationMatrix(placementMatrix({ ...placement, o: [0, 0, 0] }));
    mesh.position.set(part.x + size.x / 2, part.y + size.y / 2, part.z + size.z / 2).applyMatrix4(placementMatrix(placement));
    mesh.quaternion.copy(turn).multiply(mesh.userData.pose);
  }

  function steel(color = STEEL) {
    return potato ? new THREE.MeshLambertMaterial({ color }) : new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5 });
  }

  function disc(radius, thickness, centre, normal, color) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, potato ? 8 : 16), steel(color));
    const along = new THREE.Vector3(...normal);
    mesh.quaternion.setFromUnitVectors(AXIS.y, along);
    mesh.position.set(...centre).addScaledVector(along, thickness / 2);
    return mesh;
  }

  function boxFrom(piece) {
    const size = piece.max.map((value, i) => value - piece.min[i]);
    return new THREE.BoxGeometry(...size).translate(...piece.min.map((value, i) => value + size[i] / 2));
  }

  function hiddenWood(piece) {
    const color = SPECIES[piece.species].color;
    const offset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
    const material = potato
      ? new THREE.MeshLambertMaterial({ color, ...offset })
      : new THREE.MeshStandardMaterial({ map: grainTexture(piece.species), roughness: 0.75, metalness: 0, ...offset });
    const geometry = boxFrom(piece);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: COUNTERSINK })));
    return mesh;
  }

  function hardwareMesh(piece) {
    if (piece.type === 'wood') return hiddenWood(piece);
    if (piece.type === 'head') {
      const group = new THREE.Group();
      if (piece.kind === 'screws' && !potato) group.add(disc(piece.radius * 1.4, 0.4, piece.centre, piece.normal, COUNTERSINK));
      group.add(disc(piece.radius, piece.kind === 'cup' ? 1 : HEAD_MM, piece.centre, piece.normal));
      return group;
    }
    if (piece.type === 'knuckle') {
      const from = new THREE.Vector3(...piece.from);
      const to = new THREE.Vector3(...piece.to);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(piece.radius, piece.radius, from.distanceTo(to), potato ? 6 : 8), steel());
      mesh.quaternion.setFromUnitVectors(AXIS.y, to.clone().sub(from).normalize());
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      return mesh;
    }
    const size = piece.max.map((value, i) => value - piece.min[i]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), steel());
    mesh.position.set(...piece.min.map((value, i) => value + size[i] / 2));
    return mesh;
  }

  function disposeTree(root) {
    root.traverse((node) => {
      node.geometry?.dispose();
      node.material?.dispose();
    });
  }

  function buildHardware(pieces) {
    for (const child of [...hardware.children]) disposeTree(child);
    hardware.clear();
    const owners = new Map();
    for (const piece of pieces) {
      let owner = owners.get(piece.owner);
      if (!owner) {
        owner = new THREE.Group();
        owner.matrixAutoUpdate = false;
        owner.matrix.copy(placementMatrix(placementOf(piece.owner)));
        owner.matrixWorldNeedsUpdate = true;
        owner.userData.ownerId = piece.owner;
        owners.set(piece.owner, owner);
        hardware.add(owner);
      }
      const mesh = hardwareMesh(piece);
      mesh.traverse((node) => {
        node.raycast = () => {};
      });
      owner.add(mesh);
    }
  }

  function showHingeLine(line) {
    if (hingeLine) {
      scene.remove(hingeLine);
      disposeTree(hingeLine);
      hingeLine = null;
    }
    if (!line) return;
    const origin = new THREE.Vector3(...line.origin);
    const end = origin.clone().addScaledVector(new THREE.Vector3(...line.direction), line.length);
    hingeLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([origin, end]),
      new THREE.LineBasicMaterial({ color: theme.select, depthTest: false }),
    );
    hingeLine.renderOrder = 2;
    hingeLine.raycast = () => {};
    scene.add(hingeLine);
  }

  function dowelOutline(piece) {
    const from = new THREE.Vector3(...piece.from);
    const to = new THREE.Vector3(...piece.to);
    const along = to.clone().sub(from).normalize();
    const side = new THREE.Vector3().crossVectors(along, Math.abs(along.y) < 0.9 ? AXIS.y : AXIS.x).normalize().multiplyScalar(piece.radius);
    const up = new THREE.Vector3().crossVectors(along, side);
    const ring = (centre, step) => {
      const angle = (step / 12) * Math.PI * 2;
      return centre.clone().addScaledVector(side, Math.cos(angle)).addScaledVector(up, Math.sin(angle));
    };
    const points = [];
    for (const centre of [from, to]) for (let step = 0; step < 12; step++) points.push(ring(centre, step), ring(centre, step + 1));
    for (let step = 0; step < 12; step += 3) points.push(ring(from, step), ring(to, step));
    return new THREE.BufferGeometry().setFromPoints(points);
  }

  function boxEdges(piece) {
    const box = boxFrom(piece);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }

  function showXray(pieces) {
    for (const child of [...xray.children]) disposeTree(child);
    xray.clear();
    for (const piece of pieces) {
      const geometry = piece.type === 'dowel' ? dowelOutline(piece) : boxEdges(piece);
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: theme.select, depthTest: false }));
      lines.renderOrder = 2;
      lines.raycast = () => {};
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(placementMatrix(placementOf(piece.owner)));
      xray.add(lines);
    }
  }

  function place(parts, extras = {}) {
    lastParts = parts;
    lastExtras = extras;
    placementOf = (id) => extras.placements?.get(id) ?? NO_PLACEMENT;
    const byId = new Map(parts.map((part) => [part.id, part]));
    for (const mesh of boards.children) {
      const part = byId.get(mesh.userData.partId);
      if (part) placeMesh(mesh, part);
    }
    buildHardware(extras.hardware ?? []);
    showHingeLine(extras.hingeLine ?? null);
    showXray(extras.xray ?? []);
    invalidate();
  }

  function disposeBoards() {
    for (const mesh of boards.children) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
      for (const child of mesh.children) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
    boards.clear();
  }

  function paintSelection() {
    invalidate();
    for (const mesh of boards.children) {
      const selected = mesh.userData.partId === selectedId;
      const edges = mesh.children[0];
      mesh.material.emissive.set(selected ? theme.select : 0x000000);
      mesh.material.emissiveIntensity = selected ? 0.3 : 0;
      edges.material.color.set(selected ? theme.select : 0x3b2a1a);
      edges.material.opacity = selected ? 1 : 0.55;
    }
  }

  function frame(box, direction = camera.position.clone().sub(controls.target).normalize()) {
    const center = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2,
    );
    const radius = Math.max(300, new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z).length() / 2);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction.clone().normalize(), distance);
    controls.update();
  }

  function placeGroundAndLight(box) {
    const span = Math.max(2000, (box.max.x - box.min.x) * 3, (box.max.z - box.min.z) * 3);
    const gridSize = Math.ceil(span / 1000) * 1000;
    if (!grid || grid.userData.size !== gridSize) {
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        grid.material.dispose();
      }
      grid = new THREE.GridHelper(gridSize, gridSize / 100, theme.gridMajor, theme.gridMinor);
      grid.userData.size = gridSize;
      scene.add(grid);
    }
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    grid.position.set(cx, Math.min(0, box.min.y) - 0.5, cz);
    floor.position.copy(grid.position).setY(grid.position.y + 0.2);
    floor.scale.set(gridSize, gridSize, 1);
    const reach = span / 2;
    sun.position.set(cx + reach * 0.6, reach * 1.4 + box.max.y, cz + reach);
    sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: reach * 6 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  function setParts(parts, extras = {}) {
    lastParts = parts;
    lastExtras = extras;
    placementOf = (id) => extras.placements?.get(id) ?? NO_PLACEMENT;
    disposeBoards();
    for (const part of parts) boards.add(boardMesh(part));
    buildHardware(extras.hardware ?? []);
    showHingeLine(extras.hingeLine ?? null);
    showXray(extras.xray ?? []);
    paintSelection();
    const box = projectBounds(parts) ?? { min: { x: -500, y: 0, z: -500 }, max: { x: 500, y: 500, z: 500 } };
    placeGroundAndLight(box);
    if (!fitted) {
      frame(box, VIEWS.iso);
      fitted = true;
    }
    lastBox = box;
  }

  function setSelected(id) {
    selectedId = id;
    paintSelection();
  }

  function setPotato(on) {
    potato = on;
    renderer.setPixelRatio(on ? 1 : fullPixelRatio());
    renderer.shadowMap.enabled = !on;
    sun.castShadow = !on;
    floor.visible = !on;
    resize();
    setParts(lastParts, lastExtras);
  }

  function setTheme(dark) {
    theme = dark ? THEMES.dark : THEMES.light;
    scene.background = new THREE.Color(theme.background);
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
      grid = null;
    }
    if (lastBox) placeGroundAndLight(lastBox);
    if (hingeLine) hingeLine.material.color.set(theme.select);
    for (const lines of xray.children) lines.material.color.set(theme.select);
    paintSelection();
  }

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const canvas = renderer.domElement;
  let down = null;
  let drag = null;
  let liftMode = false;

  function boardUnder(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(boards.children, false)[0] ?? null;
  }

  function dragPlane(point, vertical) {
    if (!vertical) return new THREE.Plane().setFromNormalAndCoplanarPoint(AXIS.y, point);
    const facing = camera.position.clone().sub(controls.target).setY(0);
    const normal = facing.lengthSq() < 1e-6 ? AXIS.z.clone() : facing.normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  }

  function swingAngle() {
    boardUnder(drag.pointer);
    const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (point) drag.last = point.clone();
    const now = drag.last.clone().sub(drag.origin).projectOnPlane(drag.axis);
    const start = drag.start.clone().sub(drag.origin).projectOnPlane(drag.axis);
    const signed = Math.atan2(start.clone().cross(now).dot(drag.axis), start.dot(now));
    return THREE.MathUtils.radToDeg(signed);
  }

  function updateDrag() {
    if (drag.swing) {
      onDrag({ phase: 'move', id: drag.id, swing: swingAngle(), invertSnap: drag.alt });
      return;
    }
    const vertical = drag.shift !== liftMode;
    if (vertical !== drag.vertical) {
      drag.start = drag.last.clone();
      drag.plane = dragPlane(drag.last, vertical);
      drag.vertical = vertical;
      onDrag({ phase: 'rebase', id: drag.id });
    }
    boardUnder(drag.pointer);
    const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (point) drag.last = point.clone();
    const delta = (point ?? drag.last.clone()).sub(drag.start);
    onDrag({
      phase: 'move',
      id: drag.id,
      delta: drag.vertical ? { y: delta.y } : { x: delta.x, z: delta.z },
      vertical: drag.vertical,
      invertSnap: drag.alt,
    });
  }

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      down = { x: event.clientX, y: event.clientY };
      if (event.button !== 0 || !selectedId) return;
      const hit = boardUnder(event);
      if (hit?.object.userData.partId !== selectedId) return;
      const kind = dragKind(selectedId);
      if (kind.mode === 'none') return;
      const vertical = event.shiftKey !== liftMode;
      drag = {
        id: selectedId,
        start: hit.point.clone(),
        last: hit.point.clone(),
        plane: dragPlane(hit.point, vertical),
        vertical,
        pointer: { clientX: event.clientX, clientY: event.clientY },
        shift: event.shiftKey,
        alt: event.altKey,
      };
      if (kind.mode === 'swing') {
        const axis = new THREE.Vector3(...kind.axis.direction).normalize();
        const origin = new THREE.Vector3(...kind.axis.origin);
        Object.assign(drag, { swing: true, axis, origin, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axis, hit.point) });
      }
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      onDrag({ phase: 'start', id: drag.id, vertical, invertSnap: event.altKey });
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) {
      if (event.buttons === 0 && selectedId) {
        const hovered = boardUnder(event)?.object.userData;
        canvas.style.cursor = hovered?.partId === selectedId && dragKind(selectedId).mode !== 'none' ? 'grab' : '';
      }
      return;
    }
    Object.assign(drag, { pointer: { clientX: event.clientX, clientY: event.clientY }, shift: event.shiftKey, alt: event.altKey });
    updateDrag();
  });

  function modifierChanged(event) {
    if (!drag || (event.key !== 'Shift' && event.key !== 'Alt')) return;
    event.preventDefault();
    if (drag.shift === event.shiftKey && drag.alt === event.altKey) return;
    Object.assign(drag, { shift: event.shiftKey, alt: event.altKey });
    updateDrag();
  }
  window.addEventListener('keydown', modifierChanged);
  window.addEventListener('keyup', modifierChanged);

  function endDrag() {
    if (!drag) return;
    const { id } = drag;
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = 'grab';
    onDrag({ phase: 'end', id });
  }
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerup', (event) => {
    endDrag();
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) return;
    const hit = boardUnder(event);
    onSelect(hit ? hit.object.userData.partId : null);
  });

  function resize() {
    const { clientWidth, clientHeight } = container;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const gl = renderer.getContext();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pendingQueries = [];
  const measured = { frames: 0, cpuMs: 0, gpuMs: 0, gpuFrames: 0, since: performance.now() };
  let measuring = false;

  function collectGpuTimes() {
    while (pendingQueries.length) {
      const query = pendingQueries[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      pendingQueries.shift();
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        measured.gpuMs += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        measured.gpuFrames += 1;
      }
      gl.deleteQuery(query);
    }
  }

  function draw() {
    if (!measuring) {
      renderer.render(scene, camera);
      return;
    }
    const query = timer && pendingQueries.length < 8 ? gl.createQuery() : null;
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const started = performance.now();
    renderer.render(scene, camera);
    measured.cpuMs += performance.now() - started;
    measured.frames += 1;
    if (query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pendingQueries.push(query);
    }
  }

  function gpuName() {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }

  function readStats() {
    if (timer) collectGpuTimes();
    const now = performance.now();
    const result = {
      seconds: (now - measured.since) / 1000,
      frames: measured.frames,
      cpuMs: measured.cpuMs,
      gpuMs: timer ? measured.gpuMs : null,
      gpuFrames: measured.gpuFrames,
      gpu: gpuName(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
    Object.assign(measured, { frames: 0, cpuMs: 0, gpuMs: 0, gpuFrames: 0, since: now });
    return result;
  }

  renderer.setAnimationLoop(() => {
    controls.update();
    if (measuring && timer) collectGpuTimes();
    if (!dirty) return;
    dirty = false;
    draw();
  });

  return {
    canvas,
    setParts,
    place,
    setSelected,
    setLiftMode: (on) => {
      liftMode = on;
    },
    setTheme,
    fit: () => lastBox && frame(lastBox),
    look: (name) => lastBox && frame(lastBox, VIEWS[name]),
    framesDrawn: () => renderer.info.render.frame,
    setMeasuring: (on) => {
      measuring = on;
      readStats();
    },
    readStats,
    setPotato,
  };
}
