import { mm } from './format.js';
import {
  MAX_SIZE_MM,
  SHAPES,
  blank,
  bodyOf,
  bounds,
  extents,
  isIdentity,
  movePart,
  newId,
  overlaps,
  poseAxes,
  projectBounds,
  recentre,
  rotatePart,
  roundMm,
  snapBodies,
  solidOf,
  turnAxis,
} from './model.js';
import { TOUCH_MM, depthBehind, meetingRegion, woodRuns } from './geometry.js';

const AXES = ['x', 'y', 'z'];

const near = (a, b) => Math.abs(a - b) < TOUCH_MM;
const findPart = (project, id) => project.parts.find((part) => part.id === id);
const jointsOf = (project) => project.joints ?? [];
const nameOf = (part) => part?.name || 'Unnamed';

function boxContact(a, b) {
  const boxA = bounds(a);
  const boxB = bounds(b);
  for (const axis of AXES) {
    let sign = 0;
    if (near(boxA.max[axis], boxB.min[axis])) sign = 1;
    else if (near(boxB.max[axis], boxA.min[axis])) sign = -1;
    if (!sign) continue;
    const region = {};
    for (const other of AXES.filter((each) => each !== axis)) {
      const low = Math.max(boxA.min[other], boxB.min[other]);
      const high = Math.min(boxA.max[other], boxB.max[other]);
      if (high - low < TOUCH_MM) return null;
      region[other] = [low, high];
    }
    return { axis, sign, at: sign > 0 ? boxA.max[axis] : boxA.min[axis], region };
  }
  return null;
}

const keepOr = (box, met) => (Math.abs(box - met) < TOUCH_MM ? box : roundMm(met));

function trueContact(a, b) {
  const touch = boxContact(a, b);
  if (!touch) return null;
  const met = meetingRegion(solidOf(a), solidOf(b), AXES.indexOf(touch.axis), touch.at);
  if (!met) return null;
  const region = {};
  for (const [axis, [low, high]] of Object.entries(touch.region)) {
    const [from, to] = met[AXES.indexOf(axis)];
    region[axis] = [Math.max(low, keepOr(low, from)), Math.min(high, keepOr(high, to))];
  }
  return { ...touch, region };
}

const contacts = new WeakMap();

export function contact(a, b) {
  if (!contacts.has(a)) contacts.set(a, new WeakMap());
  const known = contacts.get(a);
  if (!known.has(b)) known.set(b, trueContact(a, b));
  return known.get(b);
}

const depths = new WeakMap();

function woodDepth(piece, other, footprint) {
  if (!depths.has(piece)) depths.set(piece, new WeakMap());
  const known = depths.get(piece);
  if (!known.has(other)) known.set(other, new Map());
  const byArea = known.get(other);
  const touch = contact(other, piece);
  const area = footprint ? within(touch.region, footprint) : touch.region;
  const key = JSON.stringify(AXES.map((axis) => area[axis] ?? null));
  if (!byArea.has(key)) {
    const region = Object.fromEntries(Object.entries(area).map(([axis, span]) => [AXES.indexOf(axis), span]));
    const depth = depthBehind(solidOf(piece), AXES.indexOf(touch.axis), touch.at, touch.sign, region, footprint ? 0 : null);
    byArea.set(key, roundMm(depth ?? extents(piece)[touch.axis]));
  }
  return byArea.get(key);
}

function within(region, footprint) {
  return Object.fromEntries(Object.entries(region).map(([axis, [low, high]]) => [axis, [Math.max(low, footprint[axis][0]), Math.min(high, footprint[axis][1])]]));
}

const spanOf = ([low, high]) => roundMm(high - low);

function tenonRoom(part, touch) {
  const across = poseAxes(part.pose).thickness[1];
  const along = AXES.find((axis) => axis !== touch.axis && axis !== across);
  return { across, along, thickness: spanOf(touch.region[across]), width: spanOf(touch.region[along]) };
}

function tenonSpot(part, touch, { thickness, width }) {
  const { across, along } = tenonRoom(part, touch);
  const own = bounds(part);
  const onPart = (axis, size) => onEnd(touch.region[axis], size, [own.min[axis], own.max[axis]]);
  return { [across]: onPart(across, thickness), [along]: onPart(along, width) };
}

const tenonDepth = (part, to, sizes) => woodDepth(to, part, tenonSpot(part, contact(to, part), sizes));

export function touchingParts(parts, id) {
  const piece = parts.find((part) => part.id === id);
  if (!piece) return [];
  return parts.filter((part) => part.id !== id && contact(piece, part));
}

export const JOINT_KINDS = {
  screws: 'Screws',
  nails: 'Nails',
  glue: 'Glue',
  bracket: 'Angle bracket',
  hinge: 'Hinge',
  dado: 'Dado',
  tenon: 'Mortise and tenon',
  dowels: 'Dowels',
  pocketScrews: 'Pocket screws',
  mendingPlate: 'Mending plate',
  cornerPlate: 'Corner plate',
};

export const JOINT_GROUPS = {
  Fixings: ['screws', 'nails', 'pocketScrews', 'glue'],
  'Plates and brackets': ['bracket', 'mendingPlate', 'cornerPlate'],
  'Cut joints': ['dado', 'tenon', 'dowels'],
  Moving: ['hinge'],
};

const CUT_KINDS = ['dado', 'tenon', 'dowels'];
const GOES_IN = { dado: ['length', 'width'], tenon: ['length'] };

export const HINGE_TYPES = { butt: 'Butt', concealed: 'Concealed (35 mm cup)', piano: 'Piano' };
export const FACES = { '-z': 'Back face', '-y': 'Bottom face', '-x': 'Left face', '+x': 'Right face', '+y': 'Top face', '+z': 'Front face' };
export const EDGES = { '-x': 'Left edge', '+x': 'Right edge', '-y': 'Bottom edge', '+y': 'Top edge', '-z': 'Back edge', '+z': 'Front edge' };

const SCREW_LENGTHS = [12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120];
const NAIL_LENGTHS = [15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100];
const BRACKET_LEGS = [20, 30, 40, 50, 60, 80, 100];
const CONCEALED_CUP_MM = 35;
const CONCEALED_DOOR_MM = 16;
const EDGE_PREFERENCE = ['-z', '-x', '+y', '+x', '-y', '+z'];
const PLATES = [[40, 12], [50, 12], [63, 16], [80, 16]];
const PLATE_SCREW_LENGTHS = [12, 16, 20];

function standard(sizes, wanted, most) {
  const fitting = sizes.filter((size) => size <= most);
  return sizes.find((size) => size >= wanted && size <= most) ?? fitting.at(-1) ?? sizes[0];
}

const largestUpTo = (sizes, most) => sizes.filter((size) => size <= most).at(-1) ?? sizes[0];

function meeting(part, to) {
  const touch = contact(to, part);
  if (!touch) return null;
  const spans = Object.values(touch.region).map(([low, high]) => high - low);
  const depths = [extents(part)[touch.axis], extents(to)[touch.axis]].sort((a, b) => a - b);
  return { ...touch, long: Math.max(...spans), short: Math.min(...spans), through: depths[0], into: depths[1] };
}

const edgeAxis = (edge) => edge[1];
const edgeSign = (edge) => (edge[0] === '-' ? -1 : 1);

function edgeCoordinate(part, edge) {
  const box = bounds(part);
  return edgeSign(edge) < 0 ? box.min[edgeAxis(edge)] : box.max[edgeAxis(edge)];
}

export function hingeEdges(project, joint) {
  const part = findPart(project, joint.part);
  const to = findPart(project, joint.to);
  const touch = part && to && contact(to, part);
  return touch ? Object.keys(EDGES).filter((edge) => edgeAxis(edge) !== touch.axis) : [];
}

function defaultEdge(part, to, touch) {
  const box = bounds(to);
  const centre = (axis) => (box.min[axis] + box.max[axis]) / 2;
  const candidates = EDGE_PREFERENCE.filter((edge) => edgeAxis(edge) !== touch.axis);
  const distance = (edge) => Math.abs(edgeCoordinate(part, edge) - centre(edgeAxis(edge)));
  return candidates.reduce((best, edge) => (distance(edge) < distance(best) - TOUCH_MM ? edge : best));
}

const hingeAxisOf = (touch, edge) => AXES.find((axis) => axis !== touch.axis && axis !== edgeAxis(edge));

const thickness = (part) => Math.min(...Object.values(extents(part)));
const thicknessAxis = (part) => poseAxes(part.pose).thickness[1];
const span = ([low, high]) => high - low;
const thirdAxis = (a, b) => AXES.find((axis) => axis !== a && axis !== b);

