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
  cutSize,
  describePose,
  freeSwitchProblem,
  poseHalfTurn,
  duplicatePart,
  newPartBeside,
  outline,
  projectBounds,
  stretchProblem,
  totals,
  updatePart,
} from './model.js';
import {
  EDGES,
  FACES,
  HINGE_TYPES,
  JOINT_GROUPS,
  JOINT_KINDS,
  changeJoint,
  changePart,
  changePosition,
  assemblyOverlaps,
  cutAllowances,
  cutJoint,
  dragMode,
  hardwareList,
  hardwarePieces,
  hingeAxis,
  hingeEdges,
  joinParts,
  joinedTo,
  joineryXray,
  jointFace,
  jointFaces,
  jointProblem,
  jointRemoval,
  moveAssembly,
  partRemoval,
  placements,
  removePart,
  rotateAssembly,
  snapAssembly,
  suggestedSizes,
  suggestSizes,
  swingStop,
  swingingHinge,
  touchingParts,
  updateJoint,
} from './joints.js';
import { starterProject } from './project.js';
import { cuttingOf, misfitIds, projectPieces } from './cutplan.js';
import { createPlanView } from './planview.js';
import { createScene } from './scene.js';
import {
  approx,
  ceilLen,
  dims,
  fieldText,
  floorLen,
  GAUGE_ERROR,
  area,
  gaugeOf,
  gaugeText,
  inInches,
  isRounded,
  len,
  lenUnit,
  lengthField,
  nailSize,
  num,
  parseGauge,
  parseLength,
  screwSize,
  setUnits,
  unitName,
  units,
  volume,
  weight,
} from './format.js';
import {
  download,
  loadCutView,
  loadDebug,
  loadPotato,
  loadSaved,
  loadSnap,
  loadUnits,
  readFile,
  save,
  saveCutView,
  saveDebug,
  savePotato,
  saveSnap,
  saveUnits,
} from './storage.js';
import { createDebugPanel } from './debug.js';
import { createOutlineEditor } from './outline-editor.js';

const isLengthField = (input) => Boolean(input?.dataset && ('length' in input.dataset || 'gauge' in input.dataset));
const typing = (input) => !('final' in input.dataset);
const mmOnly = (input) => 'mmOnly' in input.dataset;

function readField(input, text = input.value) {
  if ('gauge' in input.dataset) return parseGauge(text, { typing: typing(input) });
  return parseLength(text, { unit: mmOnly(input) ? 'mm' : units().id, typing: typing(input), fixed: mmOnly(input) });
}

const lengthRaw = (read) => (read.empty ? '' : read.mm);

function shownValue(input, value) {
  if (!isLengthField(input)) return String(value);
  if ('gauge' in input.dataset) return gaugeText(value);
  return fieldText(value, mmOnly(input) ? 'mm' : units().id);
}

const HISTORY_LIMIT = 100;
const TYPING_MERGE_MS = 1200;
const $ = (id) => document.getElementById(id);

const saved = loadSaved();
let project = saved.project ?? starterProject();
let selectedId = null;
const undoStack = [];
const redoStack = [];
let lastEdit = null;

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

function swingTo(angle, limit, snapping, stop = null) {
  const most = stop === null ? limit : Math.min(limit, stop);
  const clamp = (value) => Math.min(most, Math.max(0, value));
  if (!snapping) return Math.round(clamp(angle) * 10) / 10;
  const caught = [0, 90, limit, stop].find((each) => each !== null && each <= most && Math.abs(angle - each) <= SWING_CATCH_DEG);
  return clamp(caught ?? Math.round(angle / SWING_STEP_DEG) * SWING_STEP_DEG);
}

const jointById = (state, id) => (state.joints ?? []).find((joint) => joint.id === id);

function swingDrag(swing, invertSnap) {
  const start = jointById(dragStart.project, dragStart.hinge.id);
  const angle = swingTo(start.open + swing, start.opensTo, snapOn !== invertSnap, dragStart.stop?.angle ?? null);
  if (angle === jointById(project, start.id).open) return;
  const next = updateJoint(dragStart.project, start.id, 'open', angle);
  if (!next) return;
  project = next;
  placeView();
  renderEditor();
  renderSelectionChip();
}

