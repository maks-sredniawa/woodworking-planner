import {
  ORIENTATIONS,
  SPECIES,
  cutList,
  duplicatePart,
  makePart,
  overlaps,
  projectBounds,
  starterProject,
  totals,
  updatePart,
} from './model.js';
import { createScene } from './scene.js';
import { download, loadSaved, readFile, save } from './storage.js';

const HISTORY_LIMIT = 100;
const TYPING_MERGE_MS = 1200;
const $ = (id) => document.getElementById(id);

let project = loadSaved() ?? starterProject();
let selectedId = null;
const undoStack = [];
const redoStack = [];
let lastEdit = null;

const view = createScene($('viewport'), { onSelect: select });

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

function undo() {
  if (!undoStack.length) return;
  redoStack.push(project);
  project = undoStack.pop();
  afterHistoryMove();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(project);
  project = redoStack.pop();
  afterHistoryMove();
}

function afterHistoryMove() {
  lastEdit = null;
  if (!project.parts.some((part) => part.id === selectedId)) selectedId = null;
  persist();
  render();
}

function select(id) {
  selectedId = id;
  view.setSelected(id);
  renderParts();
  renderEditor();
  renderSelectionChip();
  renderButtons();
  if (id) $(`part-${id}`)?.scrollIntoView({ block: 'nearest' });
}

function selectedPart() {
  return project.parts.find((part) => part.id === selectedId) ?? null;
}

function replacePart(next, field) {
  commit({ ...project, parts: project.parts.map((part) => (part.id === next.id ? next : part)) }, `${next.id}:${field}`);
}

function addPart() {
  const box = projectBounds(project.parts);
  const part = makePart({ x: box ? box.max.x + 50 : 0 });
  commit({ ...project, parts: [...project.parts, part] });
  select(part.id);
}

function duplicateSelected() {
  const part = selectedPart();
  if (!part) return;
  const copy = duplicatePart(part);
  const index = project.parts.indexOf(part);
  commit({ ...project, parts: [...project.parts.slice(0, index + 1), copy, ...project.parts.slice(index + 1)] });
  select(copy.id);
}

function deleteSelected() {
  if (!selectedId) return;
  commit({ ...project, parts: project.parts.filter((part) => part.id !== selectedId) });
  select(null);
}