function flushFaces(part, to, touch) {
  return Object.keys(FACES).filter((face) => edgeAxis(face) !== touch.axis && near(edgeCoordinate(part, face), edgeCoordinate(to, face)));
}

function plateCorner(part, to, touch, face) {
  const along = thirdAxis(touch.axis, edgeAxis(face));
  const [low, high] = touch.region[along];
  const pieces = [part, to].map((piece) => ({ piece, box: bounds(piece) }));
  for (const [end, out] of [[low, -1], [high, 1]]) {
    const reach = ({ box }) => (out < 0 ? box.min[along] : box.max[along]);
    const ending = pieces.find((entry) => near(reach(entry), end));
    const going = pieces.find((entry) => entry !== ending && out * (reach(entry) - end) >= TOUCH_MM);
    if (ending && going) {
      return { along, end, out, into: going.piece === part ? touch.sign : -touch.sign, ending: ending.piece, going: going.piece };
    }
  }
  return null;
}

const plateKind = (kind) => kind === 'mendingPlate' || kind === 'cornerPlate';

function facesFor(kind, part, to, touch) {
  if (kind === 'pocketScrews') {
    const axis = thicknessAxis(part);
    return axis === touch.axis ? [] : [`-${axis}`, `+${axis}`];
  }
  if (!plateKind(kind)) return [];
  const faces = flushFaces(part, to, touch);
  return kind === 'cornerPlate' ? faces.filter((face) => plateCorner(part, to, touch, face)) : faces;
}

export function jointFaces(project, joint) {
  const part = findPart(project, joint.part);
  const to = findPart(project, joint.to);
  const touch = part && to && contact(to, part);
  return touch ? facesFor(joint.kind, part, to, touch) : [];
}

function plateFace(joint, part, to, touch) {
  const faces = facesFor(joint.kind, part, to, touch);
  return faces.includes(joint.face) ? joint.face : faces[0] ?? null;
}

function plateRefusal(kind, part, to, touch) {
  const lineUp = `Line up a face of ${nameOf(part)} with a face of ${nameOf(to)} first.`;
  const flush = flushFaces(part, to, touch);
  if (kind === 'mendingPlate') return flush.length ? null : `A mending plate needs one flat face running across both pieces. ${lineUp}`;
  const needs = 'A corner plate needs two pieces meeting at a right angle with one flat face across both';
  if (!flush.length) return `${needs}. ${lineUp}`;
  return facesFor(kind, part, to, touch).length ? null : `${needs}, and these are in line. Use a mending plate instead.`;
}

const POCKET_SCREW_LENGTHS = [[15, 25], [22, 32], [30, 38], [Infinity, 64]];

function pocketLength(drilled) {
  const thick = extents(drilled)[thicknessAxis(drilled)];
  return POCKET_SCREW_LENGTHS.find(([most], i) => (i === 0 ? thick < most : thick <= most))[1];
}

const pocketRefusal = 'Pocket screws go through the end or edge of one piece, and these lie face to face. Use screws instead.';

function pocketProblem(joint, part, to, touch) {
  if (thicknessAxis(part) === touch.axis) return pocketRefusal;
  const out = joint.length - extents(part)[thicknessAxis(part)];
  const depth = extents(to)[touch.axis];
  return out > depth ? `The pocket screws (${joint.length}) come out the far side of ${nameOf(to)} (${roundBox(depth)} thick).` : null;
}

const stockPlate = (lengthRoom, widthRoom) => PLATES.filter(([length, width]) => length <= lengthRoom && width <= widthRoom).at(-1) ?? PLATES[0];

function plateScrews(part, to, face) {
  const depth = Math.min(extents(part)[edgeAxis(face)], extents(to)[edgeAxis(face)]);
  return { screwsEach: 4, screwDiameter: 3.5, screwLength: largestUpTo(PLATE_SCREW_LENGTHS, depth - 2) };
}

function plateRoom(kind, part, to, touch, face) {
  if (kind === 'mendingPlate') {
    const line = span(touch.region[thirdAxis(touch.axis, edgeAxis(face))]);
    return { length: 2 * Math.min(extents(part)[touch.axis], extents(to)[touch.axis]), width: line, line };
  }
  const corner = plateCorner(part, to, touch, face);
  return {
    length: Math.min(extents(corner.ending)[touch.axis], extents(corner.going)[corner.along]),
    width: Math.min(extents(corner.going)[touch.axis], extents(corner.ending)[corner.along]),
  };
}

function hingeTypeDefaults(type, edgeLength, depth) {
  const screwLength = largestUpTo(SCREW_LENGTHS, depth - 2);
  if (type === 'piano') {
    return { count: 1, size: edgeLength, screwsEach: 2 * Math.ceil(edgeLength / 100), screwDiameter: 3, screwLength, opensTo: 180 };
  }
  const count = edgeLength <= 900 ? 2 : edgeLength <= 1500 ? 3 : 4;
  if (type === 'concealed') return { count, size: CONCEALED_CUP_MM, screwsEach: 4, screwDiameter: 3.5, screwLength, opensTo: 110 };
  const size = edgeLength <= 600 ? 50 : 75;
  return { count, size, screwsEach: size >= 65 ? 6 : 4, screwDiameter: 3.5, screwLength, opensTo: 180 };
}

function hingeDefaults(meet, part, to) {
  const edge = defaultEdge(part, to, meet);
  const edgeLength = extents(part)[hingeAxisOf(meet, edge)];
  return { hingeType: 'butt', edge, open: 0, ...hingeTypeDefaults('butt', edgeLength, Math.min(thickness(part), thickness(to))) };
}

const DEFAULTS = {
  screws: ({ long, through, into }) => ({
    count: Math.max(2, Math.ceil(long / 150)),
    diameter: through <= 12 ? 3.5 : through >= 30 ? 5 : 4,
    length: standard(SCREW_LENGTHS, through + Math.min(into, Math.max(15, 1.5 * through)), through + into),
    glued: false,
  }),
  nails: ({ long, through, into }) => {
    const length = standard(NAIL_LENGTHS, 2.5 * through, through + into);
    return { count: Math.max(2, Math.ceil(long / 100)), diameter: length <= 25 ? 1.2 : length <= 50 ? 2 : 2.8, length, glued: false };
  },
  glue: () => ({}),
  bracket: ({ long, through }) => {
    const leg = largestUpTo(BRACKET_LEGS, 40);
    return {
      count: Math.max(2, Math.ceil(long / 400)),
      leg,
      width: leg >= 60 ? 20 : 16,
      screwsEach: 4,
      screwDiameter: 3.5,
      screwLength: largestUpTo(SCREW_LENGTHS, Math.max(12, through - 2)),
      glued: false,
    };
  },
  hinge: hingeDefaults,
  dado: (meet, part, to) => ({ depth: Math.max(1, Math.round(woodDepth(to, part) / 3)), glued: true }),
  tenon: (meet, part, to) => {
    const { width, thickness: across } = tenonRoom(part, meet);
    const sizes = {
      thickness: Math.min(Math.max(6, Math.round(across / 3)), Math.floor(across * 5) / 10),
      width: roundMm(width >= 60 ? width - 20 : width / 2),
    };
    const depth = tenonDepth(part, to, sizes);
    return { length: Math.min(depth, Math.max(5, Math.floor((2 * depth) / 3 / 5) * 5)), ...sizes, through: false, glued: true };
  },
  dowels: ({ long }, part, to) => {
    const thinner = Math.min(thickness(part), thickness(to));
    const diameter = thinner < 15 ? 6 : thinner <= 25 ? 8 : 10;
    const count = Math.max(2, Math.floor(long / 50));
    const length = Math.min({ 6: 30, 8: 40, 10: 50 }[diameter], largestUpTo(DOWEL_LENGTHS, holeRoom(part, to, { count, diameter })));
    return { count, diameter, length, glued: true };
  },
  mendingPlate: (meet, part, to, wanted) => {
    const face = plateFace({ kind: 'mendingPlate', face: wanted?.face }, part, to, meet);
    const room = plateRoom('mendingPlate', part, to, meet, face);
    const [length, width] = stockPlate(room.length, room.width);
    return { count: room.line > 300 ? 2 : 1, length, width, ...plateScrews(part, to, face), face, glued: false };
  },
  cornerPlate: (meet, part, to, wanted) => {
    const face = plateFace({ kind: 'cornerPlate', face: wanted?.face }, part, to, meet);
    const room = plateRoom('cornerPlate', part, to, meet, face);
    const [leg, width] = stockPlate(room.length, room.width);
    return { leg, width, ...plateScrews(part, to, face), face, glued: false };
  },
  pocketScrews: (meet, part) => {
    const axis = thicknessAxis(part);
    const line = span(meet.region[thirdAxis(meet.axis, axis)]);
    return { count: 2 + Math.floor(Math.max(0, line - 150) / 150), diameter: 4, length: pocketLength(part), face: `-${axis}`, glued: false };
  },
};

