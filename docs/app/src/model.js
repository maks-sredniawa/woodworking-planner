import { MAX_POINTS, MIN_POINTS, area, arcBend, box, halfEdge, outlineProblem, point, polygon, rebase, scale } from './free.js';
import { TOUCH_MM, convexParts, moveSolid, placeSolid, prism, solidsClash, sweepSpans } from './geometry.js';

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
  free: 'Free shape',
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

const AXES = ['x', 'y', 'z'];
const SIGNED_AXES = AXES.flatMap((axis) => [`+${axis}`, `-${axis}`]);
const sign = (signed) => (signed[0] === '-' ? -1 : 1);
const negate = (signed) => `${signed[0] === '-' ? '+' : '-'}${signed[1]}`;
const isCyclic = (a, b) => (AXES.indexOf(b) - AXES.indexOf(a) + 3) % 3 === 1;

export function poseAxes(pose) {
  return { length: pose.slice(0, 2), width: pose.slice(2, 4), thickness: pose.slice(4, 6) };
}

function handedness(first, second, third) {
  const axes = [first[1], second[1], third[1]];
  const even = isCyclic(axes[0], axes[1]) && isCyclic(axes[1], axes[2]);
  return sign(first) * sign(second) * sign(third) * (even ? 1 : -1);
}

export const POSES = SIGNED_AXES.flatMap((length) =>
  SIGNED_AXES.flatMap((width) =>
    SIGNED_AXES.filter(
      (thickness) =>
        new Set([length[1], width[1], thickness[1]]).size === 3 && handedness(length, width, thickness) === 1,
    ).map((thickness) => length + width + thickness),
  ),
);

export function legacyPose(orientation) {
  const [length, width, thickness] = [...orientation].map((axis) => `+${axis}`);
  return length + (handedness(length, width, thickness) === 1 ? width : negate(width)) + thickness;
}

export const LIES = Object.fromEntries(Object.entries(ORIENTATIONS).map(([orientation, label]) => [legacyPose(orientation), label]));

function liesLike(pose) {
  const axes = (each) => Object.values(poseAxes(each)).map((signed) => signed[1]).join('');
  return Object.keys(LIES).find((canonical) => axes(canonical) === axes(pose));
}

const HALF_TURNS = { thickness: 'spun half a turn', length: 'rolled over', width: 'flipped end over end' };

export function poseHalfTurn(pose) {
  const canonical = liesLike(pose);
  if (canonical === pose) return null;
  const kept = Object.keys(HALF_TURNS).find((side) => poseAxes(pose)[side] === poseAxes(canonical)[side]);
  return { lies: LIES[canonical], turn: HALF_TURNS[kept] };
}

export function describePose(pose) {
  const half = poseHalfTurn(pose);
  return half ? `${half.lies}, ${half.turn}` : LIES[pose];
}

function vector(signed) {
  return AXES.map((axis) => (axis === signed[1] ? sign(signed) : 0));
}

// The scene lays each outline flat with rotateX(-90°), which sends the outline's width along local −Z.
export function sceneBasis(pose) {
  const { length, width, thickness } = poseAxes(pose);
  return [vector(length), vector(thickness), vector(negate(width))];
}

export function turnAxis(signed, axis) {
  if (signed[1] === axis) return signed;
  const third = AXES.find((other) => other !== axis && other !== signed[1]);
  return `${sign(signed) * (isCyclic(axis, signed[1]) ? 1 : -1) > 0 ? '+' : '-'}${third}`;
}

const SIZES = ['length', 'width', 'thickness', 'diameter', 'dowelDiameter', 'outerRadius', 'bandWidth', 'cornerRadius', 'cutLength', 'cutWidth'];
const POSITION = AXES;
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

function arcAngles(from, to, stepDeg = ARC_STEP_DEG) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const stops = [low];
  for (let quarter = Math.floor(low / 90) * 90 + 90; quarter < high; quarter += 90) stops.push(quarter);
  stops.push(high);
  const angles = stops.flatMap((stop, i) => {
    if (i === 0) return [stop];
    const start = stops[i - 1];
    const steps = Math.max(1, Math.ceil((stop - start) / stepDeg));
    return Array.from({ length: steps }, (_, step) => start + ((stop - start) * (step + 1)) / steps);
  });
  return from <= to ? angles : angles.reverse();
}