const mm = (value) => `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const sizeText = (part) => `${mm(part.length)} × ${mm(part.width)} × ${mm(part.thickness)}`;

function renderParts() {
  const clashing = new Set(overlaps(project.parts).flat());
  $('parts').replaceChildren(
    ...project.parts.map((part) => {
      const selected = part.id === selectedId;
      const item = element('li', selected ? 'row sel' : 'row');
      item.id = `part-${part.id}`;
      const main = element('button', 'row-main');
      main.type = 'button';
      main.setAttribute('aria-pressed', String(selected));
      main.addEventListener('click', () => select(selected ? null : part.id));
      const swatch = element('i', 'sw');
      swatch.style.background = SPECIES[part.species].color;
      main.append(swatch, element('span', 'nm', part.name || 'Unnamed'), element('span', 'dim', sizeText(part)));
      if (clashing.has(part.id)) main.append(element('span', 'warn', 'Overlaps another board'));
      item.append(main);
      if (selected) {
        const actions = element('div', 'row-acts');
        const copy = element('button', '', 'Duplicate');
        copy.type = 'button';
        copy.addEventListener('click', duplicateSelected);
        const remove = element('button', 'danger', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', deleteSelected);
        actions.append(copy, remove);
        item.append(actions);
      }
      return item;
    }),
  );
  $('parts-empty').hidden = project.parts.length > 0;
  $('part-count').textContent = String(project.parts.length);
}

function renderSelectionChip() {
  const part = selectedPart();
  const chip = $('view-sel');
  chip.hidden = !part;
  if (!part) return;
  chip.replaceChildren(element('b', '', part.name || 'Unnamed'), ` · ${sizeText(part)}`);
}

function renderEditor() {
  const part = selectedPart();
  const form = $('editor');
  form.hidden = !part;
  $('editor-empty').hidden = Boolean(part);
  if (!part) return;
  for (const input of form.querySelectorAll('[name]')) {
    if (document.activeElement === input && input.dataset.partId === part.id) continue;
    input.value = String(part[input.name]);
    input.dataset.partId = part.id;
    input.removeAttribute('aria-invalid');
  }
  $('wood-swatch').style.background = SPECIES[part.species].color;
}

function renderCutList() {
  $('cut-rows').replaceChildren(
    ...cutList(project.parts).map((row) => {
      const tr = document.createElement('tr');
      const volume = (row.count * row.length * row.width * row.thickness) / 1e9;
      const face = (row.count * row.length * row.width) / 1e6;
      const cells = [
        [`${row.count} ×`, 'num'],
        [sizeText(row)],
        [row.names.join(', ')],
        [SPECIES[row.species].label],
        [`${volume.toFixed(4)} m³`, 'num'],
        [`${face.toFixed(2)} m²`, 'num'],
      ];
      for (const [text, className] of cells) tr.append(element('td', className, text));
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
    stat(String(sum.count), sum.count === 1 ? 'board' : 'boards'),
    stat(sum.volume.toFixed(4), 'm³ volume'),
    stat(sum.area.toFixed(2), 'm² face'),
    stat(`≈ ${sum.weight.toFixed(1)}`, 'kg'),
  );
  const box = projectBounds(project.parts);
  $('overall').textContent = box
    ? `Overall ${mm(box.max.x - box.min.x)} wide × ${mm(box.max.y - box.min.y)} high × ${mm(box.max.z - box.min.z)} deep (mm)`
    : '';
}

function render() {
  if (document.activeElement !== $('project-name')) $('project-name').value = project.name;
  document.title = `${project.name} · Woodworking planner`;
  view.setParts(project.parts);
  view.setSelected(selectedId);
  renderParts();
  renderEditor();
  renderSelectionChip();
  renderCutList();
  renderButtons();
}

function renderButtons() {
  $('undo').disabled = undoStack.length === 0;
  $('redo').disabled = redoStack.length === 0;
  $('duplicate').disabled = !selectedId;
  $('delete').disabled = !selectedId;
}

function fillSelect(select, options) {
  select.replaceChildren(...Object.entries(options).map(([value, label]) => new Option(label, value)));
}
fillSelect($('field-species'), Object.fromEntries(Object.entries(SPECIES).map(([key, { label }]) => [key, label])));
fillSelect($('field-orientation'), ORIENTATIONS);

$('editor').addEventListener('input', (event) => {
  const input = event.target;
  const part = selectedPart();
  if (!part || !input.name) return;
  const next = updatePart(part, input.name, input.value);
  if (!next) {
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  input.removeAttribute('aria-invalid');
  replacePart(next, input.name);
});
$('editor').addEventListener('submit', (event) => event.preventDefault());

$('project-name').addEventListener('change', (event) => {
  const name = event.target.value.trim().slice(0, 80) || 'Untitled project';
  if (name !== project.name) commit({ ...project, name });
});

$('add').addEventListener('click', addPart);
$('add-phone').addEventListener('click', () => {
  addPart();
  showTab('edit');
});

function showTab(name) {
  $('main').dataset.tab = name;
  for (const tab of document.querySelectorAll('.tabs [data-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
}
for (const tab of document.querySelectorAll('.tabs [data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

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
  if (event.target.closest('button')) setMenu(false);
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#bar')) setMenu(false);
});
$('duplicate').addEventListener('click', duplicateSelected);
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

document.addEventListener('keydown', (event) => {
  const typing = event.target.closest('input, textarea');
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (mod && event.key.toLowerCase() === 'y' && !typing) {
    event.preventDefault();
    redo();
  } else if (event.key === 'Escape' && selectedId) {
    if ($('editor').contains(document.activeElement)) document.activeElement.blur();
    select(null);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && selectedId) {
    event.preventDefault();
    deleteSelected();
  }
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => view.setTheme(darkQuery.matches);
darkQuery.addEventListener('change', applyTheme);
applyTheme();

render();
persist();
window.woodworkingPlanner = { get project() { return project; }, select };
