import {
  MAX_RADIUS_MM,
  MAX_SIZE_MM,
  LIES,
  SHAPES,
  SPECIES,
  blank,
  cornerCount,
  cornerLayout,
  cutList,
  describePose,
  poseHalfTurn,
  duplicatePart,
  newPartBeside,
  outline,
  projectBounds,
  snapPosition,
  totals,
  updatePart,
} from './model.js';
import {
  EDGES,
  HINGE_TYPES,
  JOINT_KINDS,
  changeJoint,
  changePart,
  assemblyOverlaps,
  dragMode,
  hardwareList,
  hardwarePieces,
  hingeAxis,
  hingeEdges,
  joinParts,
  joinedTo,
  jointProblem,
  jointRemoval,
  moveAssembly,
  partRemoval,
  placements,
  removePart,
  rotateAssembly,
  suggestedSizes,
  suggestSizes,
  swingingHinge,
  touchingParts,
  updateJoint,
} from './joints.js';
import { starterProject } from './project.js';
import { createScene } from './scene.js';
import { download, loadDebug, loadPotato, loadSaved, loadSnap, readFile, save, saveDebug, savePotato, saveSnap } from './storage.js';
import { createDebugPanel } from './debug.js';

const HISTORY_LIMIT = 100;
const TYPING_MERGE_MS = 1200;
const $ = (id) => document.getElementById(id);

const saved = loadSaved();
let project = saved.project ?? starterProject();
let selectedId = null;
const undoStack = [];
const redoStack = [];
let lastEdit = null;

const NUDGE_MM = 10;
const FINE_NUDGE_MM = 1;
let dragStart = null;
let snapOn = loadSnap();
let liftOn = false;
let addingJoint = false;
let openJointId = null;

function showDragModes(lifting, snapping) {
  $('mode-floor').setAttribute('aria-pressed', String(!lifting));
  $('mode-height').setAttribute('aria-pressed', String(lifting));
  $('snap').setAttribute('aria-pressed', String(snapping));
}

const view = createScene($('viewport'), {
  onSelect: (id) => select(id),
  onDrag: (event) => handleDrag(event),
  dragKind: (id) => {
    const mode = dragMode(project, id);
    return mode === 'swing' ? { mode, axis: hingeAxis(project, swingingHinge(project, id).id) } : { mode };
  },
});

const SWING_STEP_DEG = 5;
const SWING_CATCH_DEG = 3;

function swingTo(angle, limit, snapping) {
  const clamp = (value) => Math.min(limit, Math.max(0, value));
  if (!snapping) return Math.round(clamp(angle) * 10) / 10;
  const caught = [0, 90, limit].find((stop) => stop <= limit && Math.abs(angle - stop) <= SWING_CATCH_DEG);
  return clamp(caught ?? Math.round(angle / SWING_STEP_DEG) * SWING_STEP_DEG);
}

const jointById = (state, id) => (state.joints ?? []).find((joint) => joint.id === id);

function swingDrag(swing, invertSnap) {
  const start = jointById(dragStart.project, dragStart.hinge.id);
  const angle = swingTo(start.open + swing, start.opensTo, snapOn !== invertSnap);
  if (angle === jointById(project, start.id).open) return;
  const next = updateJoint({ ...dragStart.project, parts: project.parts }, start.id, 'open', angle);
  if (!next) return;
  project = next;
  placeView();
  renderEditor();
  renderSelectionChip();
}

const handleDrag = timed(({ phase, id, delta, vertical, invertSnap, swing }) => {
  if (phase === 'start') {
    dragStart = { project, base: project, part: project.parts.find((part) => part.id === id), hinge: swingingHinge(project, id) };
    showDragModes(vertical, snapOn !== invertSnap);
    return;
  }
  if (!dragStart) return;
  if (phase === 'rebase') {
    dragStart.base = project;
    dragStart.part = selectedPart();
    return;
  }
  if (phase === 'move' && swing !== undefined) {
    if (dragStart.hinge) swingDrag(swing, invertSnap);
    return;
  }
  if (phase === 'move') {
    showDragModes(vertical, snapOn !== invertSnap);
    const from = dragStart.part;
    const proposed = Object.fromEntries(Object.entries(delta).map(([axis, change]) => [axis, from[axis] + change]));
    const members = joinedTo(dragStart.base, id);
    const others = project.parts.filter((part) => !members.has(part.id));
    const target = snapPosition(from, proposed, others, { snap: snapOn !== invertSnap });
    const next = moveAssembly(dragStart.base, id, target);
    const same = next.parts.every((part, i) => ['x', 'y', 'z'].every((axis) => part[axis] === project.parts[i][axis]));
    if (same) return;
    project = next;
    placeView();
    renderEditor();
    return;
  }
  const before = dragStart.project;
  dragStart = null;
  showDragModes(liftOn, snapOn);
  if (project === before) return;
  undoStack.push(before);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastEdit = null;
  persist();
  render();
});

function rotateSelected(axis) {
  const part = selectedPart();
  if (!part) return;
  const turned = rotateAssembly(project, part.id, axis);
  if (turned !== project) commit(turned);
}

function setSnap(on) {
  snapOn = on;
  saveSnap(on);
  showDragModes(liftOn, snapOn);
}

function setLift(on) {
  liftOn = on;
  view.setLiftMode(on);
  showDragModes(liftOn, snapOn);
}

function nudge(axis, amount) {
  const part = selectedPart();
  if (!part) return;
  const next = moveAssembly(project, part.id, { [axis]: part[axis] + amount });
  if (next !== project) commit(next, `${part.id}:nudge`);
}

