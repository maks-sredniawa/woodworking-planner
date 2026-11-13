import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSES, SHAPES, bounds, legacyPose, makePart, makeShape, overlaps, rotatePart } from '../docs/app/src/model.js';
import { assemblyOverlaps, joinParts, updateJoint, worldBounds } from '../docs/app/src/joints.js';

const block = (size, fields = {}) => makePart({ name: 'Block', length: size, width: size, thickness: size, ...fields });

test('a block in the empty corner of a disc’s box does not overlap the disc; pushed into the rim it does', () => {
  const disc = makeShape('disc');
  assert.deepEqual(overlaps([disc, block(50)]), []);
  const pushed = block(70);
  assert.deepEqual(overlaps([disc, pushed]), [[disc.id, pushed.id]]);
});

const spun = (pose) => pose.slice(0, 4).replace(/[+-]/g, (sign) => (sign === '+' ? '-' : '+')) + pose.slice(4);

test('two right triangles that make a rectangle meet on the slope and do not overlap, in every pose', () => {
  for (const pose of POSES) {
    const triangle = { ...makeShape('triangle'), length: 300, width: 200, pose, y: 1000 };
    const other = { ...triangle, id: 'other', pose: spun(pose) };
    assert.deepEqual(bounds(other), bounds(triangle), pose);
    assert.deepEqual(overlaps([triangle, other]), [], pose);
    const same = { ...triangle, id: 'same' };
    assert.equal(overlaps([triangle, same]).length, 1, pose);
  }
});

test('a disc set in the hole of a full ring fits it exactly without overlapping; a bigger one overlaps', () => {
  const ring = { ...makeShape('arc'), outerRadius: 400, bandWidth: 60, sweep: 360 };
  const inlay = { ...makeShape('disc'), diameter: 680, x: 60, z: 60 };
  assert.deepEqual(overlaps([ring, inlay]), []);
  const bigger = { ...inlay, diameter: 682, x: 59, z: 59 };
  assert.equal(overlaps([ring, bigger]).length, 1);
});

test('a block in the corner of a dowel’s box clears the round dowel', () => {
  const dowel = makeShape('dowel');
  assert.deepEqual(overlaps([dowel, block(4, { x: 100 })]), []);
  assert.equal(overlaps([dowel, block(6, { x: 100 })]).length, 1);
  const standing = rotatePart(rotatePart(dowel, 'z'), 'x');
  const corner = bounds(standing).min;
  assert.deepEqual(overlaps([standing, block(4, { ...corner, y: 100 })]), []);
});

test('a block in a rounded or cut corner of a board clears it; at a square corner it overlaps', () => {
  const rounded = { ...makePart({ length: 600, width: 300 }), corners: 'rounded', cornerRadius: 50 };
  assert.deepEqual(overlaps([rounded, block(10)]), []);
  const cut = { ...rounded, corners: 'cut', cutLength: 50, cutWidth: 50 };
  assert.deepEqual(overlaps([cut, block(10)]), []);
  const square = { ...rounded, corners: 'square' };
  assert.equal(overlaps([square, block(10)]).length, 1);
});

test('a block inside the bend of an arc clears it, for sweeps up to a full turn', () => {
  for (const sweep of [45, 90, 180, 270, 359, 360]) {
    const arc = { ...makeShape('arc'), outerRadius: 400, bandWidth: 60, sweep, y: 500 };
    const box = bounds(arc);
    const middle = (axis) => (box.min[axis] + box.max[axis]) / 2;
    const centre = { x: middle('x') - 10, y: 500, z: sweep >= 180 ? middle('z') - 10 : box.max.z - 20 };
    assert.deepEqual(overlaps([arc, block(20, centre)]), [], `sweep ${sweep}`);
    const onBand = { ...centre, z: box.min.z };
    assert.equal(overlaps([arc, block(20, onBand)]).length, 1, `sweep ${sweep}`);
  }
});

test('every shape lying on another flat piece only touches it', () => {
  for (const shape of Object.keys(SHAPES)) {
    const base = makePart({ length: 2000, width: 2000, thickness: 18 });
    const piece = { ...makeShape(shape), x: 100, y: 18, z: 100 };
    assert.deepEqual(overlaps([base, piece]), [], shape);
    assert.equal(overlaps([base, { ...piece, y: 17 }]).length, 1, shape);
  }
});

const side = () => makePart({ name: 'Side', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx') });

test('a round door swung open clears a block in the corner of its turned box, and hits one on its rim', () => {
  const frame = side();
  const door = { ...makeShape('disc'), name: 'Round door', pose: legacyPose('yxz'), z: 244 };
  const hung = joinParts({ name: 'Cabinet', parts: [frame, door], joints: [] }, 'hinge', door.id, frame.id);
  assert.equal(hung.error, undefined);
  const corner = block(50, { name: 'Corner', x: -30, z: 594 });
  const rim = block(50, { name: 'Rim', x: -30, z: 419 });
  const closed = { ...hung.project, parts: [...hung.project.parts, corner, rim] };
  assert.deepEqual(assemblyOverlaps(closed), []);
  const open = updateJoint(closed, hung.joint.id, 'open', 90);
  assert.deepEqual(worldBounds(open, door.id), { min: { x: -18, y: 0, z: 244 }, max: { x: 0, y: 400, z: 644 } });
  assert.deepEqual(assemblyOverlaps(open), [[door.id, rim.id]]);
  const halfway = updateJoint(closed, hung.joint.id, 'open', 45);
  const swept = block(20, { name: 'Swept', x: 125, y: 190, z: 382 });
  assert.deepEqual(assemblyOverlaps({ ...halfway, parts: [...halfway.parts, swept] }), [[door.id, swept.id]]);
});