const handleDrag = timed(({ phase, id, delta, vertical, invertSnap, swing }) => {
  if (phase === 'start') {
    const hinge = swingingHinge(project, id);
    dragStart = { project, base: project, part: project.parts.find((part) => part.id === id), hinge, stop: hinge && swingStop(project, hinge.id) };
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
    const target = snapAssembly(dragStart.base, id, proposed, { snap: snapOn !== invertSnap, grid: units().snap, fine: units().fine });
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
  renderPlan();
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
  const part = newPartBeside(project.parts, shape, { gap: units().gap, inches: inInches() });
  commit({ ...project, parts: [...project.parts, part] });
  select(part.id);
}

function duplicateSelected() {
  const part = selectedPart();
  if (!part) return;
  const copy = duplicatePart(part, project.parts, units().gap);
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

const pendingAnnouncements = new WeakMap();

function announce(note, message) {
  cancelAnimationFrame(pendingAnnouncements.get(note));
  note.textContent = '';
  if (message) pendingAnnouncements.set(note, requestAnimationFrame(() => (note.textContent = message)));
}

function showDeleteRefusal(message, origin) {
  const notes = [$('editor-note'), $('parts-note')];
  if (origin?.closest('#parts')) notes.reverse();
  const shown = notes.find(visible) ?? notes[0];
  for (const note of notes) announce(note, note === shown ? message : '');
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

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const trio = (part) => [part.length, part.width, part.thickness];

const blankSizes = (part, size) => (part.shape === 'dowel' ? [size.width, size.length] : trio(size));

function blankText(part, size = blank(part)) {
  return dims(blankSizes(part, size), part.shape === 'dowel' ? '⌀' : '');
}

function cornerSizes(part) {
  const count = cornerCount(part);
  if (!count) return { values: [], text: '' };
  if (part.corners === 'rounded') return { values: [part.cornerRadius], text: ` · R${len(part.cornerRadius)} ×${count}` };
  return { values: [part.cutLength, part.cutWidth], text: ` · cut ${len(part.cutLength)} × ${len(part.cutWidth)} ×${count}` };
}

const chain = (values) => values.map(len).join(' × ');

function sizeText(part) {
  if (part.shape === 'disc') return dims([part.diameter, part.thickness], '⌀');
  if (part.shape === 'dowel') return `${dims([part.dowelDiameter, part.length], '⌀')} dowel`;
  if (part.shape === 'arc') {
    const { outerRadius, bandWidth, thickness } = part;
    return `Arc ${approx([outerRadius, bandWidth, thickness])}R${len(outerRadius)} × ${len(bandWidth)} × ${num(part.sweep)}° × ${len(thickness)}`;
  }
  if (part.shape === 'triangle') return `Triangle ${dims(trio(part))}`;
  if (part.shape === 'free') return `Free ${dims(trio(part))}`;
  const corners = cornerSizes(part);
  return `${approx([...trio(part), ...corners.values])}${chain(trio(part))}${corners.text}`;
}

function shapeNote(part) {
  if (part.shape === 'disc') return `Disc ⌀${len(part.diameter)}`;
  if (part.shape === 'dowel') return 'Dowel rod';
  if (part.shape === 'arc') return `Arc R${len(part.outerRadius)} × ${len(part.bandWidth)} × ${num(part.sweep)}°`;
  if (part.shape === 'triangle') return `Triangle ${len(part.length)} × ${len(part.width)}`;
  if (part.shape === 'free') return `Free shape, ${part.points.length} points`;
  const count = cornerCount(part);
  if (!count) return null;
  const corners = count === 1 ? 'corner' : 'corners';
  const layout = cornerLayout(part) ? ` (${cornerLayout(part)})` : '';
  if (part.corners === 'rounded') return `R${len(part.cornerRadius)} ×${count} ${corners}${layout}`;
  return `${count} ${corners} cut ${len(part.cutLength)} × ${len(part.cutWidth)}${layout}`;
}

const SHAPE_PLURALS = { board: 'boards', disc: 'discs', dowel: 'dowels', arc: 'arcs', triangle: 'triangles', free: 'free shapes' };
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
  if (hinge?.part === part.id) return `Swings on ${partName(hinge.to)}${hinge.open ? ` · open ${num(hinge.open)}°` : ''}`;
  const partners = new Set(joints.map((joint) => (joint.part === part.id ? joint.to : joint.part)));
  return partners.size === 1 ? `Joined to ${partName([...partners][0])}` : `Joined to ${partners.size} pieces`;
}

const CUT_WARNINGS = { dado: 'Dado too deep', tenon: 'Tenon too big', dowels: 'Dowels too big' };

function jointWarnings(part) {
  const words = new Set();
  for (const joint of jointsOn(part.id)) {
    const problem = jointProblem(project, joint.id);
    if (!problem) continue;
    if (joint.kind === 'hinge' && /, past .* at \d+°/.test(problem)) words.add('Open past a piece in its way');
    else if (joint.kind === 'hinge') words.add(/thick/.test(problem) ? 'Too thin for concealed hinges' : 'Hinge can’t swing');
    else if (/no longer touches/.test(problem)) words.add('Joint no longer touches');
    else if (/^Only a board/.test(problem)) words.add('Not a board');
    else if (/no longer meets|no longer offers a face/.test(problem)) words.add('Joint no longer fits');
    else if (joint.kind in CUT_WARNINGS) words.add(CUT_WARNINGS[joint.kind]);
    else if (/wider than the face/.test(problem)) words.add('Plate too wide');
    else if (/flat face|in line|face to face/.test(problem)) words.add('Joint doesn’t suit how the pieces meet');
    else words.add('Fixing too long');
  }
  return [...words];
}

function renderParts() {
  const clashing = new Set(assemblyOverlaps(project).flat());
  const misfits = misfitIds(projectPieces(project), cuttingOf(project));
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
      const warnings = [clashing.has(part.id) && 'Overlaps another piece', ...jointWarnings(part), misfits.has(part.id) && 'Doesn’t fit its stock'].filter(Boolean);
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
  const stop = open === null ? null : restingStop(swingingHinge(project, part.id));
  chip.replaceChildren(
    ...(part.locked ? ['🔒 '] : []),
    element('b', '', part.name || 'Unnamed'),
    ` · ${open === null ? sizeText(part) : open ? `open ${num(open)}°` : 'closed'}${stop ? ` · stopped by ${partName(stop.by)}` : ''}`,
  );
}

function describeView() {
  const box = projectBounds(project.parts);
  const count = countText(project.parts);
  const size = box ? `, ${overallText(box)}` : '';
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
    input.value = shownValue(input, part[input.name]);
    input.dataset.partId = part.id;
    showFieldError(input, null);
  }
  for (const input of form.querySelectorAll('[data-geometry]')) input.disabled = part.locked;
  if (assemblyPinned(part.id)) for (const name of ['x', 'y', 'z', 'pose']) form.querySelector(`[name="${name}"]`).disabled = true;
  $('lock').setAttribute('aria-pressed', String(part.locked));
  $('lock').textContent = part.locked ? '🔒 Locked · unlock' : 'Lock in place';
  $('locked-note').hidden = !part.locked;
  $('wood-swatch').style.background = SPECIES[part.species].color;
  $('grain-box').hidden = part.shape === 'dowel';
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
  free: ['length', 'width', 'thickness'],
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
  $('arc-inner').textContent = `Inner radius ${lenUnit(part.outerRadius - part.bandWidth)} (outer radius less the band width).`;
  const allowance = cutAllowances(project).get(part.id);
  const extras = allowance ? [includesText(allowance, true), allowance.cuts].filter(Boolean) : [];
  $('cut-from').textContent = [`Cut from ${blankText(part, cutSize(part, allowance))}${part.shape === 'dowel' ? ' dowel rod' : ''}`, ...extras].join(' · ');
  $('corners-box').hidden = part.shape !== 'board';
  $('free-box').hidden = part.shape !== 'free';
  if (part.shape === 'free') showFreePreview(part);
  $('corner-pick').hidden = part.corners === 'square';
  $('radius-field').hidden = part.corners !== 'rounded';
  $('cut-fields').hidden = part.corners !== 'cut';
  $('corner-shape').setAttribute('viewBox', `0 0 ${PREVIEW.width} ${PREVIEW.height}`);
  $('corner-shape').querySelector('path').setAttribute('d', cornerPreview(part));
}

const outlineLockedMessage = (part) => `${part.name || 'Unnamed'} is locked. Unlock it first to change its outline.`;

function showFreePreview(part) {
  const { points } = outline(part);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => -y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const preview = $('free-preview');
  preview.setAttribute('viewBox', `${left} ${top} ${Math.max(...xs) - left} ${Math.max(...ys) - top}`);
  const path = preview.querySelector('path');
  path.setAttribute('d', `M${points.map(([x, y]) => `${x.toFixed(1)} ${(-y).toFixed(1)}`).join('L')}Z`);
  path.setAttribute('fill', SPECIES[part.species].color);
  offWithReason($('edit-outline'), part.locked ? outlineLockedMessage(part) : null);
}

const outlineEditor = createOutlineEditor({
  maxSize: MAX_SIZE_MM,
  announce,
  offWithReason,
  snap: { get: () => snapOn, set: (on) => setSnap(on) },
  onDone: (points) => {
    const part = selectedPart();
    const next = part && updatePart(part, 'points', points);
    if (!next) return part?.locked ? outlineLockedMessage(part) : 'This outline can’t be used. Check its points.';
    const result = replacePart(next);
    return result.refused ? lockedMoveMessage(result.piece) : null;
  },
});

function editOutline(returnFocus) {
  const part = selectedPart();
  if (!part || part.shape !== 'free') return;
  if (part.locked) {
    announce($('editor-note'), outlineLockedMessage(part));
    return;
  }
  outlineEditor.open({ name: part.name, color: SPECIES[part.species].color, points: part.points, returnFocus });
}

$('edit-outline').addEventListener('click', () => editOutline(() => $('edit-outline')));

function includesText({ lengthItems, widthItems }, short = false) {
  if (short && lengthItems && !widthItems) return `includes ${lengthItems}`;
  const sentences = [lengthItems && `Length includes ${lengthItems}`, widthItems && `Width includes ${widthItems}`].filter(Boolean);
  return short ? sentences.map((each) => each[0].toLowerCase() + each.slice(1)).join(' · ') : sentences.join(' · ');
}

const measured = ({ value, unit }) => `${value} ${unit}`;
const headings = (table) => [...document.querySelectorAll(`${table} thead th`)].map((th) => th.textContent);

function renderCutList() {
  const allowances = cutAllowances(project);
  const labels = headings('.cut-list:not(.hardware-list)');
  const rows = cutList(project.parts, allowances);
  rounded.list = rows.some((row) => blankSizes(row.piece, row).some(isRounded));
  $('cut-rows').replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      const cubic = (row.count * row.volume) / 1e9;
      const face = (row.count * row.area) / 1e6;
      const cells = [
        [`${row.count} ×`, 'num'],
        [blankText(row.piece, row)],
        [row.names.join(', ')],
        [SPECIES[row.species].label],
        [measured(volume(cubic)), 'num'],
        [measured(area(face)), 'num'],
      ];
      cells.forEach(([text, className], i) => {
        const td = element('td', className, text);
        td.setAttribute('role', 'cell');
        td.dataset.label = labels[i];
        tr.append(td);
      });
      const note = [shapeNote(row.piece), includesText(row), row.cuts].filter(Boolean).join(' · ');
      if (note) tr.children[1].append(element('span', 'shape-note', note));
      return tr;
    }),
  );
  const sum = totals(project.parts, allowances);
  const stat = (value, label) => {
    const span = element('span');
    span.append(element('b', '', value), ` ${label}`);
    return span;
  };
  $('totals').replaceChildren(
    stat(String(sum.count), pieceWord(project.parts)),
    stat(volume(sum.volume, true).value, `${volume(sum.volume, true).unit} volume`),
    stat(area(sum.area, true).value, `${area(sum.area, true).unit} face`),
    stat(weight(sum.weight).value, weight(sum.weight).unit),
  );
  const fixings = hardwareList(project).reduce((count, row) => count + (row.count ?? 0), 0);
  if (fixings) $('totals').append(stat(String(fixings), fixings === 1 ? 'hardware item' : 'hardware items'));
  const box = projectBounds(project.parts);
  $('overall').textContent = box ? `Overall ${approx(overallSizes(box))}${overallText(box)}` : '';
}