function commit(next, editKey = null) {
  const now = Date.now();
  const sameEdit = editKey && lastEdit?.key === editKey && now - lastEdit.at < TYPING_MERGE_MS;
  lastEdit = editKey ? { key: editKey, at: now } : null;
  if (!sameEdit) {
    undoStack.push(project);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  redoStack.length = 0;
  project = next;
  if (!project.parts.some((part) => part.id === selectedId)) selectedId = null;
  persist();
  render();
}

function persist() {
  const saved = save(project);
  $('save-state').textContent = saved ? 'Saved in this browser' : 'Could not save in this browser';
  $('save-state').classList.toggle('failed', !saved);
}

const undo = keepingFocus(() => {
  if (!undoStack.length) return;
  redoStack.push(project);
  project = undoStack.pop();
  afterHistoryMove();
});

const redo = keepingFocus(() => {
  if (!redoStack.length) return;
  undoStack.push(project);
  project = redoStack.pop();
  afterHistoryMove();
});

function afterHistoryMove() {
  lastEdit = null;
  if (!project.parts.some((part) => part.id === selectedId)) selectedId = null;
  persist();
  render();
}

const select = keepingFocus((id) => {
  if (id !== selectedId) addingJoint = false;
  selectedId = id;
  view.setSelected(id);
  placeView();
  renderParts();
  renderEditor();
  renderSelectionChip();
  renderButtons();
  if (id) $(`part-${id}`)?.scrollIntoView({ block: 'nearest' });
});

const visible = (node) => (node.checkVisibility ? node.checkVisibility() : node.getClientRects().length > 0);
const usable = (node) => Boolean(node?.isConnected && !node.disabled && visible(node));
let focusGuards = 0;

function keepingFocus(action) {
  return (...args) => {
    const before = document.activeElement;
    const partId = selectedId;
    const index = project.parts.findIndex((part) => part.id === partId);
    focusGuards += 1;
    try {
      return action(...args);
    } finally {
      focusGuards -= 1;
      const now = document.activeElement;
      const lost = !now || now === document.body || !usable(now);
      if (!focusGuards && lost && before && before !== document.body && !usable(before)) focusNear(before, partId, index);
    }
  };
}

function focusNear(before, partId, index) {
  const rows = [...$('parts').querySelectorAll('.row-main')];
  const candidates = [
    before.closest('.view') && view.canvas,
    $(`part-${partId}`)?.querySelector('.row-main'),
    $(`part-${selectedId}`)?.querySelector('.row-main'),
    rows[index] ?? rows.at(-1),
    $('add'),
    $('add-phone'),
    document.querySelector(`.tabs [data-tab="${$('main').dataset.tab}"]`),
  ];
  candidates.find(usable)?.focus();
}

function selectedPart() {
  return project.parts.find((part) => part.id === selectedId) ?? null;
}

function replacePart(next, mergeKey = null) {
  const result = changePart(project, next);
  if (result.project) commit(result.project, mergeKey && `${next.id}:${mergeKey}`);
  return result;
}

function addPart(shape = 'board') {
  const part = newPartBeside(project.parts, shape);
  commit({ ...project, parts: [...project.parts, part] });
  select(part.id);
}

function duplicateSelected() {
  const part = selectedPart();
  if (!part) return;
  const copy = duplicatePart(part, project.parts);
  if (copy === part) return;
  const index = project.parts.indexOf(part);
  commit({ ...project, parts: [...project.parts.slice(0, index + 1), copy, ...project.parts.slice(index + 1)] });
  select(copy.id);
}

const deleteSelected = keepingFocus((origin) => {
  if (!selectedId) return;
  const refusal = deleteRefusal(selectedId);
  if (refusal) {
    showDeleteRefusal(refusal, origin);
    return;
  }
  commit(removePart(project, selectedId));
  select(null);
});

function deleteRefusal(id) {
  if (project.parts.find((part) => part.id === id)?.locked) return `${partName(id)} is locked. Unlock it first to delete it.`;
  const removal = partRemoval(project, id);
  return removal.refused ? lockedMoveMessage(removal.piece) : null;
}

function showDeleteRefusal(message, origin) {
  const notes = [$('editor-note'), $('parts-note')];
  if (origin?.closest('#parts')) notes.reverse();
  const shown = notes.find(visible) ?? notes[0];
  for (const note of notes) note.textContent = note === shown ? message : '';
}

function offWithReason(button, reason) {
  if (reason) {
    button.setAttribute('aria-disabled', 'true');
    button.title = reason;
  } else {
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
  }
}

function toggleLock() {
  const part = selectedPart();
  if (!part) return;
  const toggled = updatePart(part, 'locked', !part.locked);
  commit({ ...project, parts: project.parts.map((each) => (each.id === part.id ? toggled : each)) });
}

const mm = (value) => `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const trio = (length, width, thickness) => `${mm(length)} × ${mm(width)} × ${mm(thickness)}`;

function blankText(part) {
  const size = blank(part);
  return part.shape === 'dowel' ? `⌀${mm(size.width)} × ${mm(size.length)}` : trio(size.length, size.width, size.thickness);
}

function sizeText(part) {
  if (part.shape === 'disc') return `⌀${mm(part.diameter)} × ${mm(part.thickness)}`;
  if (part.shape === 'dowel') return `⌀${mm(part.dowelDiameter)} × ${mm(part.length)} dowel`;
  if (part.shape === 'arc') return `Arc R${mm(part.outerRadius)} × ${mm(part.bandWidth)} × ${mm(part.sweep)}° × ${mm(part.thickness)}`;
  if (part.shape === 'triangle') return `Triangle ${trio(part.length, part.width, part.thickness)}`;
  const plain = trio(part.length, part.width, part.thickness);
  const count = cornerCount(part);
  if (!count) return plain;
  if (part.corners === 'rounded') return `${plain} · R${mm(part.cornerRadius)} ×${count}`;
  return `${plain} · cut ${mm(part.cutLength)} × ${mm(part.cutWidth)} ×${count}`;
}

function shapeNote(part) {
  if (part.shape === 'disc') return `Disc ⌀${mm(part.diameter)}`;
  if (part.shape === 'dowel') return 'Dowel rod';
  if (part.shape === 'arc') return `Arc R${mm(part.outerRadius)} × ${mm(part.bandWidth)} × ${mm(part.sweep)}°`;
  if (part.shape === 'triangle') return `Triangle ${mm(part.length)} × ${mm(part.width)}`;
  const count = cornerCount(part);
  if (!count) return null;
  const corners = count === 1 ? 'corner' : 'corners';
  const layout = cornerLayout(part) ? ` (${cornerLayout(part)})` : '';
  if (part.corners === 'rounded') return `R${mm(part.cornerRadius)} ×${count} ${corners}${layout}`;
  return `${count} ${corners} cut ${mm(part.cutLength)} × ${mm(part.cutWidth)}${layout}`;
}

const SHAPE_PLURALS = { board: 'boards', disc: 'discs', dowel: 'dowels', arc: 'arcs', triangle: 'triangles' };
const onlyBoards = (parts) => parts.every((part) => part.shape === 'board');

function pieceWord(parts) {
  const one = parts.length === 1;
  if (onlyBoards(parts)) return one ? 'board' : 'boards';
  return one ? 'piece' : 'pieces';
}

function countText(parts) {
  const total = `${parts.length} ${pieceWord(parts)}`;
  if (onlyBoards(parts)) return total;
  const kinds = Object.keys(SHAPES)
    .map((shape) => [shape, parts.filter((part) => part.shape === shape).length])
    .filter(([, count]) => count)
    .map(([shape, count]) => `${count} ${count === 1 ? SHAPES[shape].toLowerCase() : SHAPE_PLURALS[shape]}`);
  return `${total} (${kinds.join(', ')})`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function outlinePath(part, { width, height, smallest }) {
  const { points, holes } = outline(part);
  const size = blank(part);
  const scale = Math.min(width / size.length, height / size.width);
  const sx = Math.max(scale, (width * smallest) / size.length);
  const sy = Math.max(scale, (height * smallest) / size.width);
  const ring = (list) => `M${list.map(([u, v]) => `${(width / 2 + u * sx).toFixed(2)} ${(height / 2 - v * sy).toFixed(2)}`).join('L')}Z`;
  return [points, ...holes].map(ring).join('');
}

const SILHOUETTE_PX = 14;

function silhouette(part) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sil');
  svg.setAttribute('viewBox', `-1 -1 ${SILHOUETTE_PX + 2} ${SILHOUETTE_PX + 2}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', outlinePath(part, { width: SILHOUETTE_PX, height: SILHOUETTE_PX, smallest: 0.4 }));
  path.setAttribute('fill', SPECIES[part.species].color);
  svg.append(path);
  return svg;
}

