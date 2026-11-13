import {
  MAX_POINTS,
  MIN_POINTS,
  addPoint,
  apex,
  bendToward,
  box,
  edgePath,
  fromStroke,
  halfEdge,
  insertPoint,
  movePoint,
  outlineProblem,
  polygon,
  removePoint,
  setBend,
} from './free.js';

const SNAP_MM = 10;
const NUDGE_MM = 10;
const FINE_NUDGE_MM = 1;
const MERGE_MS = 1200;
const MARGIN = 0.25;
const MAJOR_MM = 100;
const MINOR_MM = 10;
const MINOR_MIN_PX = 8;
const STRAIGHT_CATCH_PX = 6;
const EDGE_HIT_PX = 10;
const LABEL_PX = 15;
const hitRadius = (pointerType) => (pointerType === 'mouse' ? 10 : 22);
const PICK_FIRST = 'Pick a point first.';
const AXES = [
  ['x', 'from left'],
  ['y', 'from bottom'],
  ['bend', 'bend'],
];

export function createOutlineEditor({ maxSize, mm, announce, offWithReason, snap, onDone }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('outline-dialog');
  const svg = $('outline-svg');
  const list = $('outline-points');
  const problemNote = $('outline-problem');
  const note = $('outline-note');
  const chip = $('outline-chip');
  const buttons = Object.fromEntries(
    ['add', 'remove', 'straighten', 'draw', 'undo', 'redo', 'snap', 'cancel', 'done', 'discard-yes', 'keep'].map((name) => [name, $(`outline-${name}`)]),
  );
  let state = null;
  let view = { width: 0, height: 0, scale: 1, ox: 0, oy: 0 };
  let drag = null;
  let shownProblem = '';

  const toPx = ([x, y]) => [view.ox + x * view.scale, view.oy - y * view.scale];
  function toMm(event) {
    const rect = svg.getBoundingClientRect();
    return [(event.clientX - rect.left - view.ox) / view.scale, (view.oy - (event.clientY - rect.top)) / view.scale];
  }

  function problemText(points) {
    const problem = outlineProblem(points, maxSize);
    if (!problem) return '';
    if (problem.kind === 'crossing') {
      const [a, b] = problem.edges;
      return `The outline crosses itself between points ${a + 1} and ${b + 1}. Move a point so the edges don’t cross.`;
    }
    if (problem.kind === 'together') {
      const [a, b] = problem.points;
      return `Points ${a + 1} and ${b + 1} are in the same place. Move one or remove it.`;
    }
    if (problem.kind === 'flat') return 'The outline has no area. Spread the points out.';
    return `The outline can be at most ${mm(maxSize)} across.`;
  }

  function open({ name, color, points, returnFocus }) {
    state = { color, original: points, points, picked: null, undo: [], redo: [], last: null, drawing: false, stroke: null, returnFocus };
    $('outline-title').textContent = `Outline of ${name || 'Unnamed'}`;
    showDiscard(false);
    list.replaceChildren();
    announce(note, '');
    announce(problemNote, '');
    shownProblem = '';
    dialog.showModal();
    render();
    svg.focus();
  }

  function close() {
    if (!state) return;
    const { returnFocus } = state;
    state = null;
    drag = null;
    chip.hidden = true;
    if (dialog.open) dialog.close();
    returnFocus?.()?.focus();
  }

  const changed = () => JSON.stringify(state.points) !== JSON.stringify(state.original);

  function change(points, key = null, skip = null) {
    const now = Date.now();
    const same = key && state.last?.key === key && now - state.last.at < MERGE_MS;
    state.last = key ? { key, at: now } : null;
    if (!same) state.undo.push(state.points);
    state.redo.length = 0;
    state.points = points;
    if (state.picked !== null) state.picked = Math.min(state.picked, points.length - 1);
    render({ skip });
  }

  function step(from, to) {
    if (!from.length) return;
    to.push(state.points);
    state.points = from.pop();
    state.last = null;
    if (state.picked !== null) state.picked = Math.min(state.picked, state.points.length - 1);
    render();
  }

  function fit() {
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) return;
    const size = box(state.points);
    const spanX = Math.max(size.maxX - size.minX, 10);
    const spanY = Math.max(size.maxY - size.minY, 10);
    const scale = Math.min(width / (spanX * (1 + 2 * MARGIN)), height / (spanY * (1 + 2 * MARGIN)));
    view = { width, height, scale, ox: width / 2 - ((size.minX + size.maxX) / 2) * scale, oy: height / 2 + ((size.minY + size.maxY) / 2) * scale };
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  function render({ refit = true, skip = null } = {}) {
    if (!state) return;
    if (refit) fit();
    draw();
    renderTable(skip);
    renderTools();
  }

  const fixed = (value) => value.toFixed(1);
  const pathOf = (corners, closed = true) => `M${corners.map((corner) => toPx(corner).map(fixed).join(' ')).join('L')}${closed ? 'Z' : ''}`;

  function gridPath(stepMm, skipEvery) {
    const left = Math.ceil(-view.ox / view.scale / stepMm);
    const right = Math.floor((view.width - view.ox) / view.scale / stepMm);
    const bottom = Math.ceil((view.oy - view.height) / view.scale / stepMm);
    const top = Math.floor(view.oy / view.scale / stepMm);
    const lines = [];
    for (let k = left; k <= right; k++) {
      if (skipEvery && (k * stepMm) % skipEvery === 0) continue;
      const x = fixed(view.ox + k * stepMm * view.scale);
      lines.push(`M${x} 0V${fixed(view.height)}`);
    }
    for (let k = bottom; k <= top; k++) {
      if (skipEvery && (k * stepMm) % skipEvery === 0) continue;
      const y = fixed(view.oy - k * stepMm * view.scale);
      lines.push(`M0 ${y}H${fixed(view.width)}`);
    }
    return lines.join('');
  }

  function element(tag, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function draw() {
    const { points, picked } = state;
    const problem = outlineProblem(points, maxSize);
    const nodes = [];
    if (MINOR_MM * view.scale >= MINOR_MIN_PX) nodes.push(element('path', { class: 'grid-minor', d: gridPath(MINOR_MM, MAJOR_MM) }));
    nodes.push(element('path', { class: 'grid-major', d: gridPath(MAJOR_MM) }));
    const size = box(points);
    const [left, top] = toPx([size.minX, size.maxY]);
    const [right, bottom] = toPx([size.maxX, size.minY]);
    nodes.push(element('rect', { class: 'blank', x: fixed(left), y: fixed(top), width: fixed(right - left), height: fixed(bottom - top) }));
    const labelY = top - 8 >= 12 ? top - 8 : top + 14;
    nodes.push(element('text', { class: 'blank-label', x: fixed(left), y: fixed(labelY) }, `Blank ${mm(Math.round((size.maxX - size.minX) * 10) / 10)} × ${mm(Math.round((size.maxY - size.minY) * 10) / 10)}`));
    nodes.push(element('path', { class: problem ? 'shape bad' : 'shape', d: pathOf(polygon(points)), fill: state.color }));
    const badEdges = problem?.kind === 'crossing' ? problem.edges : problem?.kind === 'together' ? problem.points : [];
    for (const i of badEdges) nodes.push(element('path', { class: 'edge-bad', d: pathOf(edgePath(points, i), false) }));
    if (state.stroke) nodes.push(element('path', { class: 'stroke', d: pathOf(state.stroke, false) }));
    if (!state.drawing) {
      points.forEach((_, i) => {
        const [x, y] = toPx(apex(points, i));
        const on = points[i].bend || (drag?.kind === 'bend' && drag.index === i);
        nodes.push(element('polygon', { class: on ? 'bend-handle on' : 'bend-handle', points: [[x, y - 4], [x + 4, y], [x, y + 4], [x - 4, y]].map((p) => p.map(fixed).join(',')).join(' ') }));
      });
      const [mx, my] = toPx([points.reduce((sum, { x }) => sum + x, 0) / points.length, points.reduce((sum, { y }) => sum + y, 0) / points.length]);
      points.forEach((each, i) => {
        const [x, y] = toPx([each.x, each.y]);
        const away = Math.hypot(x - mx, y - my) || 1;
        nodes.push(element('circle', { class: i === picked ? 'pt sel' : 'pt', cx: fixed(x), cy: fixed(y), r: 6 }));
        const label = { class: 'pt-label', x: fixed(x + ((x - mx) / away) * LABEL_PX), y: fixed(y + ((y - my) / away) * LABEL_PX), 'text-anchor': 'middle', 'dominant-baseline': 'central' };
        nodes.push(element('text', label, String(i + 1)));
      });
    }
    svg.replaceChildren(...nodes);
    $('outline-draw-help').hidden = !state.drawing;
  }

  function row(i) {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'pt-n';
    number.textContent = String(i + 1);
    item.append(number);
    const error = document.createElement('p');
    error.className = 'field-error';
    error.id = `point-error-${i}`;
    error.setAttribute('aria-live', 'polite');
    for (const [axis, words] of AXES) {
      const input = Object.assign(document.createElement('input'), { type: 'number', step: 'any', className: 'num' });
      input.dataset.length = '';
      input.dataset.index = String(i);
      input.dataset.axis = axis;
      input.setAttribute('aria-label', `Point ${i + 1}, ${words}`);
      item.append(input);
    }
    item.append(error);
    return item;
  }

  function renderTable(skip) {
    const { points, picked } = state;
    if (list.children.length !== points.length) {
      const focused = list.contains(document.activeElement) ? document.activeElement : null;
      const where = focused && [Math.min(Number(focused.dataset.index), points.length - 1), focused.dataset.axis];
      list.replaceChildren(...points.map((_, i) => row(i)));
      if (where) list.querySelector(`[data-index="${where[0]}"][data-axis="${where[1]}"]`)?.focus();
      skip = null;
    }
    [...list.children].forEach((item, i) => {
      item.classList.toggle('sel', i === picked);
      for (const input of item.querySelectorAll('input')) {
        if (input === skip || (input === document.activeElement && input.getAttribute('aria-invalid') === 'true' && !skip)) continue;
        input.value = String(points[i][input.dataset.axis]);
        showError(input, null);
      }
    });
  }

  function showError(input, message) {
    const error = $(`point-error-${input.dataset.index}`);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
      if (error.textContent !== message) error.textContent = message;
      return;
    }
    if (input.getAttribute('aria-invalid') !== 'true') return;
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const row = input.closest('li');
    if (!row.querySelector('[aria-invalid="true"]')) error.textContent = '';
  }

  function renderTools() {
    const { points, picked } = state;
    const none = picked === null;
    offWithReason(buttons.add, none ? PICK_FIRST : points.length >= MAX_POINTS ? `An outline can have at most ${MAX_POINTS} points.` : null);
    offWithReason(buttons.remove, none ? PICK_FIRST : points.length <= MIN_POINTS ? `An outline needs at least ${MIN_POINTS} points.` : null);
    offWithReason(buttons.straighten, none ? PICK_FIRST : points[picked].bend ? null : 'That edge is already straight.');
    buttons.undo.disabled = !state.undo.length;
    buttons.redo.disabled = !state.redo.length;
    buttons.draw.setAttribute('aria-pressed', String(state.drawing));
    buttons.snap.setAttribute('aria-pressed', String(snap.get()));
    const problem = problemText(points);
    offWithReason(buttons.done, problem || null);
    if (problem !== shownProblem) announce(problemNote, problem);
    shownProblem = problem;
  }

  function pick(index) {
    state.picked = index;
    render({ refit: false });
    if (index !== null) list.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function refused(button) {
    if (button.getAttribute('aria-disabled') !== 'true') return false;
    announce(button === buttons.done ? problemNote : note, button.title);
    return true;
  }

  function removePicked() {
    if (refused(buttons.remove)) return;
    change(removePoint(state.points, state.picked));
  }

  function showDiscard(on) {
    $('outline-actions').hidden = on;
    $('outline-discard').hidden = !on;
    if (on) buttons.keep.focus();
  }

  function cancel() {
    if (!$('outline-discard').hidden) {
      showDiscard(false);
      buttons.cancel.focus();
      return;
    }
    if (!changed()) close();
    else showDiscard(true);
  }

  buttons.add.addEventListener('click', () => {
    if (refused(buttons.add)) return;
    change(addPoint(state.points, state.picked));
    pick(state.picked + 1);
  });
  buttons.remove.addEventListener('click', removePicked);
  buttons.straighten.addEventListener('click', () => {
    if (refused(buttons.straighten)) return;
    change(setBend(state.points, state.picked, 0));
  });
  buttons.draw.addEventListener('click', () => {
    state.drawing = !state.drawing;
    state.stroke = null;
    render({ refit: false });
  });
  buttons.undo.addEventListener('click', () => step(state.undo, state.redo));
  buttons.redo.addEventListener('click', () => step(state.redo, state.undo));
  buttons.snap.addEventListener('click', () => {
    snap.set(!snap.get());
    renderTools();
  });
  buttons.cancel.addEventListener('click', cancel);
  buttons.keep.addEventListener('click', cancel);
  buttons['discard-yes'].addEventListener('click', close);
  buttons.done.addEventListener('click', () => {
    if (refused(buttons.done)) return;
    const refusal = onDone(state.points);
    if (refusal) announce(note, refusal);
    else close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (!state) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) step(state.redo, state.undo);
      else step(state.undo, state.redo);
    } else if (mod && key === 'y') {
      event.preventDefault();
      step(state.redo, state.undo);
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (state) cancel();
  });
  dialog.addEventListener('close', () => {
    if (state) close();
  });

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

  svg.addEventListener('keydown', (event) => {
    if (!state || event.ctrlKey || event.metaKey || event.altKey) return;
    const { points, picked } = state;
    if (event.key in ARROWS) {
      event.preventDefault();
      if (picked === null) return announce(note, PICK_FIRST);
      const [dx, dy] = ARROWS[event.key];
      const amount = event.shiftKey ? FINE_NUDGE_MM : NUDGE_MM;
      const point = points[picked];
      change(movePoint(points, picked, point.x + dx * amount, point.y + dy * amount), `nudge:${picked}`);
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      const next = picked === null ? 0 : picked + (event.key === 'PageDown' ? 1 : -1);
      pick(Math.max(0, Math.min(points.length - 1, next)));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removePicked();
    }
  });

  list.addEventListener('focusin', (event) => {
    const index = event.target.dataset?.index;
    if (index !== undefined && Number(index) !== state?.picked) pick(Number(index));
  });

  list.addEventListener('input', (event) => {
    const input = event.target;
    if (!state || !input.dataset.axis) return;
    const index = Number(input.dataset.index);
    const { axis } = input.dataset;
    const raw = input.value;
    const value = Math.round(Number(raw) * 10) / 10;
    const { points } = state;
    if (axis === 'bend') {
      const most = Math.floor(halfEdge(points, index) * 10) / 10;
      if (raw === '' || !Number.isFinite(value) || Math.abs(value) > most) {
        showError(input, `Enter a bend from ${mm(-most)} to ${mm(most)}, half the length of this edge.`);
        return;
      }
      showError(input, null);
      change(setBend(points, index, value), `field:${index}:${axis}`, input);
      return;
    }
    if (raw === '' || !Number.isFinite(value) || Math.abs(value) > maxSize) {
      showError(input, `Enter a number from −${mm(maxSize)} to ${mm(maxSize)} mm.`);
      return;
    }
    showError(input, null);
    const point = points[index];
    change(movePoint(points, index, axis === 'x' ? value : point.x, axis === 'y' ? value : point.y), `field:${index}:${axis}`, input);
  });

  function nearest(event, spots) {
    const rect = svg.getBoundingClientRect();
    const at = [event.clientX - rect.left, event.clientY - rect.top];
    let best = null;
    spots.forEach((spot, i) => {
      const [x, y] = toPx(spot);
      const distance = Math.hypot(x - at[0], y - at[1]);
      if (distance <= hitRadius(event.pointerType) && (!best || distance < best.distance)) best = { index: i, distance };
    });
    return best?.index ?? null;
  }

  function showChip() {
    const point = state.points[drag.index];
    chip.textContent = `Point ${drag.index + 1} · ${mm(point.x)}, ${mm(point.y)}`;
    chip.hidden = false;
  }

  svg.addEventListener('pointerdown', (event) => {
    if (!state || drag || !event.isPrimary || event.button > 0) return;
    const start = { base: state.points, pointerId: event.pointerId, pointerType: event.pointerType };
    if (state.drawing) {
      drag = { ...start, kind: 'stroke' };
      state.stroke = [toMm(event)];
    } else {
      const { points } = state;
      const onPoint = nearest(event, points.map(({ x, y }) => [x, y]));
      const onHandle = onPoint === null ? nearest(event, points.map((_, i) => apex(points, i))) : null;
      if (onPoint === null && onHandle === null) return;
      drag = { ...start, kind: onPoint === null ? 'bend' : 'point', index: onPoint ?? onHandle };
      state.picked = onPoint ?? state.picked;
    }
    event.preventDefault();
    svg.focus();
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      drag.uncaptured = true;
    }
    render({ refit: false });
    if (drag.kind === 'point') list.children[drag.index]?.scrollIntoView({ block: 'nearest' });
  });

  svg.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const [x, y] = toMm(event);
    if (drag.kind === 'stroke') {
      state.stroke.push([x, y]);
      draw();
      return;
    }
    if (drag.kind === 'point') {
      const snapping = snap.get() !== event.altKey;
      const at = snapping ? [Math.round(x / SNAP_MM) * SNAP_MM, Math.round(y / SNAP_MM) * SNAP_MM] : [x, y];
      state.points = movePoint(drag.base, drag.index, ...at);
      if (drag.pointerType !== 'mouse') showChip();
    } else {
      const bend = bendToward(drag.base, drag.index, [x, y]);
      state.points = setBend(drag.base, drag.index, Math.abs(bend) * view.scale < STRAIGHT_CATCH_PX ? 0 : bend);
    }
    draw();
    renderTable(null);
    renderTools();
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = null;
    chip.hidden = true;
    if (ended.kind === 'stroke') {
      const stroke = state.stroke;
      state.stroke = null;
      const points = stroke && fromStroke(stroke);
      if (!points) {
        render({ refit: false });
        announce(note, 'That was too small to be an outline. Draw a bigger one.');
        return;
      }
      state.drawing = false;
      state.picked = null;
      change(points);
      return;
    }
    const after = state.points;
    if (after === ended.base) return render();
    state.points = ended.base;
    change(after);
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('dblclick', (event) => {
    if (!state || state.drawing || state.points.length >= MAX_POINTS) return;
    const rect = svg.getBoundingClientRect();
    const at = [event.clientX - rect.left, event.clientY - rect.top];
    let best = null;
    state.points.forEach((_, i) => {
      const path = edgePath(state.points, i).map(toPx);
      for (let k = 0; k < path.length - 1; k++) {
        const distance = segmentDistance(at, path[k], path[k + 1]);
        if (distance <= EDGE_HIT_PX && (!best || distance < best.distance)) best = { index: i, distance };
      }
    });
    if (!best) return;
    state.picked = best.index + 1;
    change(insertPoint(state.points, best.index, toMm(event)));
  });

  new ResizeObserver(() => {
    if (state && !drag) render({ refit: true });
  }).observe(svg);

  return { open, isOpen: () => Boolean(state) };
}

function segmentDistance([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
