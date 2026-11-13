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
  assert.match(text, /"version": 4/);
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
  assert.throws(() => parseProject('{"format":"woodworking-planner","version":5,"parts":[]}'), /newer version/);
});

test('a hinge saved before doors could be stopped opens with the stop on; a hinge saved with it off keeps it off', () => {
  const saved = JSON.parse(serialize(hungDoor()));
  delete saved.joints[0].stops;
  const old = parseProject(JSON.stringify({ ...saved, version: 3 }));
  assert.equal(old.joints[0].stops, true);
  saved.joints[0].stops = false;
  assert.equal(parseProject(JSON.stringify(saved)).joints[0].stops, false);
  saved.joints[0].stops = 'no';
  assert.throws(() => parseProject(JSON.stringify(saved)), /Joint 1 has an invalid stops/);
});

test('plates and pocket screws are saved and load back with their face', () => {
  const stile = makePart({ name: 'Stile', length: 600, width: 60, thickness: 18, pose: legacyPose('yxz') });
  const rail = makePart({ name: 'Rail', length: 400, width: 60, thickness: 18, pose: legacyPose('xyz'), x: 60 });
  const top = makePart({ name: 'Top rail', length: 400, width: 60, thickness: 18, pose: legacyPose('xyz'), x: 60, y: 540 });
  let state = { name: 'Frame', parts: [stile, rail, top], joints: [] };
  state = joinParts(state, 'cornerPlate', rail.id, stile.id).project;
  state = joinParts(state, 'pocketScrews', top.id, stile.id).project;
  state = updateJoint(state, state.joints[1].id, 'face', '+z');
  const loaded = parseProject(serialize(state));
  assert.deepEqual(loaded.joints.map((joint) => [joint.kind, joint.face]), [['cornerPlate', '-z'], ['pocketScrews', '+z']]);
  assert.equal(loaded.joints[0].leg, 80);
});
