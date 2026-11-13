import { legacyPose, makePart, newId, partFromFile, roundMm } from './model.js';
import { JOINT_FIELDS, JOINT_KINDS, jointFieldValue } from './joints.js';
import { cuttingFromFile, cuttingToFile } from './cutplan.js';

export const FORMAT = 'woodworking-planner';
export const FORMAT_VERSION = 4;

export function serialize(project) {
  const index = new Map(project.parts.map((part, i) => [part.id, i]));
  return JSON.stringify(
    {
      format: FORMAT,
      version: FORMAT_VERSION,
      name: project.name,
      parts: project.parts.map(({ id, ...rest }) => rest),
      joints: (project.joints ?? []).map(({ id, part, to, ...rest }) => ({ ...rest, part: index.get(part), to: index.get(to) })),
      cutting: cuttingToFile(project),
    },
    null,
    2,
  );
}

function jointFromFile(raw, index, parts, earlier) {
  const where = `Joint ${index + 1}`;
  if (!Object.hasOwn(JOINT_KINDS, raw?.kind)) throw new Error(`${where} has an invalid kind.`);
  const ends = [raw.part, raw.to];
  if (!ends.every((end) => Number.isInteger(end) && end >= 0 && end < parts.length)) {
    throw new Error(`${where} joins a piece that is not in the project.`);
  }
  if (raw.part === raw.to) throw new Error(`${where} joins a piece to itself.`);
  const pair = [raw.part, raw.to].sort().join(':');
  if (earlier.has(pair)) throw new Error(`${where} joins the same two pieces as an earlier joint.`);
  earlier.add(pair);
  const joint = { id: newId(), kind: raw.kind, part: parts[raw.part].id, to: parts[raw.to].id };
  for (const field of Object.keys(JOINT_FIELDS[raw.kind])) {
    const value = jointFieldValue(raw.kind, field, raw[field]);
    if (value === undefined) throw new Error(`${where} has an invalid ${field}.`);
    joint[field] = value;
  }
  if (raw.kind === 'hinge' && joint.open > joint.opensTo) throw new Error(`${where} has an invalid open.`);
  return joint;
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
  const parts = data.parts.map(partFromFile);
  const earlier = new Set();
  const joints = Array.isArray(data.joints) ? data.joints.map((raw, index) => jointFromFile(raw, index, parts, earlier)) : [];
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.slice(0, 80) : 'Untitled project';
  const cutting = cuttingFromFile(data.cutting);
  return { name, parts, joints, cutting };
}

export function starterProject() {
  const sheet = 18;
  const depth = 244;
  const width = 800;
  const height = 1000;
  const inner = width - 2 * sheet;
  const gap = (height - 4 * sheet) / 3;
  const shelf = (name, y) =>
    makePart({ name, length: inner, width: depth, thickness: sheet, pose: legacyPose('xzy'), x: sheet, y: roundMm(y), z: 6 });
  return {
    name: 'Small bookshelf',
    parts: [
      makePart({ name: 'Back panel', length: height, width, thickness: 6, pose: legacyPose('yxz'), species: 'birchPlywood' }),
      makePart({ name: 'Side', length: height, width: depth, thickness: sheet, pose: legacyPose('yzx'), z: 6 }),
      makePart({ name: 'Side', length: height, width: depth, thickness: sheet, pose: legacyPose('yzx'), x: width - sheet, z: 6 }),
      shelf('Bottom', 0),
      shelf('Shelf', sheet + gap),
      shelf('Shelf', 2 * (sheet + gap)),
      shelf('Top', height - sheet),
    ],
    joints: [],
  };
}