const partName = (id) => project.parts.find((part) => part.id === id)?.name || 'Unnamed';
const jointsOn = (id) => (project.joints ?? []).filter((joint) => joint.part === id || joint.to === id);
const assemblyPinned = (id) => project.parts.some((part) => joinedTo(project, id).has(part.id) && part.locked);

function openAngleOf(id) {
  const hinge = swingingHinge(project, id);
  return hinge?.part === id ? hinge.open : null;
}

function jointTag(part) {
  const joints = jointsOn(part.id);
  if (!joints.length) return null;
  const hinge = swingingHinge(project, part.id);
  if (hinge?.part === part.id) return `Swings on ${partName(hinge.to)}${hinge.open ? ` · open ${mm(hinge.open)}°` : ''}`;
  const partners = new Set(joints.map((joint) => (joint.part === part.id ? joint.to : joint.part)));
  return partners.size === 1 ? `Joined to ${partName([...partners][0])}` : `Joined to ${partners.size} pieces`;
}

function jointWarnings(part) {
  const words = new Set();
  for (const joint of jointsOn(part.id)) {
    const problem = jointProblem(project, joint.id);
    if (!problem) continue;
    if (joint.kind === 'hinge') words.add(/thick/.test(problem) ? 'Too thin for concealed hinges' : 'Hinge can’t swing');
    else if (/no longer touches/.test(problem)) words.add('Joint no longer touches');
    else words.add('Fixing too long');
  }
  return [...words];
}

function renderParts() {
  const clashing = new Set(assemblyOverlaps(project).flat());
  const focusKey = $('parts').contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  $('parts').replaceChildren(
    ...project.parts.map((part) => {
      const selected = part.id === selectedId;
      const item = element('li', selected ? 'row sel' : 'row');
      item.id = `part-${part.id}`;
      const main = element('button', 'row-main');
      main.type = 'button';
      main.dataset.focus = `main:${part.id}`;
      main.setAttribute('aria-pressed', String(selected));
      main.addEventListener('click', () => select(selected ? null : part.id));
      main.append(silhouette(part), element('span', 'nm', part.name || 'Unnamed'), element('span', 'dim', sizeText(part)));
      const tags = [part.locked && '🔒 Locked', jointTag(part)].filter(Boolean);
      if (tags.length) main.append(element('span', 'tag', tags.join(' · ')));
      const warnings = [clashing.has(part.id) && 'Overlaps another piece', ...jointWarnings(part)].filter(Boolean);
      if (warnings.length) main.append(element('span', 'warn', warnings.join(' · ')));
      item.append(main);
      if (selected) {
        const actions = element('div', 'row-acts');
        const lock = element('button', '', part.locked ? 'Unlock' : 'Lock');
        lock.type = 'button';
        lock.dataset.focus = `lock:${part.id}`;
        lock.setAttribute('aria-pressed', String(part.locked));
        lock.title = part.locked ? 'Let this board be moved, rotated and resized again' : 'Stop this board from being moved, rotated, resized or deleted';
        lock.addEventListener('click', toggleLock);
        const copy = element('button', '', 'Duplicate');
        copy.type = 'button';
        copy.dataset.focus = `copy:${part.id}`;
        copy.addEventListener('click', duplicateSelected);
        const remove = element('button', 'danger', 'Delete');
        remove.type = 'button';
        remove.dataset.focus = `delete:${part.id}`;
        remove.addEventListener('click', () => deleteSelected(remove));
        offWithReason(remove, deleteRefusal(part.id));
        actions.append(lock, copy, remove);
        item.append(actions);
      }
      return item;
    }),
  );
  $('parts-empty').hidden = project.parts.length > 0;
  $('part-count').textContent = String(project.parts.length);
  if (focusKey) restoreListFocus(focusKey);
}

function restoreListFocus(focusKey) {
  const rowMain = (id) => $(`part-${id}`)?.querySelector('.row-main');
  const [, partId] = focusKey.split(':');
  const target = $('parts').querySelector(`[data-focus="${focusKey}"]`) ?? rowMain(selectedId) ?? rowMain(partId);
  target?.focus();
}

function renderSelectionChip() {
  const part = selectedPart();
  const chip = $('view-sel');
  chip.hidden = !part;
  if (!part) return;
  const open = openAngleOf(part.id);
  chip.replaceChildren(
    ...(part.locked ? ['🔒 '] : []),
    element('b', '', part.name || 'Unnamed'),
    ` · ${open === null ? sizeText(part) : open ? `open ${mm(open)}°` : 'closed'}`,
  );
}

function describeView() {
  const box = projectBounds(project.parts);
  const count = countText(project.parts);
  const size = box ? `, ${mm(box.max.x - box.min.x)} wide × ${mm(box.max.y - box.min.y)} high × ${mm(box.max.z - box.min.z)} deep (mm)` : '';
  const part = selectedPart();
  const picked = part ? `. Picked: ${part.name || 'Unnamed'}, ${sizeText(part)}` : '';
  view.canvas.setAttribute('aria-label', `${project.name}: ${count}${size}${picked}`);
}

function renderEditor() {
  const part = selectedPart();
  const form = $('editor');
  form.hidden = !part;
  $('editor-empty').hidden = Boolean(part);
  if (!part) return;
  showPose(part.pose);
  for (const input of form.querySelectorAll('[name]')) {
    if (input.type === 'radio' || input.type === 'checkbox') {
      input.checked = input.type === 'radio' ? part[input.name] === input.value : Boolean(part[input.name]);
      showFieldError(input, null);
      continue;
    }
    if (input.tagName === 'INPUT' && document.activeElement === input && input.dataset.partId === part.id) continue;
    input.value = String(part[input.name]);
    input.dataset.partId = part.id;
    showFieldError(input, null);
  }
  for (const input of form.querySelectorAll('[data-geometry]')) input.disabled = part.locked;
  if (assemblyPinned(part.id)) for (const name of ['x', 'y', 'z', 'pose']) form.querySelector(`[name="${name}"]`).disabled = true;
  $('lock').setAttribute('aria-pressed', String(part.locked));
  $('lock').textContent = part.locked ? '🔒 Locked · unlock' : 'Lock in place';
  $('locked-note').hidden = !part.locked;
  $('wood-swatch').style.background = SPECIES[part.species].color;
  renderShapeFields(part);
  renderJoints(part);
  const focused = document.activeElement;
  if (focused?.type === 'radio' && form.contains(focused) && !focused.checked) {
    form.querySelector(`[name="${focused.name}"]:checked`)?.focus();
  }
}

function showPose(pose) {
  const select = $('field-pose');
  const extra = select.querySelector('[data-turned]');
  const half = poseHalfTurn(pose);
  $('pose-note').hidden = !half;
  if (!half) {
    extra?.remove();
    return;
  }
  $('pose-note').textContent = `${half.turn[0].toUpperCase()}${half.turn.slice(1)} from “${half.lies}”.`;
  const option = extra ?? new Option();
  option.dataset.turned = '';
  option.value = pose;
  option.textContent = describePose(pose);
  if (!extra) select.prepend(option);
}

