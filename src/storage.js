import { parseProject, serialize } from './model.js';

const KEY = 'woodworking-planner:project';

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
