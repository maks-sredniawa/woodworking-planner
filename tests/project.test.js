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
  assert.match(text, /"version": 3/);
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
  assert.throws(() => parseProject('{"format":"woodworking-planner","version":4,"parts":[]}'), /newer version/);
});