const SHAPE_FIELDS = {
  board: ['length', 'width', 'thickness'],
  disc: ['diameter', 'thickness'],
  dowel: ['dowelDiameter', 'length'],
  arc: ['outerRadius', 'bandWidth', 'sweep', 'thickness'],
  triangle: ['length', 'width', 'thickness'],
};

// The checkbox's outer corner in sketch units at the widest stretch .corner-pick's max-width allows.
const PREVIEW = { width: 256, height: 88, box: { x: 12.8, y: 16 }, gap: 3 };

function sketchCut(cutLength, cutWidth) {
  const { box, gap } = PREVIEW;
  const fit = (box.x / cutLength + box.y / cutWidth) - gap * Math.hypot(1 / cutLength, 1 / cutWidth);
  const scale = Math.min(1, fit);
  return { cutLength: cutLength * scale, cutWidth: cutWidth * scale };
}

function cornerPreview(part) {
  const { width, height } = PREVIEW;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const sketch = {
    ...part,
    length: width,
    width: height,
    cornerRadius: clamp((part.cornerRadius / Math.min(part.length, part.width)) * height, 16, height / 2),
    ...sketchCut(clamp((part.cutLength / part.length) * width, 18, width / 2), clamp((part.cutWidth / part.width) * height, 18, height / 2)),
  };
  return outlinePath(sketch, { width, height, smallest: 0 });
}

function renderShapeFields(part) {
  const wanted = SHAPE_FIELDS[part.shape];
  const sizes = $('sizes');
  for (const field of sizes.children) field.hidden = !wanted.includes(field.dataset.field);
  const shown = [...sizes.children].filter((field) => !field.hidden).map((field) => field.dataset.field);
  if (shown.join() !== wanted.join()) {
    for (const name of wanted) sizes.append(sizes.querySelector(`[data-field="${name}"]`));
  }
  $('arc-inner').hidden = part.shape !== 'arc';
  $('arc-inner').textContent = `Inner radius ${mm(part.outerRadius - part.bandWidth)} mm (outer radius less the band width).`;
  $('cut-from').textContent = `Cut from ${blankText(part)}${part.shape === 'dowel' ? ' dowel rod' : ''}`;
  $('corners-box').hidden = part.shape !== 'board';
  $('corner-pick').hidden = part.corners === 'square';
  $('radius-field').hidden = part.corners !== 'rounded';
  $('cut-fields').hidden = part.corners !== 'cut';
  $('corner-shape').setAttribute('viewBox', `0 0 ${PREVIEW.width} ${PREVIEW.height}`);
  $('corner-shape').querySelector('path').setAttribute('d', cornerPreview(part));
}

const CUT_LABELS = [...document.querySelectorAll('.cut-list thead th')].map((th) => th.textContent);

function renderCutList() {
  $('cut-rows').replaceChildren(
    ...cutList(project.parts).map((row) => {
      const tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      const volume = (row.count * row.volume) / 1e9;
      const face = (row.count * row.area) / 1e6;
      const cells = [
        [`${row.count} ×`, 'num'],
        [blankText(row.piece)],
        [row.names.join(', ')],
        [SPECIES[row.species].label],
        [`${volume.toFixed(4)} m³`, 'num'],
        [`${face.toFixed(2)} m²`, 'num'],
      ];
      cells.forEach(([text, className], i) => {
        const td = element('td', className, text);
        td.setAttribute('role', 'cell');
        td.dataset.label = CUT_LABELS[i];
        tr.append(td);
      });
      const note = shapeNote(row.piece);
      if (note) tr.children[1].append(element('span', 'shape-note', note));
      return tr;
    }),
  );
  const sum = totals(project.parts);
  const stat = (value, label) => {
    const span = element('span');
    span.append(element('b', '', value), ` ${label}`);
    return span;
  };
  $('totals').replaceChildren(
    stat(String(sum.count), pieceWord(project.parts)),
    stat(sum.volume.toFixed(4), 'm³ volume'),
    stat(sum.area.toFixed(2), 'm² face'),
    stat(`≈ ${sum.weight.toFixed(1)}`, 'kg'),
  );
  const fixings = hardwareList(project).reduce((count, row) => count + (row.count ?? 0), 0);
  if (fixings) $('totals').append(stat(String(fixings), fixings === 1 ? 'hardware item' : 'hardware items'));
  const box = projectBounds(project.parts);
  $('overall').textContent = box
    ? `Overall ${mm(box.max.x - box.min.x)} wide × ${mm(box.max.y - box.min.y)} high × ${mm(box.max.z - box.min.z)} deep (mm)`
    : '';
}

const SIZE_ERROR = `Enter a size above 0, up to ${mm(MAX_SIZE_MM)} mm.`;
const POSITION_ERROR = `Enter a number from −${mm(MAX_SIZE_MM)} to ${mm(MAX_SIZE_MM)} mm.`;
const half = (value) => mm(Math.floor((value / 2) * 10) / 10);

function cornersNeed(part, side) {
  if (!cornerCount(part)) return 0;
  if (part.corners === 'rounded') return 2 * part.cornerRadius;
  return 2 * (side === 'length' ? part.cutLength : part.cutWidth);
}

const FIELD_ERRORS = {
  length: (part, value) => sideError(part, 'length', value),
  width: (part, value) => sideError(part, 'width', value),
  thickness: () => SIZE_ERROR,
  diameter: () => `Enter a diameter above 0, up to ${mm(MAX_SIZE_MM)} mm.`,
  dowelDiameter: () => `Enter a diameter above 0, up to ${mm(MAX_SIZE_MM)} mm.`,
  outerRadius: (part, value) =>
    value > 0 && value <= part.bandWidth
      ? `Outer radius must be more than the band width (${mm(part.bandWidth)} mm).`
      : `Enter an outer radius above 0, up to ${mm(MAX_RADIUS_MM)} mm.`,
  bandWidth: (part, value) =>
    value >= part.outerRadius
      ? `Band width must be less than the outer radius (${mm(part.outerRadius)} mm).`
      : `Enter a band width above 0, less than the outer radius (${mm(part.outerRadius)} mm).`,
  sweep: () => 'Enter a sweep from 1° to 360°.',
  cornerRadius: (part) => {
    const side = part.width <= part.length ? 'width' : 'length';
    return `Enter a radius above 0, up to ${half(part[side])} mm (half the ${side}).`;
  },
  cutLength: (part) => `Enter a cut above 0, up to ${half(part.length)} mm (half the length).`,
  cutWidth: (part) => `Enter a cut above 0, up to ${half(part.width)} mm (half the width).`,
  x: () => POSITION_ERROR,
  y: () => POSITION_ERROR,
  z: () => POSITION_ERROR,
};

function sideError(part, side, value) {
  const need = cornersNeed(part, side);
  if (value > 0 && value <= MAX_SIZE_MM && value < need) {
    return `Enter at least ${mm(need)} mm: twice the corner ${part.corners === 'rounded' ? 'radius' : 'cut'}.`;
  }
  return SIZE_ERROR;
}

const fieldError = (part, input) => FIELD_ERRORS[input.name]?.(part, Number(input.value)) ?? 'This value is not allowed.';