const DOWEL_LENGTHS = [20, 25, 30, 35, 40, 50, 60];

const longAndShort = (region) => Object.keys(region).sort((a, b) => region[b][1] - region[b][0] - (region[a][1] - region[a][0]));

function dowelSpots({ region }, { count, diameter }) {
  const [long, short] = longAndShort(region);
  const middle = (region[short][0] + region[short][1]) / 2;
  const half = diameter / 2;
  return spread(count, ...region[long], 25).map((value) => ({ [long]: [value - half, value + half], [short]: [middle - half, middle + half] }));
}

function holeDepth(piece, other, dowels) {
  const shallowest = Math.min(...dowelSpots(contact(other, piece), dowels).map((spot) => woodDepth(piece, other, spot)));
  return Math.floor((2 * shallowest) / 3);
}

const holeRoom = (part, to, dowels) => holeDepth(part, to, dowels) + holeDepth(to, part, dowels);

const sideOf = (part, axis) => Object.entries(poseAxes(part.pose)).find(([, signed]) => signed[1] === axis)?.[0];
const SIDE_WORDS = { length: 'end', width: 'edge', thickness: 'face' };
const housesIn = (kind, to, axis) => (kind === 'dado' ? sideOf(to, axis) === 'thickness' : sideOf(to, axis) !== 'length');

function onlyBoard(kind, piece) {
  const shape = SHAPES[piece.shape].toLowerCase();
  const only = kind === 'tenon' ? 'Only a board can have a tenon.' : 'Only a board can sit in a dado.';
  return `${only} ${nameOf(piece)} is ${/^[aeiou]/.test(shape) ? 'an' : 'a'} ${shape}.`;
}

function howTheyMeet(part, to, axis) {
  const [a, b] = [part, to].sort((one, two) => Object.keys(SIDE_WORDS).indexOf(sideOf(one, axis)) - Object.keys(SIDE_WORDS).indexOf(sideOf(two, axis)));
  const [sideA, sideB] = [sideOf(a, axis), sideOf(b, axis)];
  if (sideA === sideB) return sideA === 'thickness' ? 'these lie face to face' : `these meet ${SIDE_WORDS[sideA]} to ${SIDE_WORDS[sideA]}`;
  if (sideB === 'thickness') return `${nameOf(a)} meets ${nameOf(b)} with its ${SIDE_WORDS[sideA]}`;
  return `${nameOf(a)} meets the ${SIDE_WORDS[sideB]} of ${nameOf(b)} with its ${SIDE_WORDS[sideA]}`;
}

function cutRoles(kind, part, to) {
  const axis = contact(to, part).axis;
  const goesIn = (piece) => (piece.shape === 'board' ? GOES_IN[kind].includes(sideOf(piece, axis)) : sideOf(piece, axis) !== 'thickness');
  const able = [[part, to], [to, part]].filter(([piece, housing]) => goesIn(piece) && housesIn(kind, housing, axis));
  if (!able.length) {
    const needs = kind === 'tenon' ? 'A tenon needs the end' : 'A dado needs the end or edge';
    return { error: `${needs} of one piece against a face of the other, and ${howTheyMeet(part, to, axis)}.` };
  }
  const fit = able.find(([piece]) => piece.shape === 'board');
  if (!fit) return { error: onlyBoard(kind, able[0][0]) };
  return { part: fit[0], to: fit[1] };
}

export function cutJoint(project, joint) {
  if (!CUT_KINDS.includes(joint?.kind)) return null;
  const part = findPart(project, joint.part);
  const to = findPart(project, joint.to);
  const touch = part && to && contact(part, to);
  if (!touch) return null;
  const side = sideOf(part, touch.axis);
  if (GOES_IN[joint.kind] && (part.shape !== 'board' || !GOES_IN[joint.kind].includes(side) || !housesIn(joint.kind, to, touch.axis))) return null;
  const depth = joint.kind === 'tenon' ? tenonDepth(part, to, joint) : woodDepth(to, part);
  const reach = { dado: joint.depth, tenon: joint.through ? depth : joint.length, dowels: joint.length }[joint.kind];
  return { part, to, touch, side, depth, reach, room: GOES_IN[joint.kind] && tenonRoom(part, touch) };
}

export function joinedTo(project, id) {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    for (const joint of jointsOf(project)) {
      const other = joint.part === current ? joint.to : joint.to === current ? joint.part : null;
      if (other && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

const samePair = (joint, a, b) => (joint.part === a && joint.to === b) || (joint.part === b && joint.to === a);

function unionFind() {
  const parent = new Map();
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    const up = parent.get(id);
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  return { find, union: (a, b) => parent.set(find(a), find(b)) };
}

const IDENTITY = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

function multiply(a, b) {
  const m = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      m.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]);
    }
  }
  return m;
}

const apply = (m, v) => [0, 1, 2].map((row) => m[row * 3] * v[0] + m[row * 3 + 1] * v[1] + m[row * 3 + 2] * v[2]);

export function transformPoint(placement, point) {
  return apply(placement.m, point).map((value, i) => value + placement.o[i]);
}

function compose(outer, inner) {
  return { m: multiply(outer.m, inner.m), o: transformPoint(outer, inner.o) };
}

function rotationAbout(point, direction, degrees) {
  const [x, y, z] = direction;
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const m = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
  const turned = apply(m, point);
  return { m, o: point.map((value, i) => value - turned[i]) };
}

const unit = (axis, sign = 1) => AXES.map((each) => (each === axis ? sign : 0));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const point = (record) => AXES.map((axis) => record[axis]);

function hingeLine(part, touch, edge) {
  const box = bounds(part);
  const along = hingeAxisOf(touch, edge);
  const origin = { [touch.axis]: touch.at, [edgeAxis(edge)]: edgeCoordinate(part, edge), [along]: box.min[along] };
  const centre = AXES.map((axis) => (box.min[axis] + box.max[axis]) / 2);
  const start = point(origin);
  const direction = unit(along);
  const away = dot(cross(direction, centre.map((value, i) => value - start[i])), unit(touch.axis, touch.sign));
  const length = box.max[along] - box.min[along];
  if (away >= 0) return { origin: start, direction, length };
  start[AXES.indexOf(along)] = box.max[along];
  return { origin: start, direction: direction.map((value) => -value), length };
}

function fixedPath(project, from, to, skip) {
  const previous = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift();
    if (current === to) break;
    for (const joint of jointsOf(project)) {
      if (joint === skip) continue;
      const other = joint.part === current ? joint.to : joint.to === current ? joint.part : null;
      if (other && !previous.has(other)) {
        previous.set(other, { from: current, joint });
        queue.push(other);
      }
    }
  }
  if (!previous.has(to)) return null;
  const steps = [];
  for (let at = to; previous.get(at); at = previous.get(at).from) steps.unshift(previous.get(at));
  return steps;
}

function jamReason(project, hinge, why) {
  const part = findPart(project, hinge.part);
  const to = findPart(project, hinge.to);
  if (why === 'apart') return `Can’t swing: ${nameOf(part)} no longer touches ${nameOf(to)}.`;
  const path = fixedPath(project, hinge.part, hinge.to, hinge) ?? [];
  const between = path.slice(1).map((step) => nameOf(findPart(project, step.from)));
  const fixed = path.every((step) => step.joint.kind !== 'hinge');
  const verb = fixed ? 'fixed' : 'held';
  const through = between.length ? ` through ${between.join(' and ')}` : '';
  return `Can’t swing: ${nameOf(part)} is also ${verb} to ${nameOf(to)}${through}.`;
}