function arcPoints(cx, cy, radius, from, to) {
  return arcAngles(from, to).map((degrees) => [cx + radius * Math.cos(radians(degrees)), cy + radius * Math.sin(radians(degrees))]);
}

export const CURVE_TOLERANCE_MM = 0.4;

// Curves bulging out of the piece are sampled on the curve and curves bulging into it on tangents, so the polygon never reaches past the true piece.
function finePoints(cx, cy, radius, from, to, concave = false) {
  const halfStep = concave ? Math.acos(radius / (radius + CURVE_TOLERANCE_MM)) : Math.acos(1 - CURVE_TOLERANCE_MM / radius);
  const tangents = arcAngles(from, to, (2 * halfStep * 180) / Math.PI);
  const at = (degrees, reach = radius) => [cx + reach * Math.cos(radians(degrees)), cy + reach * Math.sin(radians(degrees))];
  if (!concave) return tangents.map((degrees) => at(degrees));
  const corners = tangents.slice(1).map((degrees, i) => {
    const half = (degrees - tangents[i]) / 2;
    return at(tangents[i] + half, radius / Math.cos(radians(half)));
  });
  return [at(from), ...corners, at(to)];
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

function boardOutline(part, curve) {
  const halfL = part.length / 2;
  const halfW = part.width / 2;
  const active = cornersActive(part);
  const points = CORNER_WALK.flatMap(([corner, sx, sy, start]) => {
    if (!active || !part[corner]) return [[sx * halfL, sy * halfW]];
    if (part.corners === 'rounded') {
      const r = part.cornerRadius;
      return curve(sx * (halfL - r), sy * (halfW - r), r, start, start + 90);
    }
    const alongLength = [sx * (halfL - part.cutLength), sy * halfW];
    const alongWidth = [sx * halfL, sy * (halfW - part.cutWidth)];
    return sx * sy > 0 ? [alongWidth, alongLength] : [alongLength, alongWidth];
  });
  return withoutRepeats(points);
}

function arcOutline(part, curve) {
  const box = arcBox(part);
  const cx = -(box.minX + box.maxX) / 2;
  const cy = -(box.minY + box.maxY) / 2;
  const inner = part.outerRadius - part.bandWidth;
  if (part.sweep >= MAX_SWEEP_DEG) {
    return {
      points: withoutRepeats(curve(cx, cy, part.outerRadius, 0, 360)),
      holes: [withoutRepeats(curve(cx, cy, inner, 360, 0, true))],
    };
  }
  const [from, to] = sweepRange(part);
  return { points: withoutRepeats([...curve(cx, cy, part.outerRadius, from, to), ...curve(cx, cy, inner, to, from, true)]), holes: [] };
}

function freeOutline(part) {
  const corners = polygon(part.points);
  const size = box(part.points);
  const cx = (size.minX + size.maxX) / 2;
  const cy = (size.minY + size.maxY) / 2;
  return { points: withoutRepeats(corners.map(([x, y]) => [x - cx, y - cy])), holes: [] };
}

function shapeOutline(part, curve) {
  if (part.shape === 'free') return freeOutline(part);
  const size = blank(part);
  const halfL = size.length / 2;
  const halfW = size.width / 2;
  if (part.shape === 'disc') return { points: withoutRepeats(curve(0, 0, part.diameter / 2, 0, 360)), holes: [] };
  if (part.shape === 'arc') return arcOutline(part, curve);
  if (part.shape === 'triangle') return { points: [[-halfL, -halfW], [halfL, -halfW], [-halfL, halfW]], holes: [] };
  if (part.shape === 'board') return { points: boardOutline(part, curve), holes: [] };
  return { points: [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]], holes: [] };
}

export function outline(part) {
  return shapeOutline(part, arcPoints);
}

function crossSection(part) {
  if (part.shape === 'dowel') {
    return {
      outline: { points: withoutRepeats(finePoints(0, 0, part.dowelDiameter / 2, 0, 360)), holes: [] },
      axes: ['width', 'thickness', 'length'],
    };
  }
  return { outline: shapeOutline(part, finePoints), axes: ['length', 'width', 'thickness'] };
}