const rounded = { list: false, hardware: false };

function renderRoundedNote() {
  const box = projectBounds(project.parts);
  const inPane = cutView === 'plan' ? planView.rounded() : rounded.list || rounded.hardware;
  const note = $('rounded-note');
  note.hidden = !(inPane || (box && overallSizes(box).some(isRounded)));
  const unit = units();
  note.textContent = `≈ marks a size rounded to the nearest ${unit.den ? `1/${unit.den} in` : '0.1 mm'}.`;
}

const overallSizes = (box) => ['x', 'y', 'z'].map((axis) => box.max[axis] - box.min[axis]);

function overallText(box) {
  const [wide, high, deep] = overallSizes(box).map(len);
  return `${wide} wide × ${high} high × ${deep} deep (${unitName()})`;
}

const sizeError = () => `Enter a size above 0, up to ${floorLen(MAX_SIZE_MM)} ${unitName()}.`;
const positionError = () => `Enter a number from −${floorLen(MAX_SIZE_MM)} to ${floorLen(MAX_SIZE_MM)} ${unitName()}.`;
const half = (value) => floorLen(value / 2);
const CLOSE_TEXT = { mm: '1 mm', in: 'about 1/32 in' };
const together = () => CLOSE_TEXT[unitName()];

function cornersNeed(part, side) {
  if (!cornerCount(part)) return 0;
  if (part.corners === 'rounded') return 2 * part.cornerRadius;
  return 2 * (side === 'length' ? part.cutLength : part.cutWidth);
}

