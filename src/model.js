export const FORMAT = 'woodworking-planner';
export const FORMAT_VERSION = 2;
export const MAX_SIZE_MM = 10000;
export const MAX_RADIUS_MM = MAX_SIZE_MM / 2;
export const MAX_SWEEP_DEG = 360;
export const MIN_SWEEP_DEG = 1;

export const SHAPES = {
  board: 'Board',
  disc: 'Disc',
  dowel: 'Dowel',
  arc: 'Arc',
  triangle: 'Triangle',
};

export const CORNER_STYLES = { square: 'Square', rounded: 'Rounded', cut: 'Cut' };

export const CORNERS = {
  cornerTopLeft: 'Top left',
  cornerTopRight: 'Top right',
  cornerBottomLeft: 'Bottom left',
  cornerBottomRight: 'Bottom right',
};

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

const SIZES = ['length', 'width', 'thickness', 'diameter', 'dowelDiameter', 'outerRadius', 'bandWidth', 'cornerRadius', 'cutLength', 'cutWidth'];
const POSITION = ['x', 'y', 'z'];
const SIZE_LIMITS = { outerRadius: MAX_RADIUS_MM };
const ARC_STEP_DEG = 4;

const radians = (degrees) => (degrees * Math.PI) / 180;

export function cornersActive(part) {
  return part.shape === 'board' && part.corners !== 'square' && Object.keys(CORNERS).some((corner) => part[corner]);
}

export function blank(part) {
  if (part.shape === 'disc') return { length: part.diameter, width: part.diameter, thickness: part.thickness };
  if (part.shape === 'dowel') return { length: part.length, width: part.dowelDiameter, thickness: part.dowelDiameter };
  if (part.shape === 'arc') {
    const box = arcBox(part);
    return { length: roundMm(box.maxX - box.minX), width: roundMm(box.maxY - box.minY), thickness: part.thickness };
  }
  return { length: part.length, width: part.width, thickness: part.thickness };
}

function arcAngles(from, to) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const stops = [low];
  for (let quarter = Math.floor(low / 90) * 90 + 90; quarter < high; quarter += 90) stops.push(quarter);
  stops.push(high);
  const angles = stops.flatMap((stop, i) => {
    if (i === 0) return [stop];
    const start = stops[i - 1];
    const steps = Math.max(1, Math.ceil((stop - start) / ARC_STEP_DEG));
    return Array.from({ length: steps }, (_, step) => start + ((stop - start) * (step + 1)) / steps);
  });
  return from <= to ? angles : angles.reverse();
}

function arcPoints(cx, cy, radius, from, to) {
  return arcAngles(from, to).map((degrees) => [cx + radius * Math.cos(radians(degrees)), cy + radius * Math.sin(radians(degrees))]);
}

const sweepRange = (part) => [90 - part.sweep / 2, 90 + part.sweep / 2];

function arcBox(part) {
  const [from, to] = sweepRange(part);
  const points = [
    ...arcPoints(0, 0, part.outerRadius, from, to),
    ...arcPoints(0, 0, part.outerRadius - part.bandWidth, from, to),
  ];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function withoutRepeats(points) {
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  const kept = points.filter((point, i) => i === 0 || !same(point, points[i - 1]));
  return kept.length > 1 && same(kept[0], kept.at(-1)) ? kept.slice(0, -1) : kept;
}

const CORNER_WALK = [
  ['cornerBottomLeft', -1, -1, 180],
  ['cornerBottomRight', 1, -1, 270],
  ['cornerTopRight', 1, 1, 0],
  ['cornerTopLeft', -1, 1, 90],
];

function boardOutline(part) {
  const halfL = part.length / 2;
  const halfW = part.width / 2;
  const active = cornersActive(part);
  const points = CORNER_WALK.flatMap(([corner, sx, sy, start]) => {
    if (!active || !part[corner]) return [[sx * halfL, sy * halfW]];
    if (part.corners === 'rounded') {
      const r = part.cornerRadius;
      return arcPoints(sx * (halfL - r), sy * (halfW - r), r, start, start + 90);
    }
    const alongLength = [sx * (halfL - part.cutLength), sy * halfW];
    const alongWidth = [sx * halfL, sy * (halfW - part.cutWidth)];
    return sx * sy > 0 ? [alongWidth, alongLength] : [alongLength, alongWidth];
  });
  return withoutRepeats(points);
}

function arcOutline(part) {
  const box = arcBox(part);
  const cx = -(box.minX + box.maxX) / 2;
  const cy = -(box.minY + box.maxY) / 2;
  const inner = part.outerRadius - part.bandWidth;
  if (part.sweep >= MAX_SWEEP_DEG) {
    return {
      points: withoutRepeats(arcPoints(cx, cy, part.outerRadius, 0, 360)),
      holes: [withoutRepeats(arcPoints(cx, cy, inner, 360, 0))],
    };
  }
  const [from, to] = sweepRange(part);
  return { points: [...arcPoints(cx, cy, part.outerRadius, from, to), ...arcPoints(cx, cy, inner, to, from)], holes: [] };
}

export function outline(part) {
  const size = blank(part);
  const halfL = size.length / 2;
  const halfW = size.width / 2;
  if (part.shape === 'disc') return { points: withoutRepeats(arcPoints(0, 0, part.diameter / 2, 0, 360)), holes: [] };
  if (part.shape === 'arc') return arcOutline(part);
  if (part.shape === 'triangle') return { points: [[-halfL, -halfW], [halfL, -halfW], [-halfL, halfW]], holes: [] };
  if (part.shape === 'board') return { points: boardOutline(part), holes: [] };
  return { points: [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]], holes: [] };
}