const OUTLINE_FIELDS = ['shape', 'length', 'width', 'thickness', 'diameter', 'dowelDiameter', 'outerRadius', 'bandWidth', 'sweep', 'corners', ...Object.keys(CORNERS), 'cornerRadius', 'cutLength', 'cutWidth', 'points'];
const crossSections = new Map();

function convexCrossSection(part) {
  const key = JSON.stringify(OUTLINE_FIELDS.map((field) => part[field]));
  if (!crossSections.has(key)) {
    if (crossSections.size > 500) crossSections.clear();
    const { outline: shape, axes } = crossSection(part);
    const depth = blank(part)[axes[2]];
    crossSections.set(key, { pieces: convexParts(shape).map((polygon) => prism(polygon, depth)), axes });
  }
  return crossSections.get(key);
}

const placed = (placement, point) => placement.m.reduce((out, value, i) => {
  out[Math.floor(i / 3)] += value * point[i % 3];
  return out;
}, [...placement.o]);
const turned = (placement, vector) => placed({ ...placement, o: [0, 0, 0] }, vector);
const isIdentity = (placement) =>
  !placement || (placement.m.every((value, i) => Math.abs(value - (i % 4 === 0 ? 1 : 0)) < 1e-9) && placement.o.every((value) => Math.abs(value) < 1e-9));
const solids = new WeakMap();

export function solidOf(part, placement = null) {
  const still = isIdentity(placement);
  if (still && solids.has(part)) return solids.get(part);
  const { pieces, axes } = convexCrossSection(part);
  const size = extents(part);
  const pose = poseAxes(part.pose);
  const [u, v, w] = axes.map((side) => vector(pose[side]));
  const centre = AXES.map((axis) => part[axis] + size[axis] / 2);
  const frame = still
    ? { origin: centre, u, v, w }
    : { origin: placed(placement, centre), u: turned(placement, u), v: turned(placement, v), w: turned(placement, w) };
  const result = placeSolid(pieces, frame);
  if (still) solids.set(part, result);
  return result;
}

function boardPoints(part) {
  const halfL = part.length / 2;
  const halfW = part.width / 2;
  const shaped = part.shape === 'board' && cornersActive(part);
  const corners = CORNER_WALK.flatMap(([corner, sx, sy]) => {
    if (!shaped || !part[corner]) return [point(sx * halfL, sy * halfW)];
    if (part.corners === 'rounded') {
      const r = part.cornerRadius;
      const first = sx * sy < 0 ? point(sx * (halfL - r), sy * halfW, arcBend(r, Math.PI / 2)) : point(sx * halfL, sy * (halfW - r), arcBend(r, Math.PI / 2));
      const second = sx * sy < 0 ? point(sx * halfL, sy * (halfW - r)) : point(sx * (halfL - r), sy * halfW);
      return [first, second];
    }
    const alongLength = point(sx * (halfL - part.cutLength), sy * halfW);
    const alongWidth = point(sx * halfL, sy * (halfW - part.cutWidth));
    return sx * sy > 0 ? [alongWidth, alongLength] : [alongLength, alongWidth];
  });
  const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  return corners.filter((each, i) => !same(each, corners[(i + 1) % corners.length]));
}

function ringPoints(radius, from, to, inward) {
  const steps = Math.ceil(Math.abs(to - from) / 90 - 1e-9);
  const step = (to - from) / steps;
  const bend = (inward ? -1 : 1) * arcBend(radius, radians(Math.abs(step)));
  const at = (degrees, curve) => point(radius * Math.cos(radians(degrees)), radius * Math.sin(radians(degrees)), curve);
  return [...Array.from({ length: steps }, (_, k) => at(from + k * step, bend)), at(to, 0)];
}

function freePointsOf(part) {
  if (part.shape === 'disc') return ringPoints(part.diameter / 2, 270, 270 + 360, false).slice(0, -1);
  if (part.shape === 'arc') {
    const [from, to] = sweepRange(part);
    return [...ringPoints(part.outerRadius, from, to, false), ...ringPoints(part.outerRadius - part.bandWidth, to, from, true)];
  }
  if (part.shape === 'triangle') {
    const halfL = part.length / 2;
    const halfW = part.width / 2;
    return [point(-halfL, -halfW), point(halfL, -halfW), point(-halfL, halfW)];
  }
  if (part.shape === 'dowel') return boardPoints({ ...part, width: part.dowelDiameter });
  return boardPoints(part);
}