const FIELD_ERRORS = {
  length: (part, value) => sideError(part, 'length', value),
  width: (part, value) => sideError(part, 'width', value),
  thickness: () => sizeError(),
  diameter: () => `Enter a diameter above 0, up to ${floorLen(MAX_SIZE_MM)} ${unitName()}.`,
  dowelDiameter: () => `Enter a diameter above 0, up to ${floorLen(MAX_SIZE_MM)} ${unitName()}.`,
  outerRadius: (part, value) =>
    value > 0 && value <= part.bandWidth
      ? `Outer radius must be more than the band width (${lenUnit(part.bandWidth)}).`
      : `Enter an outer radius above 0, up to ${floorLen(MAX_RADIUS_MM)} ${unitName()}.`,
  bandWidth: (part, value) =>
    value >= part.outerRadius
      ? `Band width must be less than the outer radius (${lenUnit(part.outerRadius)}).`
      : `Enter a band width above 0, less than the outer radius (${lenUnit(part.outerRadius)}).`,
  sweep: () => 'Enter a sweep from 1° to 360°.',
  cornerRadius: (part) => {
    const side = part.width <= part.length ? 'width' : 'length';
    return `Enter a radius above 0, up to ${half(part[side])} ${unitName()} (half the ${side}).`;
  },
  cutLength: (part) => `Enter a cut above 0, up to ${half(part.length)} ${unitName()} (half the length).`,
  cutWidth: (part) => `Enter a cut above 0, up to ${half(part.width)} ${unitName()} (half the width).`,
  x: () => positionError(),
  y: () => positionError(),
  z: () => positionError(),
};

const STRETCH_ERRORS = {
  together: (side) => `Enter a bigger ${side}: at this one, points of the outline come within ${together()} of each other.`,
  flat: (side) => `Enter a bigger ${side}: at this one, the outline has no area.`,
  crossing: (side) => `At this ${side} the outline crosses itself. Enter another ${side} or change the outline.`,
  big: (side) => `At this ${side} the outline is over ${floorLen(MAX_SIZE_MM)} ${unitName()} across.`,
};

function sideError(part, side, value) {
  if (part.shape === 'free' && value > 0 && value <= MAX_SIZE_MM) {
    return STRETCH_ERRORS[stretchProblem(part, side, value)]?.(side) ?? `This ${side} can’t be used for this outline.`;
  }
  const need = cornersNeed(part, side);
  if (value > 0 && value <= MAX_SIZE_MM && value < need) {
    return `Enter at least ${ceilLen(need)} ${unitName()}: twice the corner ${part.corners === 'rounded' ? 'radius' : 'cut'}.`;
  }
  return sizeError();
}

const FREE_SWITCH_ERRORS = {
  ring: () => 'A full ring has a hole, and a free shape can’t. Make the sweep less than 360° first.',
  together: () => `This piece is too small for a free shape: points of its outline would be less than ${together()} apart.`,
  flat: () => 'This piece has no area to make a free shape from.',
};

function fieldError(part, input) {
  const read = isLengthField(input) ? readField(input) : null;
  if (read?.error) return read.error;
  const value = read ? read.mm ?? NaN : Number(input.value);
  return FIELD_ERRORS[input.name]?.(part, value) ?? 'This value is not allowed.';
}

function pendingFields(changed) {
  return [...$('editor').querySelectorAll('[name][aria-invalid="true"]')]
    .filter((field) => field !== changed)
    .map((field) => ({ field, typed: field.value }));
}

function recheckPendingFields(pending) {
  const stillInvalid = [];
  for (const { field, typed } of pending) {
    const part = selectedPart();
    if (!part) return;
    if (!usable(field)) {
      field.value = shownValue(field, part[field.name]);
      showFieldError(field, null);
      continue;
    }
    const next = updatePart(part, field.name, isLengthField(field) ? lengthRaw(readField(field, typed)) : typed);
    const result = next && replacePart(next, field.name);
    if (!result?.project) stillInvalid.push({ field, typed, refusal: result?.refused && lockedMoveMessage(result.piece) });
  }
  for (const { field, typed, refusal } of stillInvalid) {
    field.value = typed;
    announceFieldError(field, refusal || fieldError(selectedPart(), field));
  }
}

function showFieldError(input, message) {
  const note = $(`${input.name}-error`);
  if (!note) return;
  cancelAnimationFrame(pendingAnnouncements.get(note));
  if (note.textContent !== (message ?? '')) note.textContent = message ?? '';
  markInvalid(input, note, message);
}