export function mechanism(project) {
  const groups = unionFind();
  for (const joint of jointsOf(project)) if (joint.kind !== 'hinge') groups.union(joint.part, joint.to);
  const tree = unionFind();
  const hangsOn = new Map();
  const hinges = new Map();
  for (const joint of jointsOf(project)) {
    if (joint.kind !== 'hinge') continue;
    const part = findPart(project, joint.part);
    const to = findPart(project, joint.to);
    if (!part || !to) continue;
    const touch = contact(to, part);
    const frame = groups.find(joint.to);
    const leaf = groups.find(joint.part);
    let jam = null;
    if (!touch) jam = 'apart';
    else if (frame === leaf || hangsOn.has(leaf) || tree.find(frame) === tree.find(leaf)) jam = 'held';
    const edge = touch && edgeAxis(joint.edge) !== touch.axis ? joint.edge : touch && defaultEdge(part, to, touch);
    const line = touch && hingeLine(part, touch, edge);
    const info = { joint, line, edge, jammed: jam && jamReason(project, joint, jam), frame };
    hinges.set(joint.id, info);
    if (jam) continue;
    hangsOn.set(leaf, info);
    tree.union(frame, leaf);
  }
  const placed = new Map();
  const placementOf = (group) => {
    if (placed.has(group)) return placed.get(group);
    const info = hangsOn.get(group);
    const result = info
      ? compose(placementOf(info.frame), rotationAbout(info.line.origin, info.line.direction, info.joint.open))
      : IDENTITY;
    placed.set(group, result);
    return result;
  };
  return {
    hinges,
    placement: (id) => placementOf(groups.find(id)),
    hangsOn: (id) => hangsOn.get(groups.find(id))?.joint ?? null,
    frameOf: (info) => placementOf(info.frame),
  };
}

export function placements(project) {
  const mech = mechanism(project);
  return new Map(project.parts.map((part) => [part.id, mech.placement(part.id)]));
}

const roundBox = (value) => Math.round(value * 10) / 10 + 0;

export function worldBounds(project, id, placement = mechanism(project).placement(id)) {
  const box = bounds(findPart(project, id));
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(transformPoint(placement, [x, y, z]));
  const pick = (fn) => Object.fromEntries(AXES.map((axis, i) => [axis, roundBox(fn(...corners.map((corner) => corner[i])))]));
  return { min: pick(Math.min), max: pick(Math.max) };
}

export function swingingHinge(project, id) {
  return mechanism(project).hangsOn(id);
}

export function jointProblem(project, jointId) {
  const joint = jointsOf(project).find((each) => each.id === jointId);
  if (!joint) return null;
  if (joint.kind === 'hinge') {
    const jammed = mechanism(project).hinges.get(jointId)?.jammed;
    if (jammed) return jammed;
    const door = findPart(project, joint.part);
    const touch = door && findPart(project, joint.to) && contact(findPart(project, joint.to), door);
    if (joint.hingeType === 'concealed' && touch && thickness(door) < CONCEALED_DOOR_MM) {
      return `Concealed hinges need a door at least ${CONCEALED_DOOR_MM} mm thick; ${nameOf(door)} is ${roundMm(thickness(door))} mm.`;
    }
    return null;
  }
  const part = findPart(project, joint.part);
  const to = findPart(project, joint.to);
  if (!part || !to) return null;
  const meet = meeting(part, to);
  if (!meet) return `${nameOf(part)} no longer touches ${nameOf(to)}. Move them back together, or remove the joint.`;
  if (CUT_KINDS.includes(joint.kind)) return cutProblem(project, joint);
  if ((joint.kind === 'screws' || joint.kind === 'nails') && joint.length > meet.through + meet.into) {
    return `Longer than both pieces together (${roundBox(meet.through + meet.into)} mm): it will come out the other side.`;
  }
  if (plateKind(joint.kind)) return plateProblem(joint, part, to, meet);
  if (joint.kind === 'pocketScrews') return pocketProblem(joint, part, to, meet);
  return null;
}

function cutProblem(project, joint) {
  const cut = cutJoint(project, joint);
  if (!cut) {
    const part = findPart(project, joint.part);
    const to = findPart(project, joint.to);
    if (part.shape !== 'board') return onlyBoard(joint.kind, part);
    if (GOES_IN[joint.kind].includes(sideOf(part, contact(part, to).axis))) return `${nameOf(to)} no longer offers a face to ${nameOf(part)}. Turn it back, or remove the joint.`;
    const end = joint.kind === 'tenon' ? 'end' : 'end or edge';
    return `${nameOf(part)} no longer meets ${nameOf(to)} with its ${end}. Turn it back, or remove the joint.`;
  }
  const { part, to, depth, reach, room } = cut;
  const size = blank(part);
  const where = `where ${nameOf(part)} meets ${nameOf(to)}`;
  if (joint.kind === 'dado') {
    if (reach >= depth) return `The dado (${mm(reach)}) is as deep as ${nameOf(to)} is thick (${mm(depth)}). Make it shallower.`;
    if (reach > depth / 2) return `The dado is deeper than half of ${nameOf(to)} (${mm(depth / 2)}). That weakens it.`;
  }
  if (joint.kind === 'tenon') {
    if (reach > depth) return `The tenon (${mm(reach)}) is longer than ${nameOf(to)} is deep there (${mm(depth)}). Shorten it or tick Through tenon.`;
    if (joint.thickness >= size.thickness) return `The tenon (${mm(joint.thickness)}) is as thick as ${nameOf(part)} (${mm(size.thickness)}). Make it thinner.`;
    if (joint.width > size.width) return `The tenon (${mm(joint.width)}) is wider than ${nameOf(part)} (${mm(size.width)}). Make it narrower.`;
    if (joint.width > room.width) return `The tenon (${mm(joint.width)}) is wider than ${where} (${mm(room.width)}). Make it narrower.`;
    if (joint.thickness > room.thickness) return `The tenon (${mm(joint.thickness)}) is thicker than ${where} (${mm(room.thickness)}). Make it thinner.`;
    if (joint.thickness > size.thickness / 2) return `The tenon is thicker than half of ${nameOf(part)} (${mm(size.thickness / 2)}). That leaves thin shoulders.`;
  }
  if (joint.kind === 'dowels') {
    const thinner = Math.min(thickness(part), thickness(to));
    const holes = holeRoom(part, to, joint);
    if (joint.diameter >= thinner) return `The dowels (⌀${mm(joint.diameter)}) are as thick as the thinner piece (${mm(thinner)}). Use thinner dowels.`;
    if (joint.length > holes) return `The dowels (${mm(joint.length)}) are longer than the two holes can hold (${mm(holes)}).`;
  }
  return null;
}

function cutLimit(project, joint, field, value) {
  const cut = cutJoint(project, joint);
  if (!cut) return null;
  const { part, to, depth, room } = cut;
  const size = blank(part);
  const where = `where ${nameOf(part)} meets ${nameOf(to)}`;
  if (joint.kind === 'dado' && field === 'depth' && value >= depth) return `Enter a depth under ${mm(depth)}, the thickness of ${nameOf(to)}.`;
  if (joint.kind === 'tenon') {
    if (field === 'length' && value > depth) return `Enter a length up to ${mm(depth)}, the depth of ${nameOf(to)} there, or tick Through tenon.`;
    if (field === 'thickness' && value >= size.thickness) return `Enter a thickness under ${mm(size.thickness)}, the thickness of ${nameOf(part)}.`;
    if (field === 'width' && value > size.width) return `Enter a width up to ${mm(size.width)}, the width of ${nameOf(part)}.`;
    if (field === 'width' && value > room.width) return `Enter a width up to ${mm(room.width)}, ${where}.`;
    if (field === 'thickness' && value > room.thickness) return `Enter a thickness up to ${mm(room.thickness)}, ${where}.`;
  }
  if (joint.kind === 'dowels' && field === 'diameter') {
    const thinner = Math.min(thickness(part), thickness(to));
    if (value >= thinner) return `Enter a diameter under ${mm(thinner)}, the thickness of the thinner piece.`;
  }
  return null;
}

function plateProblem(joint, part, to, touch) {
  const refusal = plateRefusal(joint.kind, part, to, touch);
  if (refusal) return refusal;
  const face = plateFace(joint, part, to, touch);
  const room = plateRoom(joint.kind, part, to, touch, face);
  if (joint.width > room.width) {
    const size = joint.kind === 'mendingPlate' ? [joint.length, joint.width] : [joint.leg, joint.leg, joint.width];
    return `The plate (${size.join(' × ')}) is wider than the face it sits on (${roundBox(room.width)}).`;
  }
  const depth = (piece) => extents(piece)[edgeAxis(face)];
  const thin = [part, to].filter((piece) => joint.screwLength > depth(piece)).sort((a, b) => depth(a) - depth(b))[0];
  return thin ? `The screws (${joint.screwLength}) are longer than ${nameOf(thin)} is thick (${roundBox(depth(thin))}).` : null;
}

