import { parseProject, serialize } from './project.js';

const KEY = 'woodworking-planner:project';
const UNREADABLE_KEY = 'woodworking-planner:unreadable-project';
const SNAP_KEY = 'woodworking-planner:snap';

export function loadSnap() {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'off';
  } catch {
    return true;
  }
}

const DEBUG_KEY = 'woodworking-planner:debug';
const POTATO_KEY = 'woodworking-planner:potato';

export function loadPotato() {
  try {
    return localStorage.getItem(POTATO_KEY) === 'on';
  } catch {
    return false;
  }
}

export function savePotato(on) {
  try {
    localStorage.setItem(POTATO_KEY, on ? 'on' : 'off');
  } catch {}
}

export function loadDebug() {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveDebug(on) {
  try {
    localStorage.setItem(DEBUG_KEY, on ? 'on' : 'off');
  } catch {}
}

const CUT_VIEW_KEY = 'woodworking-planner:cut-view';

export function loadCutView() {
  try {
    return localStorage.getItem(CUT_VIEW_KEY) === 'plan' ? 'plan' : 'list';
  } catch {
    return 'list';
  }
}

export function saveCutView(view) {
  try {
    localStorage.setItem(CUT_VIEW_KEY, view);
  } catch {}
}

export function saveSnap(on) {
  try {
    localStorage.setItem(SNAP_KEY, on ? 'on' : 'off');
  } catch {}
}

export function loadSaved() {
  let text;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return { project: null, error: null };
  }
  if (!text) return { project: null, error: null };
  try {
    return { project: parseProject(text), error: null };
  } catch (error) {
    return { project: null, error: error.message, kept: keepUnreadable(text) };
  }
}

function keepUnreadable(text) {
  try {
    localStorage.setItem(UNREADABLE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function save(project) {
  try {
    localStorage.setItem(KEY, serialize(project));
    return true;
  } catch {
    return false;
  }
}

const LETTERS_WITHOUT_ACCENT_MARKS = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', ħ: 'h', ŧ: 't', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' };

export function fileName(project) {
  const slug = project.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u0000-\u007f]/g, (letter) => LETTERS_WITHOUT_ACCENT_MARKS[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'project'}.woodplan.json`;
}

export function download(project) {
  const url = URL.createObjectURL(new Blob([serialize(project)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName(project) });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readFile(file) {
  return parseProject(await file.text());
}