export function cornerCount(part) {
  return cornersActive(part) ? Object.keys(CORNERS).filter((corner) => part[corner]).length : 0;
}

export function cornerLayout(part) {
  if (cornerCount(part) !== 2) return null;
  const { cornerTopLeft: tl, cornerTopRight: tr, cornerBottomLeft: bl } = part;
  if (tl === tr) return 'same side';
  if (tl === bl) return 'same end';
  return 'opposite corners';
}

export function faceArea(part) {
  if (part.shape === 'disc') return (Math.PI * part.diameter ** 2) / 4;
  if (part.shape === 'dowel') return part.length * part.dowelDiameter;
  if (part.shape === 'triangle') return (part.length * part.width) / 2;
  if (part.shape === 'arc') {
    const inner = part.outerRadius - part.bandWidth;
    return (Math.PI * (part.outerRadius ** 2 - inner ** 2) * part.sweep) / 360;
  }
  const count = cornerCount(part);
  const lost =
    part.corners === 'rounded' ? part.cornerRadius ** 2 * (1 - Math.PI / 4) : (part.cutLength * part.cutWidth) / 2;
  return part.length * part.width - count * lost;
}

export function pieceVolume(part) {
  if (part.shape === 'dowel') return (Math.PI * part.dowelDiameter ** 2 * part.length) / 4;
  return faceArea(part) * part.thickness;
}

