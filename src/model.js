export const FORMAT = 'woodworking-planner';
export const FORMAT_VERSION = 1;
export const MAX_SIZE_MM = 10000;

export const SPECIES = {
  pine: { label: 'Pine', color: '#d9b77e', density: 510 },
  spruce: { label: 'Spruce', color: '#e6cc98', density: 450 },
  oak: { label: 'Oak', color: '#b98a54', density: 720 },
  beech: { label: 'Beech', color: '#d6a77a', density: 720 },
  walnut: { label: 'Walnut', color: '#6e4b33', density: 640 },
  birchPlywood: { label: 'Birch plywood', color: '#e3c99f', density: 680 },
  mdf: { label: 'MDF', color: '#a88b6c', density: 750 },
};

export const ORIENTATIONS = {
  xzy: 'Lying flat, length left–right',
  zxy: 'Lying flat, length front–back',
  yzx: 'Standing, facing the side',
  yxz: 'Standing, facing the front',
  xyz: 'On edge, length left–right',
  zyx: 'On edge, length front–back',
};

const DIMENSIONS = ['length', 'width', 'thickness'];
const POSITION = ['x', 'y', 'z'];

export function extents(part) {
  const [lengthAxis, widthAxis, thicknessAxis] = part.orientation;
  return {
    [lengthAxis]: part.length,
    [widthAxis]: part.width,
    [thicknessAxis]: part.thickness,
  };
}

export function bounds(part) {
  const size = extents(part);
  return {
    min: { x: part.x, y: part.y, z: part.z },
    max: { x: part.x + size.x, y: part.y + size.y, z: part.z + size.z },
  };
}

export function projectBounds(parts) {
  if (parts.length === 0) return null;
  const all = parts.map(bounds);
  const pick = (side, fn) => Object.fromEntries(POSITION.map((axis) => [axis, fn(...all.map((b) => b[side][axis]))]));
  return { min: pick('min', Math.min), max: pick('max', Math.max) };
}

export function overlaps(parts) {
  const boxes = parts.map(bounds);
  const pairs = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (POSITION.every((axis) => a.min[axis] < b.max[axis] && b.min[axis] < a.max[axis])) {
        pairs.push([parts[i].id, parts[j].id]);
      }
    }
  }
  return pairs;
}

export function cutList(parts) {
  const groups = new Map();
  for (const part of parts) {
    const key = [part.species, part.length, part.width, part.thickness].join('|');
    const group = groups.get(key) ?? {
      species: part.species,
      length: part.length,
      width: part.width,
      thickness: part.thickness,
      count: 0,
      names: [],
    };
    group.count += 1;
    if (!group.names.includes(part.name)) group.names.push(part.name);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.species.localeCompare(b.species) || b.thickness - a.thickness || b.length - a.length || b.width - a.width,
  );
}

export function totals(parts) {
  let volume = 0;
  let area = 0;
  let weight = 0;
  for (const part of parts) {
    const partVolume = (part.length * part.width * part.thickness) / 1e9;
    volume += partVolume;
    area += (part.length * part.width) / 1e6;
    weight += partVolume * SPECIES[part.species].density;
  }
  return { count: parts.length, volume, area, weight };
}

let lastId = 0;
export function newId() {
  lastId += 1;
  return `p${Date.now().toString(36)}${lastId.toString(36)}`;
}

export function makePart(fields = {}) {
  return {
    id: newId(),
    name: 'Board',
    length: 600,
    width: 200,
    thickness: 18,
    orientation: 'xzy',
    species: 'pine',
    locked: false,
    x: 0,
    y: 0,
    z: 0,
    ...fields,
  };
}

const GEOMETRY = [...DIMENSIONS, ...POSITION, 'orientation'];
const inReach = (value) => Number.isFinite(value) && Math.abs(value) <= MAX_SIZE_MM;
const fitsLimits = (part) => POSITION.every((axis) => inReach(part[axis]));
const BESIDE_GAP_MM = 50;

export function newPartBeside(parts) {
  const fresh = makePart();
  const box = projectBounds(parts);
  if (!box) return fresh;
  const x = [box.max.x + BESIDE_GAP_MM, box.min.x - BESIDE_GAP_MM - fresh.length, 0].find(inReach);
  return { ...fresh, x };
}

export function updatePart(part, field, raw) {
  if (field === 'locked') return typeof raw === 'boolean' ? { ...part, locked: raw } : null;
  if (part.locked && GEOMETRY.includes(field)) return null;
  if (DIMENSIONS.includes(field)) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SIZE_MM) return null;
    return { ...part, [field]: roundMm(value) };
  }
  if (POSITION.includes(field)) {
    const value = Number(raw);
    if (raw === '' || !inReach(value)) return null;
    return { ...part, [field]: roundMm(value) };
  }
  if (field === 'orientation') return raw in ORIENTATIONS ? { ...part, orientation: raw } : null;
  if (field === 'species') return raw in SPECIES ? { ...part, species: raw } : null;
  if (field === 'name') return { ...part, name: String(raw).slice(0, 80) };
  return null;
}

