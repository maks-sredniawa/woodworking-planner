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
  movePart,
  newPartBeside,
  outline,
  overlaps,
  projectBounds,
  rotatePart,
  snapPosition,
  starterProject,
  totals,
  updatePart,
} from './model.js';
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

function showDragModes(lifting, snapping) {
  $('mode-floor').setAttribute('aria-pressed', String(!lifting));
  $('mode-height').setAttribute('aria-pressed', String(lifting));
  $('snap').setAttribute('aria-pressed', String(snapping));
}

const view = createScene($('viewport'), { onSelect: (id) => select(id), onDrag: (event) => handleDrag(event) });

const handleDrag = timed(({ phase, id, delta, vertical, invertSnap }) => {
  if (phase === 'start') {
    dragStart = { project, part: project.parts.find((part) => part.id === id) };
    showDragModes(vertical, snapOn !== invertSnap);
    return;
  }
  if (!dragStart) return;
  if (phase === 'rebase') {
    dragStart.part = selectedPart();
    return;
  }
  if (phase === 'move') {
    showDragModes(vertical, snapOn !== invertSnap);
    const from = dragStart.part;
    const proposed = Object.fromEntries(Object.entries(delta).map(([axis, change]) => [axis, from[axis] + change]));
    const current = selectedPart();
    const next = movePart(current, snapPosition(from, proposed, project.parts, { snap: snapOn !== invertSnap }));
    if (next === current || ['x', 'y', 'z'].every((axis) => next[axis] === current[axis])) return;
    project = { ...project, parts: project.parts.map((part) => (part.id === id ? next : part)) };
    view.moveBoard(next);
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
  const turned = rotatePart(part, axis);
  if (turned === part) return;
  commit({ ...project, parts: project.parts.map((each) => (each.id === part.id ? turned : each)) });
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
  const next = movePart(part, { [axis]: part[axis] + amount });
  if (next !== part) replacePart(next, 'nudge');
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
  selectedId = id;
  view.setSelected(id);
  renderParts();
  renderEditor();
  renderSelectionChip();
  renderButtons();
  if (id) $(`part-${id}`)?.scrollIntoView({ block: 'nearest' });
});

const usable = (node) => Boolean(node?.isConnected && !node.disabled && node.checkVisibility());
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

function replacePart(next, field) {
  commit({ ...project, parts: project.parts.map((part) => (part.id === next.id ? next : part)) }, `${next.id}:${field}`);
}

function addPart(shape = 'board') {
  const part = newPartBeside(project.parts, shape);
  commit({ ...project, parts: [...project.parts, part] });
  select(part.id);
}

function duplicateSelected() {
  const part = selectedPart();
  if (!part) return;
  const copy = duplicatePart(part);
  if (copy === part) return;
  const index = project.parts.indexOf(part);
  commit({ ...project, parts: [...project.parts.slice(0, index + 1), copy, ...project.parts.slice(index + 1)] });
  select(copy.id);
}

const deleteSelected = keepingFocus(() => {
  if (!selectedId || selectedPart()?.locked) return;
  commit({ ...project, parts: project.parts.filter((part) => part.id !== selectedId) });
  select(null);
});

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

function renderParts() {
  const clashing = new Set(overlaps(project.parts).flat());
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
      if (part.locked) main.append(element('span', 'tag', '🔒 Locked'));
      if (clashing.has(part.id)) main.append(element('span', 'warn', 'Overlaps another piece'));
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
        remove.addEventListener('click', deleteSelected);
        remove.disabled = part.locked;
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
  chip.replaceChildren(...(part.locked ? ['🔒 '] : []), element('b', '', part.name || 'Unnamed'), ` · ${sizeText(part)}`);
}

function describeView() {
  const box = projectBounds(project.parts);
  const count = countText(project.parts);
  const size = box ? `, ${mm(box.max.x - box.min.x)} wide × ${mm(box.max.y - box.min.y)} high × ${mm(box.max.z - box.min.z)} deep (mm)` : '';
  const part = selectedPart();
  const picked = part ? `. Picked: ${part.name || 'Unnamed'}, ${sizeText(part)}` : '';
  view.canvas.setAttribute('aria-label', `3D view of ${project.name}: ${count}${size}${picked}`);
}

function renderEditor() {
  const part = selectedPart();
  const form = $('editor');
  form.hidden = !part;
  $('editor-empty').hidden = Boolean(part);
  if (!part) return;
  showPose(part.pose);
  for (const input of form.querySelectorAll('[name]')) {
    if (input.type === 'radio') {
      input.checked = part[input.name] === input.value;
      continue;
    }
    if (input.type === 'checkbox') {
      input.checked = Boolean(part[input.name]);
      continue;
    }
    if (document.activeElement === input && input.dataset.partId === part.id) continue;
    input.value = String(part[input.name]);
    input.dataset.partId = part.id;
    showFieldError(input, null);
  }
  for (const input of form.querySelectorAll('[data-geometry]')) input.disabled = part.locked;
  $('lock').setAttribute('aria-pressed', String(part.locked));
  $('lock').textContent = part.locked ? '🔒 Locked · unlock' : 'Lock in place';
  $('locked-note').hidden = !part.locked;
  $('wood-swatch').style.background = SPECIES[part.species].color;
  renderShapeFields(part);
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
  view.setParts(project.parts);
  view.setSelected(selectedId);
  renderParts();
  renderEditor();
  renderSelectionChip();
  renderCutList();
  renderButtons();
  describeView();
}

function renderButtons() {
  $('undo').disabled = undoStack.length === 0;
  $('redo').disabled = redoStack.length === 0;
  $('duplicate').disabled = !selectedId;
  const locked = Boolean(selectedPart()?.locked);
  $('delete').disabled = !selectedId || locked;
  for (const button of document.querySelectorAll('.move-tools [data-mode]')) button.disabled = !selectedId;
  for (const button of document.querySelectorAll('.move-tools [data-rotate]')) button.disabled = !selectedId || locked;
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
  const choice = input.type === 'radio' || input.type === 'checkbox';
  const next = updatePart(part, input.name, input.type === 'checkbox' ? input.checked : input.value);
  if (!next) {
    if (choice) renderEditor();
    else showFieldError(input, FIELD_ERRORS[input.name]?.(part, Number(input.value)) ?? 'This value is not allowed.');
    return;
  }
  showFieldError(input, null);
  replacePart(next, input.name);
});
$('editor').addEventListener('submit', (event) => event.preventDefault());

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
$('delete').addEventListener('click', deleteSelected);
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
  commit({ name: 'Untitled project', parts: [] });
  view.fit();
});
$('starter').addEventListener('click', () => {
  commit(starterProject());
  view.fit();
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
    deleteSelected();
  }
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => view.setTheme(darkQuery.matches);
darkQuery.addEventListener('change', applyTheme);
applyTheme();

view.canvas.tabIndex = 0;
view.canvas.setAttribute('role', 'img');
render();
setPotato(loadPotato());
if (saved.error) showUnreadableSave(saved.error);
else persist();

function showUnreadableSave(reason) {
  $('save-state').textContent = 'Saved project could not be opened';
  $('save-state').classList.add('failed');
  $('file-error').textContent = `The project saved in this browser could not be opened. ${reason} A copy of it is kept in this browser, and the example bookshelf is shown instead.`;
  $('file-error').hidden = false;
}
window.woodworkingPlanner = { get project() { return project; }, select, framesDrawn: () => view.framesDrawn() };