function drilledFirst(project, kind, partId, toId) {
  const part = findPart(project, partId);
  const to = findPart(project, toId);
  const touch = kind === 'pocketScrews' && part && to && contact(to, part);
  return touch && thicknessAxis(part) === touch.axis && thicknessAxis(to) !== touch.axis ? [toId, partId] : [partId, toId];
}

export function joinParts(project, kind, pickedId, otherId) {
  const [partId, toId] = drilledFirst(project, kind, pickedId, otherId);
  const part = findPart(project, partId);
  const to = findPart(project, toId);
  if (!part || !to || part === to || !Object.hasOwn(JOINT_KINDS, kind)) return { error: 'Pick two different pieces to join.' };
  const joints = jointsOf(project);
  if (joints.some((joint) => samePair(joint, partId, toId))) {
    return { error: `${nameOf(part)} and ${nameOf(to)} are already joined. Change that joint instead.` };
  }
  const mech = mechanism(project);
  for (const piece of [part, to]) {
    const hinge = mech.hangsOn(piece.id);
    if (hinge && !isIdentity(mech.placement(piece.id))) {
      return { error: `${nameOf(piece)} is open ${roundBox(openAngle(project, piece.id))}°. Close it first to join anything to it.` };
    }
  }
  if (kind === 'hinge' && mech.hangsOn(partId)) {
    const hinge = mech.hangsOn(partId);
    return { error: `${nameOf(part)} already swings on a hinge on ${nameOf(findPart(project, hinge.to))}. A piece can swing on only one.` };
  }
  const meet = meeting(part, to);
  if (!meet) return { error: 'These pieces don’t touch. Move them together first.' };
  if (kind === 'bracket' && !insideCorner(to, part)) {
    return { error: 'An angle bracket needs an inside corner where the pieces meet, and these lie face to face.' };
  }
  if (plateKind(kind)) {
    const refusal = plateRefusal(kind, part, to, meet);
    if (refusal) return { error: refusal };
  }
  if (kind === 'pocketScrews' && thicknessAxis(part) === meet.axis) return { error: pocketRefusal };
  const roles = GOES_IN[kind] ? cutRoles(kind, part, to) : { part, to };
  if (roles.error) return roles;
  const joint = { id: newId(), kind, part: roles.part.id, to: roles.to.id, ...DEFAULTS[kind](meeting(roles.part, roles.to), roles.part, roles.to) };
  return { project: { ...project, joints: [...joints, joint] }, joint };
}

function openAngle(project, id) {
  let total = 0;
  const mech = mechanism(project);
  for (let hinge = mech.hangsOn(id); hinge; hinge = mech.hangsOn(hinge.to)) total = Math.max(total, hinge.open);
  return total;
}

export function jointRemoval(project, jointId) {
  return unlessLockedPieceMoves(project, { ...project, joints: jointsOf(project).filter((joint) => joint.id !== jointId) });
}

export function removeJoint(project, jointId) {
  return jointRemoval(project, jointId).project ?? project;
}

export function partRemoval(project, partId) {
  return unlessLockedPieceMoves(project, {
    ...project,
    parts: project.parts.filter((part) => part.id !== partId),
    joints: jointsOf(project).filter((joint) => joint.part !== partId && joint.to !== partId),
  });
}

export function removePart(project, partId) {
  return partRemoval(project, partId).project ?? project;
}

export function changePart(project, next) {
  return unlessLockedPieceMoves(project, { ...project, parts: project.parts.map((part) => (part.id === next.id ? next : part)) });
}

const whole = (most) => (raw) => {
  const value = Number(raw);
  return raw !== '' && Number.isInteger(value) && value >= 0 && value <= most ? value : undefined;
};
const counted = (most) => (raw) => {
  const value = whole(most)(raw);
  return value >= 1 ? value : undefined;
};
const millimetres = (most) => (raw) => {
  const value = Math.round(Number(raw) * 10) / 10;
  return raw !== '' && Number.isFinite(value) && value > 0 && value <= most ? value : undefined;
};
const face = (raw) => (Object.hasOwn(FACES, raw) ? raw : undefined);
const degrees = (least, most) => (raw) => {
  const value = Math.round(Number(raw) * 10) / 10;
  return raw !== '' && Number.isFinite(value) && value >= least && value <= most ? value : undefined;
};

const tick = (raw) => (typeof raw === 'boolean' ? raw : undefined);

export const JOINT_FIELDS = {
  screws: { count: counted(500), diameter: millimetres(20), length: millimetres(500), glued: (raw) => (typeof raw === 'boolean' ? raw : undefined) },
  nails: { count: counted(500), diameter: millimetres(20), length: millimetres(500), glued: (raw) => (typeof raw === 'boolean' ? raw : undefined) },
  glue: {},
  bracket: {
    count: counted(500),
    leg: millimetres(1000),
    width: millimetres(1000),
    screwsEach: whole(100),
    screwDiameter: millimetres(20),
    screwLength: millimetres(500),
    glued: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  },
  hinge: {
    hingeType: (raw) => (Object.hasOwn(HINGE_TYPES, raw) ? raw : undefined),
    count: counted(100),
    size: millimetres(MAX_SIZE_MM),
    screwsEach: whole(500),
    screwDiameter: millimetres(20),
    screwLength: millimetres(500),
    opensTo: degrees(1, 270),
    open: degrees(0, 270),
    edge: (raw) => (Object.hasOwn(EDGES, raw) ? raw : undefined),
  },
  dado: { depth: millimetres(MAX_SIZE_MM), glued: tick },
  tenon: { length: millimetres(MAX_SIZE_MM), thickness: millimetres(MAX_SIZE_MM), width: millimetres(MAX_SIZE_MM), through: tick, glued: tick },
  dowels: { count: counted(500), diameter: millimetres(100), length: millimetres(1000), glued: tick },
  mendingPlate: {
    count: counted(100),
    length: millimetres(1000),
    width: millimetres(1000),
    screwsEach: whole(100),
    screwDiameter: millimetres(20),
    screwLength: millimetres(500),
    face,
    glued: tick,
  },
  pocketScrews: { count: counted(500), diameter: millimetres(20), length: millimetres(500), face, glued: tick },
  cornerPlate: {
    leg: millimetres(1000),
    width: millimetres(1000),
    screwsEach: whole(100),
    screwDiameter: millimetres(20),
    screwLength: millimetres(500),
    face,
    glued: tick,
  },
};

export function jointFieldValue(kind, field, raw) {
  return JOINT_FIELDS[kind]?.[field]?.(raw);
}

export function suggestedSizes(project, joint) {
  const part = findPart(project, joint.part);
  const to = findPart(project, joint.to);
  const meet = part && to && meeting(part, to);
  if (!meet) return null;
  const kept = Object.fromEntries(['glued', 'through', 'face'].filter((field) => field in joint).map((field) => [field, joint[field]]));
  if (joint.kind !== 'hinge') return { ...DEFAULTS[joint.kind](meet, part, to, joint), ...kept };
  const edge = hingeEdges(project, joint).includes(joint.edge) ? joint.edge : defaultEdge(part, to, meet);
  const sizes = hingeTypeDefaults(joint.hingeType, extents(part)[hingeAxisOf(meet, edge)], Math.min(thickness(part), thickness(to)));
  return { ...sizes, open: Math.min(joint.open, sizes.opensTo) };
}

function movingParts(project, jointId) {
  const mech = mechanism(project);
  return project.parts.filter((part) => {
    for (let hinge = mech.hangsOn(part.id); hinge; hinge = mech.hangsOn(hinge.to)) if (hinge.id === jointId) return true;
    return false;
  });
}

export function swingLocked(project, jointId) {
  return movingParts(project, jointId).some((part) => part.locked);
}

const withJoint = (project, joint) => ({ ...project, joints: jointsOf(project).map((each) => (each.id === joint.id ? joint : each)) });

const samePlacement = (a, b) => a.m.every((value, i) => Math.abs(value - b.m[i]) < 1e-9) && a.o.every((value, i) => Math.abs(value - b.o[i]) < 1e-6);

function lockedPieceMoved(before, after) {
  const was = mechanism(before);
  const now = mechanism(after);
  return after.parts.find((part) => part.locked && !samePlacement(was.placement(part.id), now.placement(part.id))) ?? null;
}

function unlessLockedPieceMoves(project, next) {
  const piece = lockedPieceMoved(project, next);
  return piece ? { refused: 'locked', piece } : { project: next };
}

function unlessLockedMoves(project, next) {
  const result = withJoint(project, next);
  const piece = lockedPieceMoved(project, result);
  return piece ? { refused: 'locked', piece } : { project: result };
}