function markInvalid(input, note, message) {
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', note.id);
  } else {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

function dadoHelp(joint) {
  const cut = cutJoint(project, joint);
  if (!cut) return '';
  const grows = cut.side === 'width' ? 'wider at this edge' : 'longer at this end';
  return `A groove ${len(blank(cut.part).thickness)} wide and ${len(cut.reach)} deep across ${partName(cut.to.id)}. ${partName(cut.part.id)} is cut ${len(cut.reach)} ${grows}.`;
}

function tenonHelp(joint) {
  const cut = cutJoint(project, joint);
  if (!cut) return '';
  const size = blank(cut.part);
  const shoulder = (whole, part) => len(Math.max(0, (whole - part) / 2));
  return `Shoulders: ${shoulder(size.thickness, joint.thickness)} on each face, ${shoulder(size.width, joint.width)} on each edge. ${partName(cut.part.id)} is cut ${len(cut.reach)} longer at this end.`;
}

const JOINT_FORMS = {
  screws: [
    { group: 'trio', fields: [['count', 'Screws', 'count'], ['diameter', 'Diameter (mm)', 'gauge'], ['length', 'Length (mm)', 'length']] },
    { check: ['glued', 'Also glued'] },
  ],
  nails: [
    { group: 'trio', fields: [['count', 'Nails', 'count'], ['diameter', 'Diameter (mm)', 'fixed'], ['length', 'Length (mm)', 'length']] },
    { check: ['glued', 'Also glued'] },
  ],
  glue: [{ help: 'Nothing to set. Counts as one glued joint in the hardware list.' }],
  bracket: [
    { group: 'trio', fields: [['count', 'Brackets', 'count'], ['leg', 'Leg (mm)', 'length'], ['width', 'Width (mm)', 'length']] },
    { legend: 'Screws for each bracket', group: 'trio', fields: [['screwsEach', 'Screws', 'whole'], ['screwDiameter', 'Diameter (mm)', 'gauge'], ['screwLength', 'Length (mm)', 'length']] },
    { check: ['glued', 'Also glued'] },
  ],
  dado: [
    { group: 'duo', fields: [['depth', 'Depth (mm)', 'length']] },
    { live: dadoHelp },
    { check: ['glued', 'Glued'] },
  ],
  tenon: [
    { group: 'trio', fields: [['length', 'Tenon length (mm)', 'length'], ['thickness', 'Thickness (mm)', 'length'], ['width', 'Width (mm)', 'length']] },
    { check: ['through', 'Through tenon'] },
    { live: tenonHelp },
    { check: ['glued', 'Glued'] },
  ],
  dowels: [
    { group: 'trio', fields: [['count', 'Dowels', 'count'], ['diameter', 'Diameter (mm)', 'length'], ['length', 'Length (mm)', 'length']] },
    { check: ['glued', 'Glued'] },
  ],
  pocketScrews: [
    { group: 'trio', fields: [['count', 'Screws', 'count'], ['diameter', 'Diameter (mm)', 'gauge'], ['length', 'Length (mm)', 'length']] },
    { select: ['face', 'Pockets on the', faceOptions] },
    { check: ['glued', 'Also glued'] },
  ],
  mendingPlate: [
    { group: 'trio', fields: [['count', 'Plates', 'count'], ['length', 'Length (mm)', 'length'], ['width', 'Width (mm)', 'length']] },
    { legend: 'Screws for each plate', group: 'trio', fields: [['screwsEach', 'Screws', 'whole'], ['screwDiameter', 'Diameter (mm)', 'gauge'], ['screwLength', 'Length (mm)', 'length']] },
    { select: ['face', 'On the', faceOptions] },
    { check: ['glued', 'Also glued'] },
  ],
  cornerPlate: [
    { group: 'duo', fields: [['leg', 'Leg (mm)', 'length'], ['width', 'Width (mm)', 'length']] },
    { legend: 'Screws for each plate', group: 'trio', fields: [['screwsEach', 'Screws', 'whole'], ['screwDiameter', 'Diameter (mm)', 'gauge'], ['screwLength', 'Length (mm)', 'length']] },
    { select: ['face', 'On the', faceOptions] },
    { check: ['glued', 'Also glued'] },
  ],
  hinge: [
    { swing: true },
    { select: ['hingeType', 'Type', () => HINGE_TYPES] },
    { group: 'trio', fields: [['count', 'Hinges', 'count'], ['size', 'Length (mm)', 'length'], ['screwsEach', 'Screws each', 'whole']] },
    { group: 'duo', fields: [['screwDiameter', 'Screw diameter (mm)', 'gauge'], ['screwLength', 'Screw length (mm)', 'length']] },
    { group: 'duo', select: ['edge', 'Hinge edge', (joint) => Object.fromEntries(hingeEdges(project, joint).map((edge) => [edge, EDGES[edge]]))], fields: [['opensTo', 'Opens up to (°)', 'deg']] },
    { check: ['stops', 'Stops at the first piece in its way'] },
  ],
};

const NO_FACE = 'No face fits';

function faceOptions(joint) {
  const faces = jointFaces(project, joint);
  return faces.length ? Object.fromEntries(faces.map((face) => [face, FACES[face]])) : { '': NO_FACE };
}

const faceWord = (joint) => FACES[jointFace(project, joint)]?.replace(' face', '').toLowerCase();

function restingStop(hinge) {
  const stop = hinge && swingStop(project, hinge.id);
  return stop && hinge.open === stop.angle ? stop : null;
}

function stopNote(joint) {
  const stop = joint.kind === 'hinge' && restingStop(joint);
  if (!stop) return '';
  if (stop.angle === 0) return `Can’t open: ${partName(stop.by)} is in the way.`;
  return `Stopped by ${partName(stop.by)} at ${num(stop.angle)}°. The hinge itself opens to ${num(joint.opensTo)}°.`;
}

const JOINT_ERRORS = {
  count: 'Enter a whole number, at least 1.',
  whole: 'Enter a whole number, 0 or more.',
  get length() {
    return `Enter a size above 0 ${unitName()}.`;
  },
  fixed: 'Enter a size above 0 mm.',
  gauge: GAUGE_ERROR,
  deg: 'Enter an angle from 1° to 270°.',
  open: 'Enter an angle from 0° up to how far it opens.',
  apart: 'These pieces no longer touch, so there are no sizes to suggest.',
};

const lockedMoveMessage = (piece) => `That would swing ${piece.name || 'Unnamed'}, which is locked. Unlock ${piece.name || 'Unnamed'} first.`;

function jointTitle(joint, part) {
  const other = partName(joint.part === part.id ? joint.to : joint.part);
  if (joint.kind === 'hinge') return joint.part === part.id ? `Hinge · swings on ${other}` : `Hinge · carries ${other}`;
  const goesIn = joint.part === part.id;
  if (joint.kind === 'dado') return goesIn ? `Dado · into ${other}` : `Dado · houses ${other}`;
  if (joint.kind === 'tenon') return goesIn ? `Mortise and tenon · into ${other}` : `Mortise and tenon · takes ${other}`;
  if (joint.kind === 'pocketScrews') return goesIn ? `Pocket screws · into ${other}` : `Pocket screws · from ${other}`;
  return `${JOINT_KINDS[joint.kind]} · to ${other}`;
}

function jointSummary(joint) {
  const glued = joint.glued ? ' · glued' : '';
  if (joint.kind === 'screws') return `${joint.count} × ${screwSize(joint.diameter, joint.length)}${glued}`;
  if (joint.kind === 'nails') return `${joint.count} × ${nailSize(joint.diameter, joint.length)}${glued}`;
  if (joint.kind === 'bracket') return `${joint.count} × ${chain([joint.leg, joint.leg, joint.width])}${glued}`;
  if (joint.kind === 'dado') return `${len(joint.depth)} deep${glued}`;
  if (joint.kind === 'tenon') {
    const length = cutJoint(project, joint)?.reach ?? joint.length;
    return `${chain([length, joint.thickness, joint.width])} ${joint.through ? 'through tenon' : 'tenon'}${glued}`;
  }
  if (joint.kind === 'dowels') return `${joint.count} × ⌀${chain([joint.diameter, joint.length])}${glued}`;
  const face = faceWord(joint);
  if (joint.kind === 'mendingPlate') return `${joint.count} × ${chain([joint.length, joint.width])}${face ? ` · ${face} face` : ''}${glued}`;
  if (joint.kind === 'cornerPlate') return `${chain([joint.leg, joint.leg, joint.width])}${face ? ` · ${face} face` : ''}${glued}`;
  if (joint.kind === 'pocketScrews') return `${joint.count} × ${screwSize(joint.diameter, joint.length)}${face ? ` · pockets on ${face}` : ''}${glued}`;
  if (joint.kind === 'hinge') {
    const type = joint.hingeType === 'concealed' ? 'concealed, 35 mm cup' : `${joint.hingeType} ${lenUnit(joint.size)}`;
    return `${joint.count} × ${type} · open ${num(joint.open)}°${restingStop(joint) ? ' · stopped' : ''}`;
  }
  return '';
}

const NUMBER_INPUTS = {
  deg: { step: 'any', inputMode: 'decimal', min: '1' },
  count: { step: '1', inputMode: 'numeric', min: '1' },
  whole: { step: '1', inputMode: 'numeric', min: '0' },
};

const gauged = (kind) => kind === 'gauge' && inInches();
const fieldKind = (kind) => (kind === 'gauge' && !inInches() ? 'length' : kind);

function jointInput(joint, field, kind) {
  const input = element('input', 'num');
  if (kind === 'fixed') input.dataset.mmOnly = '';
  if (gauged(kind)) {
    lengthField(input);
    delete input.dataset.length;
    input.dataset.gauge = '';
  } else if (['length', 'gauge', 'fixed'].includes(kind)) lengthField(input);
  else Object.assign(input, { type: 'number', ...NUMBER_INPUTS[kind] });
  input.dataset.jf = field;
  input.dataset.joint = joint.id;
  input.dataset.check = fieldKind(kind);
  return input;
}

function jointLabel(text, kind) {
  if (gauged(kind)) return text.replace(/(d)iameter \(mm\)/i, (_, d) => (d === 'D' ? 'Gauge' : 'gauge'));
  return fieldKind(kind) === 'length' ? text.replace('(mm)', `(${unitName()})`) : text;
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
  const note = element('p', 'help stop-note');
  note.setAttribute('aria-live', 'polite');
  box.append(element('label', '', 'Open (°)'), range, number, buttons, note);
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
    if (row.live) {
      const live = element('p', 'help');
      live.dataset.live = '';
      body.append(live);
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
      wrap.append(labelled(jointLabel(text, kind), jointInput(joint, field, kind)));
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
  warn.textContent = problem ? problem.split(/\.(?=\s|$)|;/)[0] : '';
  warn.hidden = !problem;
  const note = card.querySelector('.joint-body > .warn');
  note.textContent = problem ?? '';
  note.hidden = !problem;
  const stuck = joint.kind === 'hinge' && dragMode(project, joint.part) !== 'swing';
  for (const control of card.querySelectorAll('[data-jf]')) {
    const field = control.dataset.jf;
    if (control.type === 'range') control.max = String(joint.opensTo);
    if (field === 'open') control.disabled = stuck;
    if (joint.kind === 'tenon' && field === 'length') control.disabled = joint.through;
    if (control === document.activeElement && control.getAttribute('aria-invalid') === 'true') continue;
    if (control === document.activeElement && 'check' in control.dataset) continue;
    const through = joint.kind === 'tenon' && field === 'length' && joint.through;
    if (control.type === 'checkbox') control.checked = Boolean(joint[field]);
    else control.value = field === 'face' ? jointFace(project, joint) ?? '' : shownValue(control, through ? cutJoint(project, joint)?.reach ?? joint.length : joint[field]);
    if (control.getAttribute('aria-invalid') === 'true') showJointError(control, null);
  }
  const live = card.querySelector('[data-live]');
  if (live) live.textContent = JOINT_FORMS[joint.kind].find((row) => row.live).live(joint);
  const size = card.querySelector('[data-jf-field="size"]');
  if (size) size.hidden = joint.hingeType === 'concealed';
  for (const button of card.querySelectorAll('[data-jf-act="close"], [data-jf-act="open-full"]')) button.disabled = stuck;
  const stop = card.querySelector('.stop-note');
  const said = stopNote(joint);
  if (stop && stop.dataset.said !== said) {
    stop.dataset.said = said;
    announce(stop, said);
  }
  const faceSelect = card.querySelector('select[data-jf="face"]');
  if (faceSelect) offWithReason(faceSelect, jointFace(project, joint) ? null : problem ?? NO_FACE);
  card.querySelector('[data-jf-act="suggest"]').hidden = !differsFromSuggestion(joint);
  const removal = jointRemoval(project, joint.id);
  offWithReason(card.querySelector('[data-jf-act="remove"]'), removal.refused && lockedMoveMessage(removal.piece));
}

let jointsShape = '';

function renderJoints(part) {
  const joints = jointsOn(part.id);
  const shape = [part.id, ...joints.map((joint) => `${joint.id}:${joint.hingeType ?? ''}:${hingeEdges(project, joint).join()}:${jointFaces(project, joint).join()}`)].join('|');
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
  $('swing-help').textContent = swingingHinge(project, part.id)?.stops === false ? PASS_THROUGH_HELP : STOP_HELP;
  $('joints-none').hidden = touching.length > 0 || joints.length > 0;
  $('joint-add-open').hidden = touching.length === 0;
  $('joint-add-open').setAttribute('aria-expanded', String(addingJoint));
  $('joint-add').hidden = !addingJoint || touching.length === 0;
  if (addingJoint) renderJointAdd(part, touching);
}

const PASS_THROUGH_HELP = $('swing-help').textContent;
const STOP_HELP = 'Drag this piece in the 3D view to swing it; drag the piece it hangs on to move both. It stops at the first piece in its way.';

function focusKeyOf(node) {
  if (node.dataset.jf) return `[data-jf="${node.dataset.jf}"][data-joint="${node.dataset.joint}"]${node.type === 'range' ? '[type="range"]' : ''}`;
  if (node.dataset.jfAct) return `[data-jf-act="${node.dataset.jfAct}"][data-joint="${node.dataset.joint}"]`;
  if (node.closest('[data-joint-card]')) return `[data-joint-card="${node.closest('[data-joint-card]').dataset.jointCard}"] summary`;
  return null;
}

function renderJointAdd(part, touching) {
  const kind = $('joint-kind');
  if (!kind.options.length) fillGroupedSelect(kind, JOINT_GROUPS, JOINT_KINDS);
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
  $('joint-add-note').textContent = result.error ?? joinNote(result.joint, part, free);
  $('joint-add-ok').disabled = Boolean(result.error);
}

function joinNote(joint, part, other) {
  if (joint.kind === 'hinge') return `${part.name || 'This piece'} will swing on ${other.name || 'it'}.`;
  if (joint.kind === 'pocketScrews') return `Pockets are drilled in ${partName(joint.part)}; the screws go into ${partName(joint.to)}.`;
  if (joint.kind === 'dowels') return 'Holes are drilled in both pieces.';
  if (joint.kind === 'tenon') return `${partName(joint.part)} gets the tenon. The mortise is cut in ${partName(joint.to)}.`;
  if (joint.kind === 'dado') return `The ${cutJoint(project, joint)?.side === 'width' ? 'edge' : 'end'} of ${partName(joint.part)} sits in a groove cut across ${partName(joint.to)}.`;
  return '';
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

function refusalMessage({ refused, piece, reason }, control) {
  if (refused === 'locked') return lockedMoveMessage(piece);
  if (refused === 'apart') return JOINT_ERRORS.apart;
  if (reason) return reason;
  if (control.dataset.jf === 'open') return JOINT_ERRORS.open;
  return JOINT_ERRORS[control.dataset.check] ?? JOINT_ERRORS.length;
}

$('joints').addEventListener('input', (event) => {
  const control = event.target;
  const { jf: field, joint: jointId } = control.dataset;
  if (!field || !jointId) return;
  let raw = control.type === 'checkbox' ? control.checked : control.value;
  if (isLengthField(control)) {
    const read = readField(control);
    if (read.incomplete) return;
    if (read.error) {
      showJointError(control, read.error);
      return;
    }
    raw = lengthRaw(read);
  }
  const result = changeJoint(project, jointId, field, raw);
  const typed = 'check' in control.dataset || control.type === 'range';
  if (result.refused) {
    const message = refusalMessage(result, control);
    if (typed) {
      showJointError(control, message);
      return;
    }
    renderEditor();
    announce(jointNote(control), message);
    return;
  }
  showJointError(control, null);
  commit(result.project, typed ? `${jointId}:${field}` : null);
  if (result.stopped) sayStop(jointId);
});

function sayStop(jointId) {
  const note = $('joints').querySelector(`[data-joint-card="${jointId}"] .stop-note`);
  if (note) announce(note, note.dataset.said);
}

$('joints').addEventListener('focusout', (event) => {
  const control = event.target;
  if (!('check' in control.dataset) || control.getAttribute('aria-invalid') === 'true') return;
  const joint = jointById(project, control.dataset.joint);
  if (joint && control.dataset.jf in joint) control.value = shownValue(control, joint[control.dataset.jf]);
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
      announce(jointNote(button), lockedMoveMessage(removal.piece));
      return;
    }
    commit(removal.project);
    $('joint-add-open').hidden ? $('editor').querySelector('[name="name"]').focus() : $('joint-add-open').focus();
    return;
  }
  if (act === 'suggest') {
    const result = suggestSizes(project, joint.id);
    if (result.refused) {
      announce(jointNote(button), refusalMessage(result, button));
      return;
    }
    commit(result.project);
    if (!usable(button)) button.closest('[data-joint-card]')?.querySelector('summary').focus();
    return;
  }
  const result = changeJoint(project, joint.id, 'open', act === 'close' ? 0 : joint.opensTo);
  if (result.project && jointById(result.project, joint.id).open !== joint.open) commit(result.project);
  if (result.stopped) sayStop(joint.id);
}));

