import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPose, makePart } from '../docs/app/src/model.js';
import { assemblyOverlaps, changeJoint, joinParts, jointProblem, swingStop, updateJoint } from '../docs/app/src/joints.js';

const side = () => makePart({ name: 'Side', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx') });
const door = () => makePart({ name: 'Door', length: 800, width: 400, thickness: 18, pose: legacyPose('yxz'), z: 244 });
const block = (name, [x0, x1], [z0, z1]) =>
  makePart({ name, length: x1 - x0, width: 100, thickness: z1 - z0, pose: legacyPose('xyz'), x: x0, y: 0, z: z0 });

function hungWith(...others) {
  const frame = side();
  const leaf = door();
  const { project, joint } = joinParts({ name: 'Cabinet', parts: [frame, leaf, ...others], joints: [] }, 'hinge', leaf.id, frame.id);
  return { project, joint, others };
}

test('a hinge stops at the first piece in its way by default, and nothing is in the way of a lone door', () => {
  const { project, joint } = hungWith();
  assert.equal(joint.stops, true);
  assert.equal(swingStop(project, joint.id), null);
});

test('a wall beside the hinge stops the door at 90°, a whole degree, without overlapping it', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = hungWith(wall);
  assert.deepEqual(swingStop(project, joint.id), { angle: 90, by: wall.id });
  const opened = changeJoint(project, joint.id, 'open', 150);
  assert.equal(opened.project.joints[0].open, 90);
  assert.deepEqual(opened.stopped, { angle: 90, by: wall.id });
  assert.deepEqual(assemblyOverlaps(opened.project), []);
  assert.equal(changeJoint(project, joint.id, 'open', 60).stopped, undefined);
});

test('a post in the swing stops the door where its front face reaches the post’s corner, rounded down', () => {
  const post = block('Post', [50, 100], [544, 600]);
  const { project, joint } = hungWith(post);
  const corner = Math.atan2(300, 100) - Math.asin(18 / Math.hypot(100, 300));
  assert.deepEqual(swingStop(project, joint.id), { angle: Math.floor((corner * 180) / Math.PI), by: post.id });
  assert.deepEqual(swingStop(project, joint.id).angle, 68);
});

test('a piece against the front of the closed door keeps it from opening at all', () => {
  const blocker = block('Blocker', [100, 200], [262, 300]);
  const { project, joint } = hungWith(blocker);
  assert.deepEqual(swingStop(project, joint.id), { angle: 0, by: blocker.id });
  assert.equal(changeJoint(project, joint.id, 'open', 45).project.joints[0].open, 0);
});

test('unticked, the door swings through as before, and the hinge’s own limit still applies when nothing is in the way', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = hungWith(wall);
  const through = updateJoint(project, joint.id, 'stops', false);
  assert.equal(swingStop(through, joint.id), null);
  assert.equal(updateJoint(through, joint.id, 'open', 150).joints[0].open, 150);
  const roomy = updateJoint(project, joint.id, 'opensTo', 60);
  assert.equal(swingStop(roomy, joint.id), null);
});

test('pieces fixed to the door swing with it and are not in its way; a piece fixed to the frame is', () => {
  const knob = makePart({ name: 'Knob', length: 30, width: 30, thickness: 30, pose: legacyPose('xyz'), x: 300, y: 300, z: 262 });
  const { project: hinged, joint } = hungWith(knob);
  const fixed = joinParts(hinged, 'glue', knob.id, joint.part).project;
  assert.equal(swingStop(fixed, joint.id), null);
  assert.deepEqual(swingStop(hinged, joint.id), { angle: 0, by: knob.id });
});

test('a door already open past a piece is left where it is and warned about', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = hungWith(wall);
  const open = updateJoint(updateJoint(updateJoint(project, joint.id, 'stops', false), joint.id, 'open', 120), joint.id, 'stops', true);
  assert.equal(open.joints[0].open, 120);
  assert.equal(jointProblem(open, joint.id), 'Door is open 120°, past Wall at 90°. Close it to 90° or move Wall.');
  assert.equal(jointProblem(updateJoint(open, joint.id, 'open', 30), joint.id), null);
});

test('a stop never swings a locked door', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = hungWith(wall);
  const locked = { ...project, parts: project.parts.map((part) => (part.id === joint.part ? { ...part, locked: true } : part)) };
  assert.equal(changeJoint(locked, joint.id, 'open', 150).refused, 'locked');
});