function pendingFields(changed) {
  return [...$('editor').querySelectorAll('[aria-invalid="true"]')]
    .filter((field) => field !== changed)
    .map((field) => ({ field, typed: field.value }));
}

function recheckPendingFields(pending) {
  const stillInvalid = [];
  for (const { field, typed } of pending) {
    const part = selectedPart();
    if (!part) return;
    if (!usable(field)) {
      field.value = String(part[field.name]);
      showFieldError(field, null);
      continue;
    }
    const next = updatePart(part, field.name, typed);
    const result = next && replacePart(next, field.name);
    if (!result?.project) stillInvalid.push({ field, typed, refusal: result?.refused && lockedMoveMessage(result.piece) });
  }
  for (const { field, typed, refusal } of stillInvalid) {
    field.value = typed;
    showFieldError(field, refusal || fieldError(selectedPart(), field));
  }
}

function showFieldError(input, message) {
  const note = $(`${input.name}-error`);
  if (!note) return;
  if (note.textContent !== (message ?? '')) note.textContent = message ?? '';
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', note.id);
  } else {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

const JOINT_FORMS = {
  screws: [
    { group: 'trio', fields: [['count', 'Screws', 'count'], ['diameter', 'Diameter (mm)', 'mm'], ['length', 'Length (mm)', 'mm']] },
    { check: ['glued', 'Also glued'] },
  ],
  nails: [
    { group: 'trio', fields: [['count', 'Nails', 'count'], ['diameter', 'Diameter (mm)', 'mm'], ['length', 'Length (mm)', 'mm']] },
    { check: ['glued', 'Also glued'] },
  ],
  glue: [{ help: 'Nothing to set. Counts as one glued joint in the hardware list.' }],
  bracket: [
    { group: 'trio', fields: [['count', 'Brackets', 'count'], ['leg', 'Leg (mm)', 'mm'], ['width', 'Width (mm)', 'mm']] },
    { legend: 'Screws for each bracket', group: 'trio', fields: [['screwsEach', 'Screws', 'whole'], ['screwDiameter', 'Diameter (mm)', 'mm'], ['screwLength', 'Length (mm)', 'mm']] },
    { check: ['glued', 'Also glued'] },
  ],
  hinge: [
    { swing: true },
    { select: ['hingeType', 'Type', () => HINGE_TYPES] },
    { group: 'trio', fields: [['count', 'Hinges', 'count'], ['size', 'Length (mm)', 'mm'], ['screwsEach', 'Screws each', 'whole']] },
    { group: 'duo', fields: [['screwDiameter', 'Screw diameter (mm)', 'mm'], ['screwLength', 'Screw length (mm)', 'mm']] },
    { group: 'duo', select: ['edge', 'Hinge edge', (joint) => Object.fromEntries(hingeEdges(project, joint).map((edge) => [edge, EDGES[edge]]))], fields: [['opensTo', 'Opens up to (°)', 'deg']] },
  ],
};

const JOINT_ERRORS = {
  count: 'Enter a whole number, at least 1.',
  whole: 'Enter a whole number, 0 or more.',
  mm: 'Enter a size above 0 mm.',
  deg: 'Enter an angle from 1° to 270°.',
  open: 'Enter an angle from 0° up to how far it opens.',
  locked: 'That would swing a locked piece. Unlock it first.',
  apart: 'These pieces no longer touch, so there are no sizes to suggest.',
};

const lockedMoveMessage = (piece) => `That would swing ${piece.name || 'Unnamed'}, which is locked. Unlock ${piece.name || 'Unnamed'} first.`;

function jointTitle(joint, part) {
  const other = partName(joint.part === part.id ? joint.to : joint.part);
  if (joint.kind === 'hinge') return joint.part === part.id ? `Hinge · swings on ${other}` : `Hinge · carries ${other}`;
  return `${JOINT_KINDS[joint.kind]} · to ${other}`;
}

function jointSummary(joint) {
  const glued = joint.glued ? ' · glued' : '';
  if (joint.kind === 'screws' || joint.kind === 'nails') return `${joint.count} × ${mm(joint.diameter)} × ${mm(joint.length)}${glued}`;
  if (joint.kind === 'bracket') return `${joint.count} × ${mm(joint.leg)} × ${mm(joint.leg)} × ${mm(joint.width)}${glued}`;
  if (joint.kind === 'hinge') {
    const type = joint.hingeType === 'concealed' ? 'concealed, 35 mm cup' : `${joint.hingeType} ${mm(joint.size)} mm`;
    return `${joint.count} × ${type} · open ${mm(joint.open)}°`;
  }
  return '';
}

function jointInput(joint, field, kind) {
  const input = element('input', 'num');
  Object.assign(input, { type: 'number', step: kind === 'mm' || kind === 'deg' ? 'any' : '1', inputMode: kind === 'mm' || kind === 'deg' ? 'decimal' : 'numeric' });
  input.min = kind === 'whole' ? '0' : kind === 'deg' ? '1' : kind === 'count' ? '1' : '0.1';
  input.dataset.jf = field;
  input.dataset.joint = joint.id;
  input.dataset.check = kind;
  return input;
}

function jointSelect(joint, field, options) {
  const select = document.createElement('select');
  fillSelect(select, options);
  select.dataset.jf = field;
  select.dataset.joint = joint.id;
  return select;
}

function labelled(text, control) {
  const label = element('label', '', `${text} `);
  label.append(control);
  return label;
}

function jointButton(joint, act, text, className = '') {
  const button = element('button', className, text);
  button.type = 'button';
  button.dataset.jfAct = act;
  button.dataset.joint = joint.id;
  return button;
}

function swingControls(joint) {
  const box = element('div', 'swing');
  const range = Object.assign(document.createElement('input'), { type: 'range', min: '0', step: '1' });
  range.setAttribute('aria-label', 'Open angle');
  Object.assign(range.dataset, { jf: 'open', joint: joint.id });
  const number = jointInput(joint, 'open', 'deg');
  number.min = '0';
  number.setAttribute('aria-label', 'Open (°)');
  const buttons = element('div', 'duo');
  buttons.append(jointButton(joint, 'close', 'Close'), jointButton(joint, 'open-full', 'Open fully'));
  box.append(element('label', '', 'Open (°)'), range, number, buttons);
  return box;
}

function jointBody(joint) {
  const body = element('div', 'joint-body');
  body.append(Object.assign(element('p', 'warn'), { role: 'status' }));
  for (const row of JOINT_FORMS[joint.kind]) {
    if (row.swing) {
      body.append(swingControls(joint));
      continue;
    }
    if (row.help) {
      body.append(element('p', 'help', row.help));
      continue;
    }
    if (row.check) {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
      Object.assign(box.dataset, { jf: row.check[0], joint: joint.id });
      const label = element('label', 'check');
      label.append(box, row.check[1]);
      body.append(label);
      continue;
    }
    const holder = row.legend ? element('fieldset') : body;
    if (row.legend) holder.append(element('legend', '', row.legend));
    const group = row.group ? element('div', row.group) : holder;
    if (row.select) {
      const [field, text, options] = row.select;
      group.append(labelled(text, jointSelect(joint, field, options(joint))));
    }
    for (const [field, text, kind] of row.fields ?? []) {
      const wrap = element('div', 'field');
      wrap.dataset.jfField = field;
      wrap.append(labelled(text, jointInput(joint, field, kind)));
      group.append(wrap);
    }
    if (group !== holder) holder.append(group);
    if (holder !== body) body.append(holder);
  }
  const error = Object.assign(element('p', 'field-error joint-error'), { id: `joint-error-${joint.id}` });
  error.setAttribute('aria-live', 'polite');
  body.append(error);
  const actions = element('div', 'duo');
  actions.append(jointButton(joint, 'suggest', 'Use suggested sizes'), jointButton(joint, 'remove', 'Remove joint', 'danger'));
  body.append(actions);
  return body;
}

function jointCard(joint, part) {
  const card = element('details', 'joint');
  card.name = 'joint';
  card.dataset.jointCard = joint.id;
  card.open = joint.id === openJointId;
  const summary = element('summary');
  summary.append(element('span', 'jn'), element('span', 'dim'), element('span', 'warn'));
  card.append(summary, jointBody(joint));
  card.addEventListener('toggle', () => {
    if (card.open) openJointId = joint.id;
    else if (openJointId === joint.id) openJointId = null;
  });
  fillJointCard(card, joint, part);
  return card;
}

function differsFromSuggestion(joint) {
  const suggested = suggestedSizes(project, joint);
  return Boolean(suggested) && Object.entries(suggested).some(([field, value]) => field !== 'open' && joint[field] !== value);
}

function fillJointCard(card, joint, part) {
  const problem = jointProblem(project, joint.id);
  const [title, summary, warn] = card.querySelector('summary').children;
  title.textContent = jointTitle(joint, part);
  summary.textContent = jointSummary(joint);
  summary.hidden = !summary.textContent;
  warn.textContent = problem ? problem.split(/[.;]/)[0] : '';
  warn.hidden = !problem;
  const note = card.querySelector('.joint-body > .warn');
  note.textContent = problem ?? '';
  note.hidden = !problem;
  const stuck = joint.kind === 'hinge' && dragMode(project, joint.part) !== 'swing';
  for (const control of card.querySelectorAll('[data-jf]')) {
    const field = control.dataset.jf;
    if (control.type === 'range') control.max = String(joint.opensTo);
    if (field === 'open') control.disabled = stuck;
    if (control === document.activeElement && control.getAttribute('aria-invalid') === 'true') continue;
    if (control === document.activeElement && control.type === 'number') continue;
    if (control.type === 'checkbox') control.checked = Boolean(joint[field]);
    else control.value = String(joint[field]);
    if (control.getAttribute('aria-invalid') === 'true') showJointError(control, null);
  }
  const size = card.querySelector('[data-jf-field="size"]');
  if (size) size.hidden = joint.hingeType === 'concealed';
  for (const button of card.querySelectorAll('[data-jf-act="close"], [data-jf-act="open-full"]')) button.disabled = stuck;
  card.querySelector('[data-jf-act="suggest"]').hidden = !differsFromSuggestion(joint);
  const removal = jointRemoval(project, joint.id);
  offWithReason(card.querySelector('[data-jf-act="remove"]'), removal.refused && lockedMoveMessage(removal.piece));
}

let jointsShape = '';

function renderJoints(part) {
  const joints = jointsOn(part.id);
  const shape = [part.id, ...joints.map((joint) => `${joint.id}:${joint.hingeType ?? ''}:${hingeEdges(project, joint).join()}`)].join('|');
  const list = $('joints');
  if (shape !== jointsShape) {
    jointsShape = shape;
    const focusKey = list.contains(document.activeElement) ? focusKeyOf(document.activeElement) : null;
    list.replaceChildren(...joints.map((joint) => jointCard(joint, part)));
    if (focusKey) list.querySelector(focusKey)?.focus();
  } else {
    for (const joint of joints) fillJointCard(list.querySelector(`[data-joint-card="${joint.id}"]`), joint, part);
  }
  $('joints-empty').hidden = joints.length > 0;
  const touching = touchingParts(project.parts, part.id);
  $('swing-help').hidden = dragMode(project, part.id) !== 'swing';
  $('joints-none').hidden = touching.length > 0 || joints.length > 0;
  $('joint-add-open').hidden = touching.length === 0;
  $('joint-add-open').setAttribute('aria-expanded', String(addingJoint));
  $('joint-add').hidden = !addingJoint || touching.length === 0;
  if (addingJoint) renderJointAdd(part, touching);
}

function focusKeyOf(node) {
  if (node.dataset.jf) return `[data-jf="${node.dataset.jf}"][data-joint="${node.dataset.joint}"]${node.type === 'range' ? '[type="range"]' : ''}`;
  if (node.dataset.jfAct) return `[data-jf-act="${node.dataset.jfAct}"][data-joint="${node.dataset.joint}"]`;
  if (node.closest('[data-joint-card]')) return `[data-joint-card="${node.closest('[data-joint-card]').dataset.jointCard}"] summary`;
  return null;
}

function renderJointAdd(part, touching) {
  const kind = $('joint-kind');
  if (!kind.options.length) fillSelect(kind, JOINT_KINDS);
  const other = $('joint-other');
  const chosen = other.value;
  const joined = new Set(jointsOn(part.id).map((joint) => (joint.part === part.id ? joint.to : joint.part)));
  other.replaceChildren(
    ...touching.map((piece) => {
      const option = new Option(joined.has(piece.id) ? `${piece.name || 'Unnamed'} (already joined)` : piece.name || 'Unnamed', piece.id);
      option.disabled = joined.has(piece.id);
      return option;
    }),
  );
  const free = touching.find((piece) => piece.id === chosen && !joined.has(piece.id)) ?? touching.find((piece) => !joined.has(piece.id));
  if (free) other.value = free.id;
  const result = free ? joinParts(project, kind.value, part.id, free.id) : { error: 'Every piece it touches is already joined to it.' };
  $('joint-add-note').textContent = result.error ?? (kind.value === 'hinge' ? `${part.name || 'This piece'} will swing on ${free.name || 'it'}.` : '');
  $('joint-add-ok').disabled = Boolean(result.error);
}

function setAddingJoint(on) {
  addingJoint = on;
  renderEditor();
  if (on) $('joint-kind').focus();
  else $('joint-add-open').focus();
}

$('joint-add-open').addEventListener('click', () => setAddingJoint(!addingJoint));
$('joint-add-cancel').addEventListener('click', () => setAddingJoint(false));
for (const id of ['joint-kind', 'joint-other']) $(id).addEventListener('change', () => renderEditor());
$('joint-add-ok').addEventListener('click', () => {
  const part = selectedPart();
  if (!part) return;
  const result = joinParts(project, $('joint-kind').value, part.id, $('joint-other').value);
  if (result.error) {
    $('joint-add-note').textContent = result.error;
    return;
  }
  addingJoint = false;
  openJointId = result.joint.id;
  commit(result.project);
  $('joint-add-open').focus();
});

function jointNote(control) {
  return control.closest('[data-joint-card]')?.querySelector('.joint-error') ?? null;
}

function showJointError(control, message) {
  const note = jointNote(control);
  if (!note) return;
  if (message) {
    control.dataset.error = message;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', note.id);
  } else {
    delete control.dataset.error;
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
  const card = control.closest('[data-joint-card]');
  const messages = [...card.querySelectorAll('[data-error]')].map((each) => each.dataset.error);
  note.textContent = [...new Set(messages)].join(' ');
}

function refusalMessage(reason, control) {
  if (reason === 'locked' || reason === 'apart') return JOINT_ERRORS[reason];
  if (control.dataset.jf === 'open') return JOINT_ERRORS.open;
  return JOINT_ERRORS[control.dataset.check] ?? JOINT_ERRORS.mm;
}

$('joints').addEventListener('input', (event) => {
  const control = event.target;
  const { jf: field, joint: jointId } = control.dataset;
  if (!field || !jointId) return;
  const raw = control.type === 'checkbox' ? control.checked : control.value;
  const result = changeJoint(project, jointId, field, raw);
  const typed = control.type === 'number' || control.type === 'range';
  if (result.refused) {
    const message = refusalMessage(result.refused, control);
    if (typed) {
      showJointError(control, message);
      return;
    }
    renderEditor();
    jointNote(control).textContent = message;
    return;
  }
  showJointError(control, null);
  commit(result.project, typed ? `${jointId}:${field}` : null);
});

$('joints').addEventListener('click', keepingFocus((event) => {
  const button = event.target.closest('[data-jf-act]');
  if (!button) return;
  const joint = jointById(project, button.dataset.joint);
  if (!joint) return;
  const act = button.dataset.jfAct;
  if (act === 'remove') {
    const removal = jointRemoval(project, joint.id);
    if (removal.refused) {
      jointNote(button).textContent = lockedMoveMessage(removal.piece);
      return;
    }
    commit(removal.project);
    $('joint-add-open').hidden ? $('editor').querySelector('[name="name"]').focus() : $('joint-add-open').focus();
    return;
  }
  if (act === 'suggest') {
    const result = suggestSizes(project, joint.id);
    if (result.refused) {
      jointNote(button).textContent = JOINT_ERRORS[result.refused];
      return;
    }
    commit(result.project);
    if (!usable(button)) button.closest('[data-joint-card]')?.querySelector('summary').focus();
    return;
  }
  const next = updateJoint(project, joint.id, 'open', act === 'close' ? 0 : joint.opensTo);
  if (next) commit(next);
}));

const HARDWARE_LABELS = [...document.querySelectorAll('.hardware-list thead th')].map((th) => th.textContent);
const USED_ON_SHOWN = 2;

function renderHardware() {
  const rows = hardwareList(project);
  $('hardware-rows').replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      const more = row.usedOn.length - USED_ON_SHOWN;
      const usedOn = row.usedOn.slice(0, USED_ON_SHOWN).join(', ') + (more > 0 ? ` +${more} more` : '');
      const cells = [
        [row.count === null ? '–' : `${row.count} ×`, 'num'],
        [row.item],
        [row.size ? row.size.map(mm).join(' × ') : '–'],
        [usedOn],
      ];
      cells.forEach(([text, className], i) => {
        const td = element('td', className, text);
        td.setAttribute('role', 'cell');
        td.dataset.label = HARDWARE_LABELS[i];
        tr.append(td);
      });
      return tr;
    }),
  );
  $('hardware-empty').hidden = rows.length > 0;
  document.querySelector('.hardware-list').hidden = rows.length === 0;
}

