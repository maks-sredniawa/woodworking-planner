import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPose, makePart } from '../docs/app/src/model.js';
import { joinParts, updateJoint, worldBounds } from '../docs/app/src/joints.js';
import { parseProject, serialize, starterProject } from '../docs/app/src/project.js';

const hungDoor = () => {
  const side = makePart({ name: 'Side', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx') });
  const door = makePart({ name: 'Door', length: 800, width: 400, thickness: 18, pose: legacyPose('yxz'), z: 244 });
  const { project, joint } = joinParts({ name: 'Cabinet', parts: [side, door], joints: [] }, 'hinge', door.id, side.id);
  return updateJoint(project, joint.id, 'open', 35);
};

test('joints are saved with the project and load back joining the same pieces', () => {
  const saved = hungDoor();
  const text = serialize(saved);
  assert.match(text, /"version": 6/);
  const loaded = parseProject(text);
  assert.equal(loaded.joints.length, 1);
  const [joint] = loaded.joints;
  const name = (id) => loaded.parts.find((part) => part.id === id).name;
  assert.deepEqual([joint.kind, name(joint.part), name(joint.to), joint.open, joint.edge], ['hinge', 'Door', 'Side', 35, '-x']);
  assert.deepEqual(worldBounds(loaded, joint.part), worldBounds(saved, saved.joints[0].part));
});

test('older files and the example load with no joints', () => {
  assert.deepEqual(parseProject('{"format":"woodworking-planner","version":2,"parts":[]}').joints, []);
  assert.deepEqual(starterProject().joints, []);
});

test('a file with a broken joint is refused with the joint named', () => {
  const file = (joints) => JSON.stringify({ format: 'woodworking-planner', version: 3, parts: [{}, {}], joints });
  assert.throws(() => parseProject(file([{ kind: 'rivet', part: 0, to: 1 }])), /Joint 1 has an invalid kind/);
  assert.throws(() => parseProject(file([{ kind: 'glue', part: 0, to: 5 }])), /Joint 1 joins a piece that is not in the project/);
  assert.throws(() => parseProject(file([{ kind: 'glue', part: 0, to: 0 }])), /Joint 1 joins a piece to itself/);
  assert.throws(() => parseProject(file([{ kind: 'screws', part: 0, to: 1, count: 0, diameter: 4, length: 40, glued: false }])), /Joint 1 has an invalid count/);
  assert.throws(() => parseProject(file([{ kind: 'glue', part: 0, to: 1 }, { kind: 'glue', part: 1, to: 0 }])), /Joint 2 joins the same two pieces as an earlier joint/);
  assert.throws(() => parseProject('{"format":"woodworking-planner","version":7,"parts":[]}'), /newer version/);
});

test('cut joints are saved with their sizes and load back with the same piece going in', () => {
  const leg = makePart({ name: 'Leg', length: 700, width: 45, thickness: 45, pose: legacyPose('yzx') });
  const rail = makePart({ name: 'Rail', length: 600, width: 80, thickness: 24, pose: legacyPose('xyz'), x: 45, y: 600, z: 10 });
  const joined = joinParts({ name: 'Frame', parts: [leg, rail], joints: [] }, 'tenon', leg.id, rail.id).project;
  const saved = updateJoint(updateJoint(joined, joined.joints[0].id, 'through', true), joined.joints[0].id, 'glued', false);
  const loaded = parseProject(serialize(saved));
  const [joint] = loaded.joints;
  const name = (id) => loaded.parts.find((part) => part.id === id).name;
  assert.deepEqual(
    [joint.kind, name(joint.part), name(joint.to), joint.length, joint.thickness, joint.width, joint.through, joint.glued],
    ['tenon', 'Rail', 'Leg', 30, 8, 60, true, false],
  );
  assert.equal(parseProject(serialize({ ...saved, joints: [] })).joints.length, 0);
});

test('a version 4 file with a free shape and no cut joints opens as before', () => {
  const outline = [{ x: 0, y: 0, bend: 0 }, { x: 400, y: 0, bend: 0 }, { x: 400, y: 300, bend: 0 }, { x: 0, y: 300, bend: 0 }];
  const text = JSON.stringify({
    format: 'woodworking-planner',
    version: 4,
    name: 'Shapes',
    parts: [{ name: 'Top', shape: 'free', points: outline, thickness: 18 }, { name: 'Side', length: 500, width: 200, thickness: 18 }],
    joints: [{ kind: 'glue', part: 0, to: 1 }],
  });
  const loaded = parseProject(text);
  const [top, side] = loaded.parts;
  assert.deepEqual([top.shape, top.length, top.width, top.points.map(({ x, y }) => [x, y])], ['free', 400, 300, outline.map(({ x, y }) => [x, y])]);
  assert.deepEqual([side.shape, side.length, side.width], ['board', 500, 200]);
  assert.deepEqual(loaded.joints.map(({ kind, part, to }) => [kind, part, to]), [['glue', top.id, side.id]]);
  assert.match(serialize(loaded), /"version": 6/);
});

test('a version 5 file with cut joints saves back the same joints', () => {
  const joints = [
    { kind: 'tenon', part: 1, to: 0, length: 30, thickness: 8, width: 60, through: true, glued: false },
    { kind: 'dado', part: 2, to: 0, depth: 6, glued: true },
    { kind: 'dowels', part: 3, to: 0, count: 4, diameter: 8, length: 40, glued: true },
  ];
  const text = JSON.stringify({ format: 'woodworking-planner', version: 5, name: 'Frame', parts: [{}, {}, {}, {}], joints });
  const saved = JSON.parse(serialize(parseProject(text)));
  assert.equal(saved.version, 6);
  assert.deepEqual(saved.joints, joints);
});
