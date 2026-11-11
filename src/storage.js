import { parseProject, serialize } from './model.js';

const KEY = 'woodworking-planner:project';
const SNAP_KEY = 'woodworking-planner:snap';

export function loadSnap() {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'off';
  } catch {
    return true;
  }
}

const DEBUG_KEY = 'woodworking-planner:debug';

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

export function saveSnap(on) {
  try {
    localStorage.setItem(SNAP_KEY, on ? 'on' : 'off');
  } catch {}
}

export function loadSaved() {
  try {
    const text = localStorage.getItem(KEY);
    return text ? parseProject(text) : null;
  } catch {
    return null;
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

export function fileName(project) {
  const slug = project.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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