const debug = createDebugPanel($('debug'), view);

function timed(work) {
  return (...args) => {
    const started = performance.now();
    try {
      return work(...args);
    } finally {
      debug.addAppTime(performance.now() - started);
    }
  };
}

const render = timed(renderAll);

function renderAll() {
  if (document.activeElement !== $('project-name')) $('project-name').value = project.name;
  document.title = `${project.name} · Woodworking planner`;
  view.setParts(project.parts, sceneExtras());
  view.setSelected(selectedId);
  renderParts();
  renderEditor();
  renderSelectionChip();
  renderCutList();
  renderHardware();
  renderButtons();
  describeView();
}

function renderButtons() {
  $('undo').disabled = undoStack.length === 0;
  $('redo').disabled = redoStack.length === 0;
  $('duplicate').disabled = !selectedId;
  const locked = Boolean(selectedPart()?.locked);
  $('delete').disabled = !selectedId;
  offWithReason($('delete'), selectedId && deleteRefusal(selectedId));
  for (const note of [$('editor-note'), $('parts-note')]) note.textContent = '';
  const pinned = Boolean(selectedId) && assemblyPinned(selectedId);
  for (const button of document.querySelectorAll('.move-tools [data-mode]')) button.disabled = !selectedId;
  for (const button of document.querySelectorAll('.move-tools [data-rotate]')) button.disabled = !selectedId || locked || pinned;
  const swings = Boolean(selectedId) && dragMode(project, selectedId) === 'swing';
  $('view-hint').textContent = swings ? SWING_HINT : MOVE_HINT;
}