function withOutline(part, points) {
  const size = box(points);
  return { ...part, points, length: roundMm(size.maxX - size.minX), width: roundMm(size.maxY - size.minY) };
}

const FIT_TRIES = 12;

// Bent edges bulge past their points, so the scale is refined until the outline's blank lands on the asked sizes.
function fitTo(part, points, length, width) {
  const exact = withOutline(part, rebase(points));
  if (exact.length === length && exact.width === width) return exact;
  let [sx, sy] = [length / exact.length, width / exact.width];
  let best = null;
  for (let tries = 0; tries < FIT_TRIES && Number.isFinite(sx * sy) && sx * sy > 0; tries++) {
    const next = withOutline(part, rebase(scale(points, sx, sy)));
    const miss = Math.abs(next.length - length) + Math.abs(next.width - width);
    if (!best || miss < best.miss) best = { next, miss };
    if (miss < 0.05 || !next.length || !next.width) break;
    [sx, sy] = [(sx * length) / next.length, (sy * width) / next.width];
  }
  return best?.next ?? exact;
}

const stretched = (part, field, value) => fitTo(part, part.points, field === 'length' ? value : part.length, field === 'width' ? value : part.width);

const fullRing = (part) => part.shape === 'arc' && part.sweep >= MAX_SWEEP_DEG;

function toFree(part, next) {
  const kept = part.points && fitTo(next, part.points, next.length, next.width);
  if (kept && !shapeProblem(kept)) return kept;
  if (fullRing(part)) return null;
  const sized = part.shape === 'dowel' ? { ...next, thickness: part.dowelDiameter } : next;
  return withOutline(sized, rebase(freePointsOf(part)));
}

export function freeSwitchProblem(part) {
  if (fullRing(part)) return 'ring';
  return outlineProblem(rebase(freePointsOf(part)), MAX_SIZE_MM)?.kind ?? null;
}

export function stretchProblem(part, field, value) {
  if (part.shape !== 'free') return null;
  return outlineProblem(stretched(part, field, value).points, MAX_SIZE_MM)?.kind ?? null;
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
  if (part.shape === 'free') return area(part.points);
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
  const { length, width, thickness } = poseAxes(part.pose);
  const [lengthAxis, widthAxis, thicknessAxis] = [length[1], width[1], thickness[1]];
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

function crosses(a, b) {
  return POSITION.every((axis) => a.min[axis] < b.max[axis] && b.min[axis] < a.max[axis]);
}

export function overlaps(parts, placementOf = () => null) {
  const shapes = parts.map((part) => solidOf(part, placementOf(part.id)));
  const pairs = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (solidsClash(shapes[i], shapes[j])) pairs.push([parts[i].id, parts[j].id]);
    }
  }
  return pairs;
}

function shapeKey(part) {
  if (part.shape === 'disc' || part.shape === 'dowel' || part.shape === 'triangle') return part.shape;
  if (part.shape === 'arc') return ['arc', part.outerRadius, part.bandWidth, part.sweep].join(':');
  if (part.shape === 'free') return ['free', ...part.points.map(({ x, y, bend }) => `${x},${y},${bend}`)].join(':');
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
    pose: '+x-z+y',
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
  free: { length: 400, width: 300, points: [point(0, 0), point(400, 0), point(400, 200), point(300, 300), point(0, 300)] },
};

export function makeShape(shape = 'board') {
  return makePart({ name: SHAPES[shape], shape, ...SHAPE_DEFAULTS[shape] });
}

const SWITCHES = ['shape', 'corners', ...Object.keys(CORNERS)];
const GEOMETRY = [...SIZES, 'sweep', ...SWITCHES, ...POSITION, 'pose', 'points'];
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
  if (field === 'pose') return POSES.includes(raw) ? raw : NOT_ALLOWED;
  const choices = { species: SPECIES, shape: SHAPES, corners: CORNER_STYLES }[field];
  if (choices) return Object.hasOwn(choices, raw) ? raw : NOT_ALLOWED;
  if (field === 'name') return String(raw).slice(0, 80);
  if (field === 'points') return pointsValue(raw);
  return NOT_ALLOWED;
}

