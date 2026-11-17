import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPose, makePart, makeShape, updatePart } from '../docs/app/src/model.js';
import { assemblyOverlaps, changeJoint, joinParts, jointProblem, swingStop, updateJoint } from '../docs/app/src/joints.js';
import { parseProject, serialize } from '../docs/app/src/project.js';
import { projectPieces } from '../docs/app/src/cutplan.js';

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

test('a free-shape door stops at the wall where a board door of the same outline does', () => {
  const frame = side();
  const leaf = updatePart(door(), 'shape', 'free');
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = joinParts({ name: 'Cabinet', parts: [frame, leaf, wall], joints: [] }, 'hinge', leaf.id, frame.id);
  assert.deepEqual(swingStop(project, joint.id), { angle: 90, by: wall.id });
});

function roundDoorWith(...others) {
  const frame = side();
  const leaf = { ...makeShape('disc'), name: 'Round door', pose: legacyPose('yxz'), z: 244 };
  return joinParts({ name: 'Cabinet', parts: [frame, leaf, ...others], joints: [] }, 'hinge', leaf.id, frame.id);
}

const cube = (name, x, z) => makePart({ name, length: 50, width: 50, thickness: 50, pose: legacyPose('xyz'), x, y: 0, z });

test('a round door swings past a block in the corner of its box and stops at one on its rim', () => {
  const corner = cube('Corner', -30, 594);
  const past = roundDoorWith(corner);
  assert.equal(swingStop(past.project, past.joint.id), null);
  assert.equal(changeJoint(past.project, past.joint.id, 'open', 90).project.joints[0].open, 90);
  const rim = cube('Rim', -30, 419);
  const stopped = roundDoorWith(rim);
  const stop = swingStop(stopped.project, stopped.joint.id);
  assert.equal(stop.by, rim.id);
  assert.ok(stop.angle > 45 && stop.angle < 90, stop.angle);
  const opened = changeJoint(stopped.project, stopped.joint.id, 'open', 90);
  assert.equal(opened.project.joints[0].open, stop.angle);
  assert.deepEqual(assemblyOverlaps(opened.project), []);
});

function insetDoor(width, ...others) {
  const left = makePart({ name: 'Left', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx') });
  const right = makePart({ name: 'Right', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx'), x: 18 + width });
  const leaf = makePart({ name: 'Door', length: 800, width, thickness: 18, pose: legacyPose('yxz'), x: 18, z: 226 });
  const hung = joinParts({ name: 'Cabinet', parts: [left, right, leaf, ...others], joints: [] }, 'hinge', leaf.id, left.id);
  return { project: updateJoint(hung.project, hung.joint.id, 'edge', '+z'), joint: hung.joint, right };
}

test('an inset door flush between two sides opens with the stop on, though its corner grazes the far side by under 1 mm', () => {
  const { project, joint } = insetDoor(400);
  assert.equal(swingStop(project, joint.id), null);
  assert.equal(changeJoint(project, joint.id, 'open', 90).project.joints[0].open, 90);
});

test('a side the closed door almost touches is grazed the same way as one it touches', () => {
  const { project, joint, right } = insetDoor(400);
  const apart = { ...project, parts: project.parts.map((part) => (part.id === right.id ? { ...part, x: part.x + 0.3 } : part)) };
  assert.equal(swingStop(apart, joint.id), null);
});

test('a narrow inset door whose corner would cut over 1 mm into the far side stops before it does', () => {
  const { project, joint, right } = insetDoor(100);
  const over = (angle) => 100 * Math.cos(angle) + 18 * Math.sin(angle) - 100 - 1;
  let [low, high] = [0, Math.atan2(18, 100)];
  for (let i = 0; i < 40; i++) [low, high] = over((low + high) / 2) > 0 ? [low, (low + high) / 2] : [(low + high) / 2, high];
  assert.deepEqual(swingStop(project, joint.id), { angle: Math.floor((low * 180) / Math.PI), by: right.id });
  assert.equal(swingStop(project, joint.id).angle, 3);
});

test('a piece in the swing still stops a flush inset door', () => {
  const post = block('Post', [250, 300], [300, 350]);
  const { project, joint } = insetDoor(400, post);
  const stop = swingStop(project, joint.id);
  assert.equal(stop.by, post.id);
  assert.ok(stop.angle > 0 && stop.angle < 90, stop.angle);
});

test('a version 3 project with a flush inset door open 90° loads without being open past the far side', () => {
  const { project, joint } = insetDoor(400);
  const saved = JSON.parse(serialize(updateJoint(updateJoint(project, joint.id, 'stops', false), joint.id, 'open', 90)));
  delete saved.joints[0].stops;
  const loaded = parseProject(JSON.stringify({ ...saved, version: 3 }));
  assert.equal(loaded.joints[0].stops, true);
  assert.equal(loaded.joints[0].open, 90);
  assert.equal(jointProblem(loaded, loaded.joints[0].id), null);
});

test('a door with cutting settings in the project stops the same, is laid out flat at its own size, and keeps both on saving', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = hungWith(wall);
  const cutting = { kerf: 4, trim: 2, stock: { 'pine:18': { length: 3000, width: 500, own: true } } };
  const opened = changeJoint({ ...project, cutting }, joint.id, 'open', 150);
  assert.deepEqual(opened.stopped, { angle: 90, by: wall.id });
  const laid = projectPieces(opened.project).find((piece) => piece.name === 'Door');
  assert.deepEqual([laid.length, laid.width, laid.thickness], [800, 400, 18]);
  const loaded = parseProject(serialize(opened.project));
  assert.deepEqual(loaded.cutting, cutting);
  assert.deepEqual([loaded.joints[0].stops, loaded.joints[0].open], [true, 90]);
  assert.deepEqual(swingStop(loaded, loaded.joints[0].id).angle, 90);
});

test('a swing drag finds the stop once at its start and reuses it on every move, even handed a fresh copy of the start each time', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project: start, joint } = hungWith(wall);
  const found = swingStop(start, joint.id);
  let current = start;
  for (let angle = 5; angle <= 150; angle += 5) {
    const copy = { ...start, parts: current.parts };
    const moved = changeJoint(copy, joint.id, 'open', angle);
    assert.equal(moved.stopped ?? swingStop(moved.project, joint.id), found);
    current = moved.project;
  }
  assert.equal(current.joints[0].open, 90);
});

test('a stop is kept across edits that leave the pieces where they are, and found again when a piece moves', () => {
  const wall = block('Wall', [-100, -18], [244, 700]);
  const { project, joint } = hungWith(wall);
  const found = swingStop(project, joint.id);
  const renamed = { ...project, name: 'Wardrobe' };
  assert.equal(swingStop(renamed, joint.id), found);
  const moved = { ...project, parts: project.parts.map((part) => (part.id === wall.id ? { ...part, z: part.z + 600 } : part)) };
  assert.equal(swingStop(moved, joint.id), null);
  const back = { ...moved, parts: project.parts.map((part) => ({ ...part })) };
  assert.deepEqual(swingStop(back, joint.id), found);
});