const FASTENERS = { Screw: screwSize, 'Pocket screw': screwSize, Nail: nailSize };

function hardwareSize({ item, size }) {
  if (!size) return { values: [], text: '–' };
  if (!FASTENERS[item]) return { values: size, text: dims(size, item === 'Dowel pin' ? '⌀' : '') };
  const [diameter, length] = size;
  const labelled = inInches() && (item === 'Nail' || gaugeOf(diameter));
  const values = labelled ? [length] : size;
  return { values, text: `${approx(values)}${FASTENERS[item](diameter, length)}` };
}

const USED_ON_SHOWN = 2;

function renderHardware() {
  const rows = hardwareList(project);
  const labels = headings('.hardware-list');
  $('hardware-rows').replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      const more = row.usedOn.length - USED_ON_SHOWN;
      const usedOn = row.usedOn.slice(0, USED_ON_SHOWN).join(', ') + (more > 0 ? ` +${more} more` : '');
      const cells = [
        [row.count === null ? '–' : `${row.count} ×`, 'num'],
        [row.item],
        [hardwareSize(row).text],
        [usedOn],
      ];
      cells.forEach(([text, className], i) => {
        const td = element('td', className, text);
        td.setAttribute('role', 'cell');
        td.dataset.label = labels[i];
        tr.append(td);
      });
      return tr;
    }),
  );
  rounded.hardware = rows.some((row) => hardwareSize(row).values.some(isRounded));
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
  renderPlan();
  renderButtons();
  describeView();
}