export function changeJoint(project, jointId, field, raw) {
  const joint = jointsOf(project).find((each) => each.id === jointId);
  const value = joint && jointFieldValue(joint.kind, field, raw);
  if (value === undefined) return { refused: 'invalid' };
  const reason = cutLimit(project, joint, field, value);
  if (reason) return { refused: 'invalid', reason };
  let next = { ...joint, [field]: value };
  if (field === 'open' && value > joint.opensTo) return { refused: 'limit' };
  if (field === 'edge' && !hingeEdges(project, joint).includes(value)) return { refused: 'invalid' };
  if (field === 'face' && !jointFaces(project, joint).includes(value)) return { refused: 'invalid' };
  if (field === 'opensTo') next.open = Math.min(next.open, value);
  if (field === 'hingeType') next = { ...next, ...(suggestedSizes(withJoint(project, next), next) ?? {}) };
  return unlessLockedMoves(project, next);
}

export function updateJoint(project, jointId, field, raw) {
  return changeJoint(project, jointId, field, raw).project ?? null;
}

export function suggestSizes(project, jointId) {
  const joint = jointsOf(project).find((each) => each.id === jointId);
  const suggested = joint && suggestedSizes(project, joint);
  return suggested ? unlessLockedMoves(project, { ...joint, ...suggested }) : { refused: 'apart' };
}

export function applySuggestedSizes(project, jointId) {
  return suggestSizes(project, jointId).project ?? null;
}

function actualBoxes(project, members) {
  const mech = mechanism(project);
  const box = (part) => worldBounds(project, part.id, mech.placement(part.id));
  return {
    moving: project.parts.filter((part) => members.has(part.id)).map(box),
    fixed: project.parts.filter((part) => !members.has(part.id)).map(box),
  };
}

export function snapAssembly(project, id, proposed, options) {
  const mech = mechanism(project);
  const members = joinedTo(project, id);
  const bodies = (joined) => project.parts.filter((part) => members.has(part.id) === joined).map((part) => bodyOf(part, mech.placement(part.id)));
  return snapBodies(findPart(project, id), bodies(true), proposed, bodies(false), options);
}

function pieceOverLimit(before, after, members) {
  const was = actualBoxes(before, members).moving;
  const moving = before.parts.filter((part) => members.has(part.id));
  return moving[
    actualBoxes(after, members).moving.findIndex((box, i) =>
      AXES.some((axis) => Math.abs(box.min[axis]) > MAX_SIZE_MM && Math.abs(box.min[axis]) > Math.abs(was[i].min[axis])),
    )
  ];
}

export function changePosition(project, id, position) {
  const piece = findPart(project, id);
  if (!piece) return { refused: 'missing' };
  const members = joinedTo(project, id);
  const parts = project.parts.filter((part) => members.has(part.id));
  const locked = parts.find((part) => part.locked);
  if (locked) return { refused: 'locked', piece: locked };
  const delta = Object.fromEntries(Object.entries(position).map(([axis, value]) => [axis, value - piece[axis]]));
  const moved = new Map();
  for (const part of parts) {
    const target = Object.fromEntries(Object.entries(delta).map(([axis, change]) => [axis, part[axis] + change]));
    const next = movePart(part, target);
    if (next === part && Object.values(delta).some(Boolean)) return { refused: 'limit', piece: part };
    moved.set(part.id, next);
  }
  const next = { ...project, parts: project.parts.map((part) => moved.get(part.id) ?? part) };
  const past = pieceOverLimit(project, next, members);
  return past ? { refused: 'limit', piece: past } : { project: next };
}

export function moveAssembly(project, id, position) {
  return changePosition(project, id, position).project ?? project;
}

function turnVector(vector, axis) {
  const signed = (i) => `${vector[i] < 0 ? '-' : '+'}${AXES[i]}`;
  const result = [0, 0, 0];
  vector.forEach((value, i) => {
    if (!value) return;
    const turned = turnAxis(signed(i), axis);
    result[AXES.indexOf(turned[1])] += Math.abs(value) * edgeSign(turned);
  });
  return result;
}

export function rotateAssembly(project, id, axis) {
  const members = joinedTo(project, id);
  const parts = project.parts.filter((part) => members.has(part.id));
  if (!parts.length) return project;
  if (parts.length === 1) {
    const turned = rotatePart(parts[0], axis);
    return turned === parts[0] ? project : { ...project, parts: project.parts.map((part) => (part.id === id ? turned : part)) };
  }
  if (parts.some((part) => part.locked)) return project;
  const before = projectBounds(parts);
  const origin = point(before.min);
  const turned = parts.map((part) => {
    const box = bounds(part);
    const corners = [box.min, box.max].map((corner) => turnVector(point(corner).map((value, i) => value - origin[i]), axis));
    const min = [0, 1, 2].map((i) => Math.min(corners[0][i], corners[1][i]));
    const { length, width, thickness } = poseAxes(part.pose);
    const pose = [length, width, thickness].map((signed) => turnAxis(signed, axis)).join('');
    return { ...part, pose, x: min[0], y: min[1], z: min[2] };
  });
  const after = projectBounds(turned);
  const span = (box, each) => box.max[each] - box.min[each];
  const corner = { y: before.min.y };
  for (const each of ['x', 'z']) corner[each] = before.min[each] + recentre(span(before, each), span(after, each));
  const placed = turned.map((part) => ({ ...part, ...Object.fromEntries(AXES.map((each) => [each, roundMm(corner[each] + part[each] - after.min[each])])) }));
  if (placed.some((part) => AXES.some((each) => Math.abs(part[each]) > MAX_SIZE_MM))) return project;
  const byId = new Map(placed.map((part) => [part.id, part]));
  const joints = jointsOf(project).map((joint) => {
    if (!members.has(joint.part)) return joint;
    if (joint.kind === 'hinge') return { ...joint, edge: turnAxis(joint.edge, axis) };
    return joint.face ? { ...joint, face: turnAxis(joint.face, axis) } : joint;
  });
  const next = { ...project, parts: project.parts.map((part) => byId.get(part.id) ?? part), joints };
  return pieceOverLimit(project, next, members) ? project : next;
}

export function insideCorner(to, part) {
  const touch = contact(to, part);
  if (!touch) return null;
  const boxes = { [to.id]: bounds(to), [part.id]: bounds(part) };
  const candidates = [];
  for (const across of Object.keys(touch.region)) {
    const along = Object.keys(touch.region).find((axis) => axis !== across);
    for (const side of [-1, 1]) {
      const edge = touch.region[across][side < 0 ? 0 : 1];
      for (const [base, standing] of [[to.id, part.id], [part.id, to.id]]) {
        const end = (id) => (side < 0 ? boxes[id].min[across] : boxes[id].max[across]);
        if (!near(end(standing), edge) || side * (end(base) - edge) < TOUCH_MM) continue;
        candidates.push({ axis: touch.axis, at: touch.at, across, edge, side, along, span: touch.region[along], base, standing });
      }
    }
  }
  const rank = (corner) => (corner.across === 'y' ? (corner.side < 0 ? 0 : 1) : 2);
  return candidates.sort((a, b) => rank(a) - rank(b) || b.span[1] - b.span[0] - (a.span[1] - a.span[0]))[0] ?? null;
}

export function assemblyOverlaps(project) {
  const mech = mechanism(project);
  return overlaps(project.parts, mech.placement);
}

const article = (text) => (/^(8|1[18](?!\d))/.test(text) ? 'an' : 'a');
const listed = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

function tally(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts];
}

function addedText(adds) {
  return listed(
    tally(adds).map(([key, count]) => {
      const [kind, size] = key.split('|');
      if (kind === 'tenon') return count === 1 ? `${article(size)} ${size} tenon` : `${count} × ${size} tenons`;
      return count === 1 ? `${size} for a dado` : `${count} × ${size} for dados`;
    }),
  );
}

function cutText({ mortises, grooves, holes }) {
  const notes = tally(mortises).map(([depth, count]) => {
    if (depth === 'through') return count === 1 ? 'Through mortise' : `${count} through mortises`;
    return count === 1 ? `Mortise ${depth} deep` : `${count} mortises ${depth} deep`;
  });
  notes.push(...tally(grooves).map(([size, count]) => (count === 1 ? `Dado ${size}` : `${count} dados ${size}`)));
  const drilled = new Map();
  for (const [diameter, count] of holes) drilled.set(diameter, (drilled.get(diameter) ?? 0) + count);
  notes.push(...[...drilled].map(([diameter, count]) => (count === 1 ? `Dowel hole ⌀${diameter}` : `${count} dowel holes ⌀${diameter}`)));
  return notes.join(' · ');
}