export function duplicatePart(part) {
  const size = extents(part);
  const step = part.orientation[2];
  const spot = [part[step] + size[step] + 20, part[step] - size[step] - 20].find(inReach);
  return spot === undefined ? part : { ...part, id: newId(), locked: false, [step]: spot };
}

function roundMm(value) {
  return Math.round(value * 10) / 10;
}

export function serialize(project) {
  return JSON.stringify(
    {
      format: FORMAT,
      version: FORMAT_VERSION,
      name: project.name,
      parts: project.parts.map(({ id, ...rest }) => rest),
    },
    null,
    2,
  );
}

export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a project: it is not valid JSON.');
  }
  if (data?.format !== FORMAT) throw new Error('This file is not a Woodworking planner project.');
  if (data.version > FORMAT_VERSION) throw new Error('This project was saved by a newer version of the app.');
  if (!Array.isArray(data.parts)) throw new Error('This project has no list of parts.');
  const parts = data.parts.map((raw, index) => {
    let part = makePart();
    for (const field of ['name', ...GEOMETRY, 'species', 'locked']) {
      if (raw?.[field] === undefined) continue;
      part = updatePart(part, field, raw[field]);
      if (!part) throw new Error(`Part ${index + 1} has an invalid ${field}.`);
    }
    return part;
  });
  return { name: typeof data.name === 'string' && data.name.trim() ? data.name.slice(0, 80) : 'Untitled project', parts };
}

export function starterProject() {
  const sheet = 18;
  const depth = 244;
  const width = 800;
  const height = 1000;
  const inner = width - 2 * sheet;
  const gap = (height - 4 * sheet) / 3;
  const shelf = (name, y) =>
    makePart({ name, length: inner, width: depth, thickness: sheet, orientation: 'xzy', x: sheet, y: roundMm(y), z: 6 });
  return {
    name: 'Small bookshelf',
    parts: [
      makePart({ name: 'Back panel', length: height, width, thickness: 6, orientation: 'yxz', species: 'birchPlywood' }),
      makePart({ name: 'Side', length: height, width: depth, thickness: sheet, orientation: 'yzx', z: 6 }),
      makePart({ name: 'Side', length: height, width: depth, thickness: sheet, orientation: 'yzx', x: width - sheet, z: 6 }),
      shelf('Bottom', 0),
      shelf('Shelf', sheet + gap),
      shelf('Shelf', 2 * (sheet + gap)),
      shelf('Top', height - sheet),
    ],
  };
}

export const SNAP_GRID_MM = 10;
export const SNAP_REACH_MM = 15;

export function snapPosition(part, proposed, others, { snap = true } = {}) {
  const size = extents(part);
  const result = {};
  for (const axis of POSITION) {
    if (!(axis in proposed)) continue;
    const value = proposed[axis];
    if (!snap) {
      result[axis] = roundMm(value);
      continue;
    }
    let best = null;
    const consider = (target) => {
      const distance = Math.abs(target - value);
      if (distance <= SNAP_REACH_MM && (best === null || distance < Math.abs(best - value))) best = target;
    };
    if (axis === 'y') consider(0);
    for (const other of others) {
      if (other.id === part.id) continue;
      const box = bounds(other);
      for (const face of [box.min[axis], box.max[axis]]) {
        consider(face);
        consider(face - size[axis]);
      }
    }
    result[axis] = roundMm(best ?? Math.round(value / SNAP_GRID_MM) * SNAP_GRID_MM);
  }
  if ('y' in result && result.y < 0 && snap) result.y = 0;
  return result;
}

export function movePart(part, position) {
  if (part.locked) return part;
  const next = { ...part };
  for (const axis of POSITION) {
    if (!(axis in position)) continue;
    const value = roundMm(position[axis]);
    if (!inReach(value)) return part;
    next[axis] = value;
  }
  return next;
}

export function rotatePart(part, axis) {
  if (part.locked) return part;
  const [a, b] = POSITION.filter((other) => other !== axis);
  const orientation = [...part.orientation].map((letter) => (letter === a ? b : letter === b ? a : letter)).join('');
  const before = extents(part);
  const turned = { ...part, orientation };
  const after = extents(turned);
  for (const dim of POSITION) turned[dim] = roundMm(part[dim] + (before[dim] - after[dim]) / 2);
  if (part.y >= 0 && turned.y < 0) turned.y = 0;
  return fitsLimits(turned) ? turned : part;
}