export function extents(part) {
  const [lengthAxis, widthAxis, thicknessAxis] = part.orientation;
  const size = blank(part);
  return {
    [lengthAxis]: size.length,
    [widthAxis]: size.width,
    [thicknessAxis]: size.thickness,
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

function shapeKey(part) {
  if (part.shape === 'disc' || part.shape === 'dowel' || part.shape === 'triangle') return part.shape;
  if (part.shape === 'arc') return ['arc', part.outerRadius, part.bandWidth, part.sweep].join(':');
  if (!cornersActive(part)) return 'board';
  const size = part.corners === 'rounded' ? part.cornerRadius : `${part.cutLength}:${part.cutWidth}`;
  return ['board', part.corners, size, cornerCount(part), cornerLayout(part)].join(':');
}

export function cutList(parts) {
  const groups = new Map();
  for (const part of parts) {
    const size = blank(part);
    const key = [part.species, size.length, size.width, size.thickness, shapeKey(part)].join('|');
    const group = groups.get(key) ?? {
      species: part.species,
      shape: part.shape,
      ...size,
      piece: part,
      area: faceArea(part),
      volume: pieceVolume(part),
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
    const partVolume = pieceVolume(part) / 1e9;
    volume += partVolume;
    area += faceArea(part) / 1e6;
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
    shape: 'board',
    length: 600,
    width: 200,
    thickness: 18,
    corners: 'square',
    cornerTopLeft: true,
    cornerTopRight: true,
    cornerBottomLeft: true,
    cornerBottomRight: true,
    cornerRadius: 20,
    cutLength: 50,
    cutWidth: 50,
    diameter: 400,
    dowelDiameter: 30,
    outerRadius: 400,
    bandWidth: 60,
    sweep: 90,
    orientation: 'xzy',
    species: 'pine',
    locked: false,
    x: 0,
    y: 0,
    z: 0,
    ...fields,
  };
}

const SHAPE_DEFAULTS = {
  board: {},
  disc: {},
  dowel: { length: 450 },
  arc: {},
  triangle: { length: 200, width: 200 },
};

export function makeShape(shape = 'board') {
  return makePart({ name: SHAPES[shape], shape, ...SHAPE_DEFAULTS[shape] });
}

const SWITCHES = ['shape', 'corners', ...Object.keys(CORNERS)];
const GEOMETRY = [...SIZES, 'sweep', ...SWITCHES, ...POSITION, 'orientation'];
const inReach = (value) => Number.isFinite(value) && Math.abs(value) <= MAX_SIZE_MM;
const fitsLimits = (part) => POSITION.every((axis) => inReach(part[axis]));
const BESIDE_GAP_MM = 50;

export function newPartBeside(parts, shape = 'board') {
  const fresh = makeShape(shape);
  const box = projectBounds(parts);
  if (!box) return fresh;
  const x = [box.max.x + BESIDE_GAP_MM, box.min.x - BESIDE_GAP_MM - extents(fresh).x, 0].find(inReach);
  return { ...fresh, x };
}

const NOT_ALLOWED = Symbol('not allowed');

function fieldValue(field, raw) {
  if (SIZES.includes(field)) {
    const value = roundMm(Number(raw));
    return raw !== '' && Number.isFinite(value) && value > 0 && value <= (SIZE_LIMITS[field] ?? MAX_SIZE_MM) ? value : NOT_ALLOWED;
  }
  if (POSITION.includes(field)) {
    const value = Number(raw);
    return raw !== '' && inReach(value) ? roundMm(value) : NOT_ALLOWED;
  }
  if (field === 'sweep') {
    const value = roundMm(Number(raw));
    return raw !== '' && value >= MIN_SWEEP_DEG && value <= MAX_SWEEP_DEG ? value : NOT_ALLOWED;
  }
  if (field === 'locked' || field in CORNERS) return typeof raw === 'boolean' ? raw : NOT_ALLOWED;
  const choices = { orientation: ORIENTATIONS, species: SPECIES, shape: SHAPES, corners: CORNER_STYLES }[field];
  if (choices) return Object.hasOwn(choices, raw) ? raw : NOT_ALLOWED;
  if (field === 'name') return String(raw).slice(0, 80);
  return NOT_ALLOWED;
}

export function shapeProblem(part) {
  if (part.bandWidth >= part.outerRadius) return 'bandWidth';
  if (!cornersActive(part)) return null;
  if (part.corners === 'rounded' && part.cornerRadius > Math.min(part.length, part.width) / 2) return 'cornerRadius';
  if (part.corners === 'cut' && part.cutLength > part.length / 2) return 'cutLength';
  if (part.corners === 'cut' && part.cutWidth > part.width / 2) return 'cutWidth';
  return null;
}

const floorMm = (value) => Math.max(0.1, Math.floor(value * 10) / 10);

function fitCorners(part) {
  if (!cornersActive(part)) return part;
  return {
    ...part,
    cornerRadius: Math.min(part.cornerRadius, floorMm(Math.min(part.length, part.width) / 2)),
    cutLength: Math.min(part.cutLength, floorMm(part.length / 2)),
    cutWidth: Math.min(part.cutWidth, floorMm(part.width / 2)),
  };
}

export function updatePart(part, field, raw) {
  if (part.locked && GEOMETRY.includes(field)) return null;
  const value = fieldValue(field, raw);
  if (value === NOT_ALLOWED) return null;
  let next = { ...part, [field]: value };
  if (field === 'shape' && part.name === SHAPES[part.shape]) next.name = SHAPES[value];
  if (SWITCHES.includes(field)) next = fitCorners(next);
  return shapeProblem(next) ? null : next;
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
    const part = makePart();
    for (const field of ['name', ...GEOMETRY, 'species', 'locked']) {
      if (raw?.[field] === undefined) continue;
      const value = fieldValue(field, raw[field]);
      if (value === NOT_ALLOWED) throw new Error(`Part ${index + 1} has an invalid ${field}.`);
      part[field] = value;
    }
    const problem = shapeProblem(part);
    if (problem) throw new Error(`Part ${index + 1} has an invalid ${problem}.`);
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