const MOVE_HINT = document.querySelector('.view-hint').textContent;
const SWING_HINT = 'Drag the picked piece to swing it on its hinge · drag the piece it hangs on to move both · drag elsewhere to turn the view';

function sceneExtras() {
  const hinge = selectedId && swingingHinge(project, selectedId);
  return {
    placements: placements(project),
    hardware: hardwarePieces(project),
    hingeLine: hinge ? hingeAxis(project, hinge.id) : null,
  };
}

function placeView() {
  view.place(project.parts, sceneExtras());
}

function fillSelect(select, options) {
  select.replaceChildren(...Object.entries(options).map(([value, label]) => new Option(label, value)));
}
fillSelect($('field-species'), Object.fromEntries(Object.entries(SPECIES).map(([key, { label }]) => [key, label])));
fillSelect($('field-pose'), LIES);

$('editor').addEventListener('input', (event) => {
  const input = event.target;
  const part = selectedPart();
  if (!part || !input.name) return;
  if (input.type === 'radio' && !input.checked) return;
  const typed = input.tagName === 'INPUT' && input.type !== 'radio' && input.type !== 'checkbox';
  const next = updatePart(part, input.name, input.type === 'checkbox' ? input.checked : input.value);
  if (!next && typed) {
    showFieldError(input, fieldError(part, input));
    return;
  }
  const pending = pendingFields(input);
  if (next && ['x', 'y', 'z'].includes(input.name)) {
    const moved = moveAssembly(project, part.id, { [input.name]: next[input.name] });
    if (moved === project && next[input.name] !== part[input.name]) {
      showFieldError(input, `That would move a piece joined to it past ±${mm(MAX_SIZE_MM)} mm.`);
      return;
    }
    showFieldError(input, null);
    if (moved !== project) commit(moved, `${part.id}:${input.name}`);
  } else if (next) {
    const result = replacePart(next, typed ? input.name : null);
    if (result.refused) {
      refusePartEdit(input, lockedMoveMessage(result.piece), typed);
      return;
    }
    showFieldError(input, null);
  } else {
    renderEditor();
  }
  recheckPendingFields(pending);
});
$('editor').addEventListener('submit', (event) => event.preventDefault());