export function cutAllowances(project) {
  const pieces = new Map();
  const entry = (id) => {
    if (!pieces.has(id)) pieces.set(id, { length: 0, width: 0, adds: { length: [], width: [] }, mortises: [], grooves: [], holes: [] });
    return pieces.get(id);
  };
  for (const joint of jointsOf(project)) {
    const cut = cutJoint(project, joint);
    if (!cut) continue;
    if (joint.kind === 'dowels') {
      for (const id of [joint.part, joint.to]) entry(id).holes.push([mm(joint.diameter), joint.count]);
      continue;
    }
    const into = entry(joint.part);
    into[cut.side] += cut.reach;
    into.adds[cut.side].push(`${joint.kind}|${mm(cut.reach)}`);
    const housing = entry(joint.to);
    if (joint.kind === 'tenon') housing.mortises.push(joint.through ? 'through' : mm(cut.reach));
    else housing.grooves.push(`${mm(blank(cut.part).thickness)} × ${mm(cut.reach)}`);
  }
  return new Map(
    [...pieces].map(([id, info]) => [
      id,
      { length: roundMm(info.length), width: roundMm(info.width), lengthItems: addedText(info.adds.length), widthItems: addedText(info.adds.width), cuts: cutText(info) },
    ]),
  );
}

const HARDWARE_ORDER = ['Butt hinge', 'Concealed hinge', 'Piano hinge', 'Angle bracket', 'Mending plate', 'Corner plate', 'Screw', 'Pocket screw', 'Nail', 'Dowel pin', 'Wood glue'];
const SCREWED_HARDWARE = ['hinge', 'bracket', 'mendingPlate', 'cornerPlate'];

export function hardwareList(project) {
  const rows = new Map();
  const add = (item, size, count, usedOn) => {
    const key = `${item}|${size?.join('×') ?? ''}`;
    const row = rows.get(key) ?? { item, size, count: count === null ? null : 0, usedOn: [] };
    if (count !== null) row.count += count;
    if (!row.usedOn.includes(usedOn)) row.usedOn.push(usedOn);
    rows.set(key, row);
  };
  for (const joint of jointsOf(project)) {
    const part = findPart(project, joint.part);
    const to = findPart(project, joint.to);
    if (!part || !to) continue;
    const usedOn = `${nameOf(part)} – ${nameOf(to)}`;
    if (joint.kind === 'hinge') {
      const item = `${HINGE_TYPES[joint.hingeType].split(' ')[0]} hinge`;
      add(item, [joint.size], joint.count, usedOn);
    }
    if (joint.kind === 'bracket') add('Angle bracket', [joint.leg, joint.leg, joint.width], joint.count, usedOn);
    if (joint.kind === 'mendingPlate') add('Mending plate', [joint.length, joint.width], joint.count, usedOn);
    if (joint.kind === 'cornerPlate') add('Corner plate', [joint.leg, joint.leg, joint.width], 1, usedOn);
    if (SCREWED_HARDWARE.includes(joint.kind) && joint.screwsEach > 0) {
      add('Screw', [joint.screwDiameter, joint.screwLength], (joint.count ?? 1) * joint.screwsEach, usedOn);
    }
    if (joint.kind === 'pocketScrews') add('Pocket screw', [joint.diameter, joint.length], joint.count, usedOn);
    if (joint.kind === 'screws') add('Screw', [joint.diameter, joint.length], joint.count, usedOn);
    if (joint.kind === 'nails') add('Nail', [joint.diameter, joint.length], joint.count, usedOn);
    if (joint.kind === 'dowels') add('Dowel pin', [joint.diameter, joint.length], joint.count, usedOn);
    if (joint.kind === 'glue' || joint.glued) add('Wood glue', null, null, usedOn);
  }
  const bySize = (a, b) => (a.size ?? []).reduce((order, value, i) => order || value - b.size[i], 0);
  return [...rows.values()].sort((a, b) => HARDWARE_ORDER.indexOf(a.item) - HARDWARE_ORDER.indexOf(b.item) || bySize(a, b));
}

function spread(count, low, high, inset) {
  if (count <= 1) return [(low + high) / 2];
  const margin = Math.min(inset, (high - low) / 4);
  const step = (high - low - 2 * margin) / (count - 1);
  return Array.from({ length: count }, (_, i) => low + margin + i * step);
}

const PLATE_MM = 2;
const KNUCKLE_INSET_MM = 100;

function at(record) {
  return AXES.map((axis) => record[axis]);
}

function headsFor(joint, part, to, touch) {
  const depth = (piece) => extents(piece)[touch.axis];
  const throughPart = depth(part) <= depth(to);
  const through = throughPart ? part : to;
  const box = bounds(through);
  const outward = throughPart ? touch.sign : -touch.sign;
  const face = outward > 0 ? box.max[touch.axis] : box.min[touch.axis];
  const [long, short] = Object.keys(touch.region).sort(
    (a, b) => touch.region[b][1] - touch.region[b][0] - (touch.region[a][1] - touch.region[a][0]),
  );
  const middle = (touch.region[short][0] + touch.region[short][1]) / 2;
  const radius = Math.max(joint.kind === 'nails' ? 2.5 : 4, joint.diameter * (joint.kind === 'nails' ? 1.25 : 1));
  return spread(joint.count, ...touch.region[long], 25).map((value) => ({
    type: 'head',
    kind: joint.kind,
    joint: joint.id,
    owner: through.id,
    centre: at({ [touch.axis]: face, [long]: value, [short]: middle }),
    normal: unit(touch.axis, outward),
    radius,
  }));
}

function hingePieces(project, joint, part, info) {
  const { origin, direction, length } = info.line;
  const axis = AXES[direction.findIndex(Boolean)];
  const index = AXES.indexOf(axis);
  const low = Math.min(origin[index], origin[index] + direction[index] * length);
  const along = (value) => origin.map((coordinate, i) => (AXES[i] === axis ? value : coordinate));
  const knuckle = (centre, size, radius) => ({
    type: 'knuckle',
    joint: joint.id,
    owner: joint.to,
    from: along(centre - size / 2),
    to: along(centre + size / 2),
    radius,
  });
  if (joint.hingeType === 'concealed') {
    const touch = contact(findPart(project, joint.to), part);
    const inward = -edgeSign(info.edge);
    const cupFromEdge = 22;
    return spread(joint.count, low, low + length, KNUCKLE_INSET_MM).flatMap((value) => {
      const centre = along(value);
      centre[AXES.indexOf(edgeAxis(info.edge))] += inward * cupFromEdge;
      const cup = { type: 'head', kind: 'cup', joint: joint.id, owner: part.id, centre, normal: unit(touch.axis, -touch.sign), radius: CONCEALED_CUP_MM / 2 };
      const size = Math.min(CONCEALED_CUP_MM, length);
      return [cup, knuckle(Math.min(Math.max(value, low + size / 2), low + length - size / 2), size, 3)];
    });
  }
  const size = Math.min(joint.size, length);
  if (joint.hingeType === 'piano') return [knuckle(low + length / 2, size, 3)];
  return spread(joint.count, low + size / 2, low + length - size / 2, KNUCKLE_INSET_MM).map((centre) => knuckle(centre, size, 5));
}

function bracketPieces(joint, corner, part, to) {
  const standingSide = corner.standing === part.id ? contact(to, part).sign : -contact(to, part).sign;
  const plates = [];
  for (const centre of spread(joint.count, ...corner.span, 50)) {
    const half = joint.width / 2;
    const lying = {
      [corner.axis]: [corner.at, corner.at + standingSide * PLATE_MM],
      [corner.across]: [corner.edge, corner.edge + corner.side * joint.leg],
      [corner.along]: [centre - half, centre + half],
    };
    const standing = {
      [corner.axis]: [corner.at, corner.at + standingSide * joint.leg],
      [corner.across]: [corner.edge, corner.edge + corner.side * PLATE_MM],
      [corner.along]: [centre - half, centre + half],
    };
    for (const box of [lying, standing]) {
      const min = at(Object.fromEntries(AXES.map((axis) => [axis, Math.min(...box[axis])])));
      const max = at(Object.fromEntries(AXES.map((axis) => [axis, Math.max(...box[axis])])));
      plates.push({ type: 'plate', joint: joint.id, owner: corner.standing, min, max });
    }
  }
  return plates;
}

const middleOf = ([low, high]) => (low + high) / 2;
const corners = (box) => ({ min: AXES.map((axis) => Math.min(...box[axis])), max: AXES.map((axis) => Math.max(...box[axis])) });

