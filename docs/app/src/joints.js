import {
  MAX_SIZE_MM,
  bounds,
  extents,
  movePart,
  newId,
  poseAxes,
  projectBounds,
  recentre,
  rotatePart,
  roundMm,
  snapBoxes,
  turnAxis,
} from './model.js';

const AXES = ['x', 'y', 'z'];
const TOUCH_MM = 0.05;

const near = (a, b) => Math.abs(a - b) < TOUCH_MM;
const findPart = (project, id) => project.parts.find((part) => part.id === id);
const jointsOf = (project) => project.joints ?? [];
const nameOf = (part) => part?.name || 'Unnamed';

export function contact(a, b) {
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
};

export const HINGE_TYPES = { butt: 'Butt', concealed: 'Concealed (35 mm cup)', piano: 'Piano' };
export const EDGES = { '-x': 'Left edge', '+x': 'Right edge', '-y': 'Bottom edge', '+y': 'Top edge', '-z': 'Back edge', '+z': 'Front edge' };

const SCREW_LENGTHS = [12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120];
const NAIL_LENGTHS = [15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100];
const BRACKET_LEGS = [20, 30, 40, 50, 60, 80, 100];
const CONCEALED_CUP_MM = 35;
const CONCEALED_DOOR_MM = 16;
const EDGE_PREFERENCE = ['-z', '-x', '+y', '+x', '-y', '+z'];

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
};

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

const isIdentity = (placement) => placement.m.every((value, i) => Math.abs(value - IDENTITY.m[i]) < 1e-9) && placement.o.every((value) => Math.abs(value) < 1e-9);

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
  if ((joint.kind === 'screws' || joint.kind === 'nails') && joint.length > meet.through + meet.into) {
    return `Longer than both pieces together (${roundBox(meet.through + meet.into)} mm): it will come out the other side.`;
  }
  return null;
}

export function joinParts(project, kind, partId, toId) {
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
  const joint = { id: newId(), kind, part: partId, to: toId, ...DEFAULTS[kind](meet, part, to) };
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
const degrees = (least, most) => (raw) => {
  const value = Math.round(Number(raw) * 10) / 10;
  return raw !== '' && Number.isFinite(value) && value >= least && value <= most ? value : undefined;
};

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
};

export function jointFieldValue(kind, field, raw) {
  return JOINT_FIELDS[kind]?.[field]?.(raw);
}

export function suggestedSizes(project, joint) {
  const part = findPart(project, joint.part);
  const to = findPart(project, joint.to);
  const meet = part && to && meeting(part, to);
  if (!meet) return null;
  if (joint.kind !== 'hinge') return { ...DEFAULTS[joint.kind](meet, part, to), ...('glued' in joint ? { glued: joint.glued } : {}) };
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
  let next = { ...joint, [field]: value };
  if (field === 'open' && value > joint.opensTo) return { refused: 'limit' };
  if (field === 'edge' && !hingeEdges(project, joint).includes(value)) return { refused: 'invalid' };
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
  const { moving, fixed } = actualBoxes(project, joinedTo(project, id));
  return snapBoxes(findPart(project, id), moving, proposed, fixed, options);
}

const pushedPast = (before, after) =>
  AXES.some((axis) => Math.abs(after.min[axis]) > MAX_SIZE_MM && Math.abs(after.min[axis]) > Math.abs(before.min[axis]));

export function moveAssembly(project, id, position) {
  const piece = findPart(project, id);
  if (!piece) return project;
  const members = joinedTo(project, id);
  const parts = project.parts.filter((part) => members.has(part.id));
  if (parts.some((part) => part.locked)) return project;
  const delta = Object.fromEntries(Object.entries(position).map(([axis, value]) => [axis, value - piece[axis]]));
  const moved = new Map();
  for (const part of parts) {
    const target = Object.fromEntries(Object.entries(delta).map(([axis, change]) => [axis, part[axis] + change]));
    const next = movePart(part, target);
    if (next === part && Object.values(delta).some(Boolean)) return project;
    moved.set(part.id, next);
  }
  const next = { ...project, parts: project.parts.map((part) => moved.get(part.id) ?? part) };
  const before = actualBoxes(project, members).moving;
  const after = actualBoxes(next, members).moving;
  return after.some((box, i) => pushedPast(before[i], box)) ? project : next;
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
  const joints = jointsOf(project).map((joint) =>
    joint.kind === 'hinge' && members.has(joint.part) ? { ...joint, edge: turnAxis(joint.edge, axis) } : joint,
  );
  return { ...project, parts: project.parts.map((part) => byId.get(part.id) ?? part), joints };
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

function orientedBox(part, placement) {
  const box = bounds(part);
  const centre = transformPoint(placement, AXES.map((axis) => (box.min[axis] + box.max[axis]) / 2));
  const half = AXES.map((axis) => (box.max[axis] - box.min[axis]) / 2);
  const axes = [0, 1, 2].map((col) => [placement.m[col], placement.m[3 + col], placement.m[6 + col]]);
  return { centre, half, axes };
}

function separated(a, b) {
  const tests = [...a.axes, ...b.axes];
  for (const first of a.axes) for (const second of b.axes) tests.push(cross(first, second));
  const gap = b.centre.map((value, i) => value - a.centre[i]);
  return tests.some((axis) => {
    const size = Math.hypot(...axis);
    if (size < 1e-6) return false;
    const unitAxis = axis.map((value) => value / size);
    const reach = (box) => box.axes.reduce((sum, each, i) => sum + box.half[i] * Math.abs(dot(each, unitAxis)), 0);
    return Math.abs(dot(gap, unitAxis)) >= reach(a) + reach(b) - TOUCH_MM;
  });
}

export function assemblyOverlaps(project) {
  const mech = mechanism(project);
  const boxes = project.parts.map((part) => orientedBox(part, mech.placement(part.id)));
  const pairs = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!separated(boxes[i], boxes[j])) pairs.push([project.parts[i].id, project.parts[j].id]);
    }
  }
  return pairs;
}

const HARDWARE_ORDER = ['Butt hinge', 'Concealed hinge', 'Piano hinge', 'Angle bracket', 'Screw', 'Nail', 'Wood glue'];

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
    if ((joint.kind === 'hinge' || joint.kind === 'bracket') && joint.screwsEach > 0) {
      add('Screw', [joint.screwDiameter, joint.screwLength], joint.count * joint.screwsEach, usedOn);
    }
    if (joint.kind === 'screws') add('Screw', [joint.diameter, joint.length], joint.count, usedOn);
    if (joint.kind === 'nails') add('Nail', [joint.diameter, joint.length], joint.count, usedOn);
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
      return [cup, knuckle(value, Math.min(CONCEALED_CUP_MM, length), 3)];
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

export function hardwarePieces(project) {
  const mech = mechanism(project);
  return jointsOf(project).flatMap((joint) => {
    const part = findPart(project, joint.part);
    const to = findPart(project, joint.to);
    const touch = part && to && contact(to, part);
    if (!touch) return [];
    if (joint.kind === 'screws' || joint.kind === 'nails') return headsFor(joint, part, to, touch);
    if (joint.kind === 'hinge') return hingePieces(project, joint, part, mech.hinges.get(joint.id));
    if (joint.kind === 'bracket') {
      const corner = insideCorner(to, part);
      return corner ? bracketPieces(joint, corner, part, to) : [];
    }
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