function refusePartEdit(input, message, typed) {
  if (!typed) renderEditor();
  if ($(`${input.name}-error`)) showFieldError(input, message);
  else $('editor-note').textContent = message;
}

$('project-name').addEventListener('change', (event) => {
  const name = event.target.value.trim().slice(0, 80) || 'Untitled project';
  if (name !== project.name) commit({ ...project, name });
});

$('add').addEventListener('click', () => addPart());
$('add-phone').addEventListener('click', () => {
  addPart();
  showTab('edit');
});

function addMenu(toggle, menu, pick) {
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const open = (index) => {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    items().at(index)?.focus();
  };
  const close = (returnFocus) => {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => (menu.hidden ? open(0) : close(true)));
  toggle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    open(event.key === 'ArrowUp' ? -1 : 0);
  });
  menu.addEventListener('keydown', (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      event.stopPropagation();
      list[(moves[event.key] + list.length) % list.length].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  });
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-add-shape]');
    if (!item) return;
    close(true);
    pick(item.dataset.addShape);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!toggle.parentElement.contains(event.target)) close(false);
  });
}
addMenu($('add-more'), $('add-menu'), (shape) => addPart(shape));
addMenu($('add-more-phone'), $('add-menu-phone'), (shape) => {
  addPart(shape);
  showTab('edit');
});

function showTab(name) {
  $('main').dataset.tab = name;
  for (const tab of document.querySelectorAll('.tabs [data-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
}
for (const tab of document.querySelectorAll('.tabs [data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

document.addEventListener('focusin', (event) => {
  if (!event.target.closest('.parts, .inspector, .cut') || !document.querySelector('.add-bar').getBoundingClientRect().height) return;
  const page = getComputedStyle(document.documentElement);
  const box = event.target.getBoundingClientRect();
  if (box.top < parseFloat(page.scrollPaddingTop) || box.bottom > innerHeight - parseFloat(page.scrollPaddingBottom)) {
    event.target.scrollIntoView({ block: 'nearest' });
  }
});

for (const button of document.querySelectorAll('.view-tools [data-view]')) {
  button.addEventListener('click', () => {
    view.look(button.dataset.view);
    for (const other of document.querySelectorAll('.view-tools [data-view]')) other.setAttribute('aria-pressed', String(other === button));
  });
}

function setMenu(open) {
  $('bar').classList.toggle('menu-open', open);
  $('menu-toggle').setAttribute('aria-expanded', String(open));
}
$('menu-toggle').addEventListener('click', () => setMenu(!$('bar').classList.contains('menu-open')));
$('bar-actions').addEventListener('click', (event) => {
  if (!event.target.closest('button')) return;
  const wasOpen = $('bar').classList.contains('menu-open');
  setMenu(false);
  if (wasOpen && usable($('menu-toggle'))) $('menu-toggle').focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#bar')) setMenu(false);
});
$('duplicate').addEventListener('click', duplicateSelected);
$('lock').addEventListener('click', toggleLock);
$('delete').addEventListener('click', () => deleteSelected($('delete')));
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('fit').addEventListener('click', () => view.fit());
$('save-file').addEventListener('click', () => download(project));
$('open-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  try {
    commit(await readFile(file));
    view.fit();
    $('file-error').hidden = true;
  } catch (error) {
    $('file-error').textContent = error.message;
    $('file-error').hidden = false;
  }
});
$('new-project').addEventListener('click', () => {
  commit({ name: 'Untitled project', parts: [], joints: [] });
  view.fit();
  $('file-error').hidden = true;
});
$('starter').addEventListener('click', () => {
  commit(starterProject());
  view.fit();
  $('file-error').hidden = true;
});

const ROTATE_KEYS = { r: 'y', t: 'x', l: 'z' };

$('snap').addEventListener('click', () => setSnap(!snapOn));
$('mode-floor').addEventListener('click', () => setLift(false));
$('mode-height').addEventListener('click', () => setLift(true));
for (const button of document.querySelectorAll('.move-tools [data-rotate]')) {
  button.addEventListener('click', () => rotateSelected(button.dataset.rotate));
}
setSnap(snapOn);
setLift(false);

function setDebug(on) {
  saveDebug(on);
  debug.show(on);
  $('debug-toggle').setAttribute('aria-pressed', String(on));
}
$('debug-toggle').addEventListener('click', () => setDebug($('debug-toggle').getAttribute('aria-pressed') !== 'true'));
setDebug(loadDebug());

function setPotato(on) {
  savePotato(on);
  view.setPotato(on);
  $('potato-toggle').setAttribute('aria-pressed', String(on));
}
$('potato-toggle').addEventListener('click', () => setPotato($('potato-toggle').getAttribute('aria-pressed') !== 'true'));

const ARROWS = {
  ArrowLeft: () => ['x', -1],
  ArrowRight: () => ['x', 1],
  ArrowUp: (alt) => (alt ? ['z', -1] : ['y', 1]),
  ArrowDown: (alt) => (alt ? ['z', 1] : ['y', -1]),
};

const onBoardKeys = (target) => Boolean(target.closest('.view, #parts'));

document.addEventListener('keydown', (event) => {
  const typing = event.target.closest('textarea, input:not([type="radio"], [type="checkbox"])');
  const inField = event.target.closest('input, select, textarea');
  if (event.key in ARROWS && selectedId && !event.ctrlKey && !event.metaKey && !inField) {
    event.preventDefault();
    const [axis, sign] = ARROWS[event.key](event.altKey);
    nudge(axis, sign * (event.shiftKey ? FINE_NUDGE_MM : NUDGE_MM));
    return;
  }
  const rotateAxis = ROTATE_KEYS[event.key.toLowerCase()];
  if (rotateAxis && selectedId && onBoardKeys(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    rotateSelected(rotateAxis);
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (mod && event.key.toLowerCase() === 'y' && !typing) {
    event.preventDefault();
    redo();
  } else if (event.key === 'Escape' && selectedId) {
    select(null);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && !inField && selectedId) {
    event.preventDefault();
    deleteSelected(event.target);
  }
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => view.setTheme(darkQuery.matches);
darkQuery.addEventListener('change', applyTheme);
applyTheme();

view.canvas.tabIndex = 0;
view.canvas.setAttribute('role', 'application');
view.canvas.setAttribute('aria-roledescription', '3D view');
render();
setPotato(loadPotato());
if (saved.error) showUnreadableSave(saved.error, saved.kept);
else persist();

function showUnreadableSave(reason, kept) {
  const copy = kept
    ? 'A copy of it is kept in this browser, and the example bookshelf is shown instead.'
    : 'A copy of it could not be kept in this browser, so it may be replaced when you change the project. The example bookshelf is shown instead.';
  $('save-state').textContent = 'Saved project could not be opened';
  $('save-state').classList.add('failed');
  $('file-error').textContent = `The project saved in this browser could not be opened. ${reason} ${copy}`;
  $('file-error').hidden = false;
}
window.woodworkingPlanner = { get project() { return project; }, select, framesDrawn: () => view.framesDrawn() };

if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Working offline is not available:', error));
}