function dowelTraces(joint, { part, to, touch }) {
  const { axis, sign, at: plane, region } = touch;
  const [long, short] = longAndShort(region);
  const intoTo = Math.min(holeDepth(to, part, joint), Math.max(joint.length / 2, joint.length - holeDepth(part, to, joint)));
  const ends = [plane - sign * (joint.length - intoTo), plane + sign * intoTo];
  return spread(joint.count, ...region[long], 25).map((value) => {
    const [from, end] = ends.map((coordinate) => at({ [axis]: coordinate, [long]: value, [short]: middleOf(region[short]) }));
    return { type: 'dowel', owner: part.id, from, to: end, radius: joint.diameter / 2 };
  });
}

function onEnd(span, size, end) {
  const low = middleOf(span) - size / 2;
  const shift = size > end[1] - end[0] ? 0 : Math.max(0, end[0] - low) - Math.max(0, low + size - end[1]);
  return [low + shift, low + shift + size];
}

function grooveSpan({ to, touch, room, reach }) {
  const { axis, sign, at: plane, region } = touch;
  const middle = middleOf(region[room.along]);
  const runs = region[room.across].map((edge) => {
    const point = at({ [axis]: plane + (sign * reach) / 2, [room.across]: edge, [room.along]: middle });
    return woodRuns(solidOf(to), AXES.indexOf(room.along), point).find(([from, end]) => from <= middle && end >= middle);
  });
  if (runs.some((run) => !run)) return region[room.along];
  return [Math.max(...runs.map(([from]) => from)) + 0, Math.min(...runs.map(([, end]) => end)) + 0];
}

function cutPieces(project, joint) {
  const cut = cutJoint(project, joint);
  if (!cut) return { wood: [], xray: [] };
  if (joint.kind === 'dowels') return { wood: [], xray: dowelTraces(joint, cut) };
  const { part, to, touch, reach } = cut;
  const { axis, sign, at: plane, region } = touch;
  const { across, along } = cut.room;
  const box = { [axis]: [plane, plane + sign * reach], [across]: region[across], [along]: region[along] };
  if (joint.kind === 'tenon') {
    const end = corners({ ...box, ...tenonSpot(part, touch, joint) });
    return { wood: [{ type: 'wood', joint: joint.id, owner: part.id, species: part.species, ...end }], xray: [{ type: 'box', owner: part.id, ...end }] };
  }
  const length = grooveSpan(cut);
  box[along] = [Math.max(region[along][0], length[0]), Math.min(region[along][1], length[1])];
  const wood = [{ type: 'wood', joint: joint.id, owner: part.id, species: part.species, ...corners(box) }];
  return { wood, xray: [{ type: 'box', owner: to.id, ...corners({ ...box, [along]: length }) }] };
}

export function joineryXray(project, id) {
  return jointsOf(project)
    .filter((joint) => joint.part === id || joint.to === id)
    .flatMap((joint) => cutPieces(project, joint).xray);
}

const spots = (count, low, high, inset) => (count > 0 ? spread(count, low, high, inset) : []);

function boxBetween(owner, joint, ranges) {
  const ends = Object.fromEntries(AXES.map((axis) => [axis, [Math.min(...ranges[axis]), Math.max(...ranges[axis])]]));
  return { type: 'plate', joint: joint.id, owner, min: AXES.map((axis) => ends[axis][0]), max: AXES.map((axis) => ends[axis][1]) };
}

function plateHead(joint, owner, face, coordinate, spot) {
  return {
    type: 'head',
    kind: 'plateScrew',
    joint: joint.id,
    owner,
    centre: at({ [edgeAxis(face)]: coordinate, ...spot }),
    normal: unit(edgeAxis(face), edgeSign(face)),
    radius: Math.max(2.5, joint.screwDiameter * 0.9),
  };
}

function platePieces(joint, part, to, touch) {
  const face = plateFace(joint, part, to, touch);
  if (!face || plateRefusal(joint.kind, part, to, touch)) return [];
  const across = edgeAxis(face);
  const surface = edgeCoordinate(part, face);
  const outside = surface + edgeSign(face) * PLATE_MM;
  const sheet = [surface, outside];
  const pieces = [];
  if (joint.kind === 'mendingPlate') {
    const along = thirdAxis(touch.axis, across);
    const half = joint.length / 2;
    for (const centre of spread(joint.count, ...touch.region[along], joint.width)) {
      pieces.push(boxBetween(to.id, joint, { [touch.axis]: [touch.at - half, touch.at + half], [across]: sheet, [along]: [centre - joint.width / 2, centre + joint.width / 2] }));
      const screws = spots(joint.screwsEach, touch.at - half, touch.at + half, joint.length / 8);
      for (const spot of screws) pieces.push(plateHead(joint, to.id, face, outside, { [touch.axis]: spot, [along]: centre }));
    }
    return pieces;
  }
  const { along, end, out, into } = plateCorner(part, to, touch, face);
  const { leg, width } = joint;
  const inner = end - out * width;
  pieces.push(boxBetween(to.id, joint, { [touch.axis]: [touch.at, touch.at + into * width], [across]: sheet, [along]: [inner, inner + out * leg] }));
  pieces.push(boxBetween(to.id, joint, { [touch.axis]: [touch.at - into * (leg - width), touch.at], [across]: sheet, [along]: [inner, end] }));
  const onGoing = Math.ceil(joint.screwsEach / 2);
  for (const spot of spots(onGoing, end, inner + out * leg, width / 2)) {
    pieces.push(plateHead(joint, to.id, face, outside, { [touch.axis]: touch.at + (into * width) / 2, [along]: spot }));
  }
  for (const spot of spots(joint.screwsEach - onGoing, touch.at - into * (leg - width), touch.at, width / 2)) {
    pieces.push(plateHead(joint, to.id, face, outside, { [touch.axis]: spot, [along]: end - (out * width) / 2 }));
  }
  return pieces;
}

const POCKET = { fromEnd: 22, length: 24, width: 10 };

function pocketPieces(joint, part, touch) {
  const axis = thicknessAxis(part);
  if (axis === touch.axis || !joint.count) return [];
  const face = edgeAxis(joint.face) === axis ? joint.face : `-${axis}`;
  const along = thirdAxis(touch.axis, axis);
  const back = Math.min(POCKET.fromEnd, extents(part)[touch.axis] / 2);
  return spread(joint.count, ...touch.region[along], 25).map((spot) => ({
    type: 'pocket',
    joint: joint.id,
    owner: part.id,
    centre: at({ [touch.axis]: touch.at + touch.sign * back, [axis]: edgeCoordinate(part, face), [along]: spot }),
    normal: unit(axis, edgeSign(face)),
    along: unit(touch.axis, -touch.sign),
    length: POCKET.length,
    width: POCKET.width,
  }));
}

export function hardwarePieces(project) {
  const mech = mechanism(project);
  return jointsOf(project).flatMap((joint) => {
    const part = findPart(project, joint.part);
    const to = findPart(project, joint.to);
    const touch = part && to && contact(to, part);
    if (!touch) return [];
    if (joint.kind === 'screws' || joint.kind === 'nails') return headsFor(joint, part, to, touch);
    if (joint.kind === 'hinge') return hingePieces(project, joint, part, mech.hinges.get(joint.id));
    if (CUT_KINDS.includes(joint.kind)) return cutPieces(project, joint).wood;
    if (joint.kind === 'bracket') {
      const corner = insideCorner(to, part);
      return corner ? bracketPieces(joint, corner, part, to) : [];
    }
    if (plateKind(joint.kind)) return platePieces(joint, part, to, touch);
    if (joint.kind === 'pocketScrews') return pocketPieces(joint, part, touch);
    return [];
  });
}

export function hingeAxis(project, jointId) {
  const mech = mechanism(project);
  const info = mech.hinges.get(jointId);
  if (!info?.line) return null;
  const frame = mech.frameOf(info);
  const clean = (value) => Math.round(value * 1000) / 1000 + 0;
  return {
    origin: transformPoint(frame, info.line.origin).map(clean),
    direction: apply(frame.m, info.line.direction).map(clean),
    length: info.line.length,
  };
}

export function dragMode(project, id) {
  const hinge = swingingHinge(project, id);
  if (hinge) return movingParts(project, hinge.id).some((part) => part.locked) ? 'none' : 'swing';
  const members = joinedTo(project, id);
  return project.parts.some((part) => members.has(part.id) && part.locked) ? 'none' : 'move';
}