const planView = createPlanView({
  root: $('plan'),
  element,
  visible,
  getProject: () => project,
  onPick: (id) => select(id),
  onChange: (cutting, field) => commit({ ...project, cutting }, field && `cutting:${field}`),
});

function renderPlan() {
  planView.render(project, selectedId);
  renderRoundedNote();
}

let cutView = loadCutView();

function setCutView(view) {
  cutView = view;
  saveCutView(view);
  $('view-list').setAttribute('aria-pressed', String(view === 'list'));
  $('view-plan').setAttribute('aria-pressed', String(view === 'plan'));
  document.querySelector('.cut').classList.toggle('plan-open', view === 'plan');
  $('plan').hidden = view !== 'plan';
  renderPlan();
}
$('view-list').addEventListener('click', () => setCutView('list'));
$('view-plan').addEventListener('click', () => setCutView('plan'));

function renderButtons() {
  $('undo').disabled = undoStack.length === 0;
  $('redo').disabled = redoStack.length === 0;
  $('duplicate').disabled = !selectedId;
  const locked = Boolean(selectedPart()?.locked);
  $('delete').disabled = !selectedId;
  offWithReason($('delete'), selectedId && deleteRefusal(selectedId));
  for (const note of [$('editor-note'), $('parts-note')]) announce(note, '');
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
    xray: selectedId ? joineryXray(project, selectedId) : [],
    stopper: restingStop(hinge)?.by ?? null,
  };
}