function pointsValue(raw) {
  if (!Array.isArray(raw) || raw.length < MIN_POINTS || raw.length > MAX_POINTS) return NOT_ALLOWED;
  const numbers = raw.map((each) => [each?.x, each?.y, each?.bend ?? 0]);
  if (!numbers.every((values) => values.every((value) => typeof value === 'number' && inReach(value)))) return NOT_ALLOWED;
  const points = numbers.map((values) => point(...values.map(roundMm)));
  return points.every((each, i) => Math.abs(each.bend) <= halfEdge(points, i) + 0.05) ? points : NOT_ALLOWED;
}

export function shapeProblem(part) {
  if (part.shape === 'free') return outlineProblem(part.points, MAX_SIZE_MM) ? 'points' : null;
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
  if (field === 'shape' && value === 'free' && part.shape !== 'free') next = toFree(part, next);
  if (!next) return null;
  if (field === 'points') next = part.shape === 'free' ? withOutline(next, rebase(value)) : null;
  if (part.shape === 'free' && (field === 'length' || field === 'width')) next = stretched(part, field, value);
  if (!next) return null;
  if (SWITCHES.includes(field)) next = fitCorners(next);
  return shapeProblem(next) ? null : next;
}

function freeX(piece, parts, x, nextX) {
  while (inReach(x)) {
    const box = bounds({ ...piece, x });
    const blocker = parts.map(bounds).find((other) => crosses(box, other));
    if (!blocker) return x;
    x = nextX(blocker);
  }
  return undefined;
}

export function duplicatePart(part, parts = [part]) {
  const copy = { ...part, id: newId(), locked: false, y: 0 };
  const span = extents(part).x;
  const x =
    freeX(copy, parts, part.x + span + BESIDE_GAP_MM, (blocker) => blocker.max.x + BESIDE_GAP_MM) ??
    freeX(copy, parts, part.x - span - BESIDE_GAP_MM, (blocker) => blocker.min.x - span - BESIDE_GAP_MM);
  return x === undefined ? part : { ...copy, x: roundMm(x) };
}

export function roundMm(value) {
  return Math.round(value * 10) / 10;
}

const FILE_NAMES = { points: 'outline' };

export function partFromFile(raw, index) {
  const part = makePart();
  if (raw?.orientation !== undefined) {
    if (!Object.hasOwn(ORIENTATIONS, raw.orientation)) throw new Error(`Part ${index + 1} has an invalid orientation.`);
    part.pose = legacyPose(raw.orientation);
  }
  for (const field of ['name', ...GEOMETRY, 'species', 'locked']) {
    if (raw?.[field] === undefined) continue;
    const value = fieldValue(field, raw[field]);
    if (value === NOT_ALLOWED && field === 'points' && part.shape !== 'free') continue;
    if (value === NOT_ALLOWED) throw new Error(`Part ${index + 1} has an invalid ${FILE_NAMES[field] ?? field}.`);
    part[field] = value;
  }
  const loaded = part.shape === 'free' ? withOutline(part, rebase(part.points ?? boardPoints({ ...part, shape: 'board' }))) : part;
  const problem = shapeProblem(loaded);
  if (problem) throw new Error(`Part ${index + 1} has an invalid ${FILE_NAMES[problem] ?? problem}.`);
  return loaded;
}

export const SNAP_GRID_MM = 10;
export const SNAP_REACH_MM = 15;

const boxOfSolid = (solid) =>
  Object.fromEntries(['min', 'max'].map((side) => [side, Object.fromEntries(AXES.map((axis, i) => [axis, solid.box[side][i]]))]));

export function bodyOf(part, placement = null) {
  const solid = solidOf(part, placement);
  return { solid, box: isIdentity(placement) ? bounds(part) : boxOfSolid(solid) };
}