function placeView() {
  view.place(project.parts, sceneExtras());
}

function fillSelect(select, options) {
  select.replaceChildren(...Object.entries(options).map(([value, label]) => new Option(label, value)));
}

function fillGroupedSelect(select, groups, labels) {
  select.replaceChildren(
    ...Object.entries(groups).map(([name, values]) => {
      const group = document.createElement('optgroup');
      group.label = name;
      group.append(...values.map((value) => new Option(labels[value], value)));
      return group;
    }),
  );
}
fillSelect($('field-species'), Object.fromEntries(Object.entries(SPECIES).map(([key, { label }]) => [key, label])));
fillSelect($('field-pose'), LIES);

$('editor').addEventListener('input', (event) => {
  const input = event.target;
  const part = selectedPart();
  if (!part || !input.name) return;
  if (input.type === 'radio' && !input.checked) return;
  const typed = input.tagName === 'INPUT' && input.type !== 'radio' && input.type !== 'checkbox';
  let raw = input.type === 'checkbox' ? input.checked : input.value;
  if (isLengthField(input)) {
    const read = readField(input);
    if (read.incomplete) return;
    if (read.error) {
      showFieldError(input, read.error);
      return;
    }
    raw = lengthRaw(read);
  }
  const next = updatePart(part, input.name, raw);
  if (!next && input.name === 'shape' && input.value === 'free' && !part.locked) {
    renderEditor();
    announce($('shape-error'), FREE_SWITCH_ERRORS[freeSwitchProblem(part)]?.() ?? 'This piece can’t become a free shape.');
    return;
  }
  if (!next && typed) {
    showFieldError(input, fieldError(part, input));
    return;
  }
  const pending = pendingFields(input);
  if (next && ['x', 'y', 'z'].includes(input.name)) {
    const move = changePosition(project, part.id, { [input.name]: next[input.name] });
    if (move.refused) {
      const name = move.piece.name || 'Unnamed';
      showFieldError(input, `That would move ${move.piece.id === part.id ? name : `${name}, joined to it,`} past ±${floorLen(MAX_SIZE_MM)} ${unitName()}.`);
      return;
    }
    showFieldError(input, null);
    commit(move.project, `${part.id}:${input.name}`);
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
$('editor').addEventListener('focusout', (event) => {
  const input = event.target;
  const part = selectedPart();
  if (part && input.name in part && isLengthField(input) && input.getAttribute('aria-invalid') !== 'true') input.value = fieldText(part[input.name]);
});

document.addEventListener(
  'focusout',
  (event) => {
    const input = event.target;
    if (!isLengthField(input) || !readField(input).incomplete) return;
    input.dataset.final = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    delete input.dataset.final;
  },
  true,
);

document.addEventListener(
  'keydown',
  (event) => {
    const input = event.target;
    const up = event.key === 'ArrowUp';
    if ((!up && event.key !== 'ArrowDown') || !isLengthField(input) || 'gauge' in input.dataset || event.altKey || event.ctrlKey || event.metaKey) return;
    const read = readField(input);
    if (!('mm' in read)) return;
    event.preventDefault();
    const step = mmOnly(input) ? 1 : units().fineNudge;
    input.value = shownValue(input, read.mm + (up ? step : -step));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },
  true,
);

function refusePartEdit(input, message, typed) {
  if (!typed) renderEditor();
  if (!$(`${input.name}-error`)) return announce($('editor-note'), message);
  announceFieldError(input, message);
}

function announceFieldError(input, message) {
  const note = $(`${input.name}-error`);
  if (!note) return;
  announce(note, message);
  markInvalid(input, note, message);
}

$('project-name').addEventListener('change', (event) => {
  const name = event.target.value.trim().slice(0, 80) || 'Untitled project';
  if (name !== project.name) commit({ ...project, name });
});

for (const shapes of document.querySelectorAll('.add-shapes')) {
  const onPhone = Boolean(shapes.closest('.add-bar'));
  shapes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-shape]');
    if (!button) return;
    addPart(button.dataset.addShape);
    if (onPhone) showTab('edit');
    if (button.dataset.addShape === 'free') {
      const id = selectedId;
      editOutline(() => [$(`part-${id}`)?.querySelector('.row-main'), $('edit-outline'), button].find(usable));
    }
  });
}

function showTab(name) {
  $('main').dataset.tab = name;
  for (const tab of document.querySelectorAll('.tabs [data-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
  renderPlan();
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

function renderUnitTexts() {
  const unit = units();
  for (const node of document.querySelectorAll('[data-unit]')) node.textContent = unit.name;
  const steps = { grid: unit.snap, nudge: unit.nudge, fine: unit.fineNudge };
  for (const node of document.querySelectorAll('[data-step]')) node.textContent = lenUnit(steps[node.dataset.step]);
  $('snap').title = `Snap to other boards and a ${lenUnit(unit.snap)} grid while dragging (hold Alt for the opposite)`;
  for (const input of document.querySelectorAll('input[data-length]')) lengthField(input);
  $('units').value = unit.id;
}

function changeUnits(id) {
  setUnits(id);
  saveUnits(units().id);
  renderUnitTexts();
  jointsShape = '';
  planView.reset();
  view.setFloorGrid(units().floor, units().block);
  render();
}
$('units').addEventListener('change', (event) => changeUnits(event.target.value));
setUnits(loadUnits());
renderUnitTexts();
view.setFloorGrid(units().floor, units().block);

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
  if (outlineEditor.isOpen() || event.target.closest?.('#outline-dialog')) return;
  const typing = event.target.closest('textarea, input:not([type="radio"], [type="checkbox"])');
  const inField = event.target.closest('input, select, textarea');
  if (event.key in ARROWS && selectedId && !event.ctrlKey && !event.metaKey && !inField) {
    event.preventDefault();
    const [axis, sign] = ARROWS[event.key](event.altKey);
    nudge(axis, sign * (event.shiftKey ? units().fineNudge : units().nudge));
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
setCutView(cutView);
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
window.woodworkingPlanner = { get project() { return project; }, select, framesDrawn: () => view.framesDrawn(), drawn: () => view.drawn() };

if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Working offline is not available:', error));
}