function faceTargets(at, moving, axis, proposed, fixed, floor) {
  const value = proposed[axis];
  const near = [];
  const consider = (target) => {
    if (Math.abs(target - value) <= SNAP_REACH_MM) near.push({ target });
  };
  if (axis === 'y') consider(floor);
  const across = AXES.filter((each) => each !== axis);
  const shift = (each) => (proposed[each] ?? at[each]) - at[each];
  for (const { box: own } of moving) {
    const lead = own.min[axis] - at[axis];
    const tail = own.max[axis] - at[axis];
    for (const { box } of fixed) {
      const inPath = across.every((each) => Math.min(own.max[each] + shift(each), box.max[each]) - Math.max(own.min[each] + shift(each), box.min[each]) > TOUCH_MM);
      consider(box.min[axis] - lead);
      consider(box.max[axis] - tail);
      if (!inPath) {
        consider(box.max[axis] - lead);
        consider(box.min[axis] - tail);
      }
    }
  }
  return near;
}

function meetingTargets(at, moving, axis, position, fixed) {
  const index = AXES.indexOf(axis);
  const offset = AXES.map((each) => (position[each] ?? at[each]) - at[each]);
  const near = [];
  for (const { solid } of moving) {
    const placedNow = moveSolid(solid, offset);
    for (const other of fixed) {
      for (const span of sweepSpans(placedNow, other.solid, index, SNAP_REACH_MM)) {
        span.forEach((travel, end) => {
          if (Math.abs(travel) <= SNAP_REACH_MM) near.push({ target: position[axis] + travel, side: end ? 1 : -1 });
        });
      }
    }
  }
  return near;
}

const roundClear = ({ target, side }) => (side < 0 ? Math.floor(target * 10 + 1e-6) : Math.ceil(target * 10 - 1e-6)) / 10 + 0;
const nearest = (value, targets) => targets.reduce((best, each) => (best && Math.abs(best.target - value) <= Math.abs(each.target - value) ? best : each), null);

export function snapPosition(part, proposed, others, options) {
  const fixed = others.filter((other) => other.id !== part.id).map((other) => bodyOf(other));
  return snapBodies(part, [bodyOf(part)], proposed, fixed, options);
}

// Each axis first snaps to grid and faces; then the one axis nearest a true meeting snaps there, with the others already in place, so the pieces touch without overlapping.
export function snapBodies(at, moving, proposed, fixed, { snap = true } = {}) {
  const axes = POSITION.filter((axis) => axis in proposed);
  if (!snap) return Object.fromEntries(axes.map((axis) => [axis, roundMm(proposed[axis])]));
  const floor = roundMm(at.y - Math.min(...moving.map(({ box }) => box.min.y)));
  const result = {};
  const plain = {};
  for (const axis of axes) {
    plain[axis] = nearest(proposed[axis], faceTargets(at, moving, axis, proposed, fixed, floor));
    result[axis] = roundMm(plain[axis]?.target ?? Math.round(proposed[axis] / SNAP_GRID_MM) * SNAP_GRID_MM);
  }
  const meetings = axes
    .map((axis) => ({ axis, meet: nearest(proposed[axis], meetingTargets(at, moving, axis, { ...result, [axis]: proposed[axis] }, fixed)) }))
    .filter(({ axis, meet }) => meet && (!plain[axis] || Math.abs(meet.target - proposed[axis]) <= Math.abs(plain[axis].target - proposed[axis])));
  const closest = nearest(0, meetings.map(({ axis, meet }) => ({ axis, target: meet.target - proposed[axis], meet })));
  if (closest) result[closest.axis] = roundClear(closest.meet);
  if ('y' in result) result.y = Math.max(result.y, floor);
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

// Rounding toward zero in whole tenths makes a turn and the turn back shift by exactly opposite amounts.
export function recentre(before, after) {
  return Math.trunc(Math.round((before - after) * 10) / 2) / 10;
}

export function rotatePart(part, axis) {
  if (part.locked) return part;
  const { length, width, thickness } = poseAxes(part.pose);
  const pose = [length, width, thickness].map((signed) => turnAxis(signed, axis)).join('');
  const before = extents(part);
  const turned = { ...part, pose };
  const after = extents(turned);
  for (const dim of ['x', 'z']) turned[dim] = roundMm(part[dim] + recentre(before[dim], after[dim]));
  return fitsLimits(turned) ? turned : part;
}
