import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPose, makePart } from '../docs/app/src/model.js';
import { hardwareList, hardwarePieces, joinParts, jointFaces, jointProblem, rotateAssembly, suggestedSizes, updateJoint } from '../docs/app/src/joints.js';

const project = (parts, joints = []) => ({ name: 'Frame', parts, joints });
const stile = (fields = {}) => makePart({ name: 'Stile', length: 600, width: 60, thickness: 18, pose: legacyPose('yxz'), ...fields });
const rail = (fields = {}) => makePart({ name: 'Rail', length: 400, width: 60, thickness: 18, pose: legacyPose('xyz'), x: 60, ...fields });

test('a mending plate goes across two rails meeting end to end, on the back face by default', () => {
  const left = rail({ x: 0 });
  const right = rail({ name: 'Right rail', x: 400 });
  const { joint, error } = joinParts(project([left, right]), 'mendingPlate', right.id, left.id);
  assert.equal(error, undefined);
  assert.deepEqual(
    [joint.count, joint.length, joint.width, joint.screwsEach, joint.screwDiameter, joint.screwLength, joint.face, joint.glued],
    [1, 80, 16, 4, 3.5, 16, '-z', false],
  );
});

test('a mending plate lists only the faces flush across both pieces', () => {
  const left = rail({ x: 0 });
  const thinner = rail({ name: 'Thin', x: 400, thickness: 12 });
  const state = joinParts(project([left, thinner]), 'mendingPlate', thinner.id, left.id).project;
  assert.deepEqual(jointFaces(state, state.joints[0]), ['-z', '-y', '+y']);
  assert.equal(state.joints[0].screwLength, 12);
});

test('a mending plate needs a flat face running across both pieces', () => {
  const left = rail({ x: 0 });
  const offset = rail({ name: 'Offset', x: 400, y: 5, z: 5 });
  assert.equal(
    joinParts(project([left, offset]), 'mendingPlate', offset.id, left.id).error,
    'A mending plate needs one flat face running across both pieces. Line up a face of Offset with a face of Rail first.',
  );
});

test('two plates for a joint line over 300 long, and plates sized to fit the pieces', () => {
  const wide = (fields) => makePart({ name: 'Panel', length: 400, width: 350, thickness: 18, pose: legacyPose('xyz'), ...fields });
  const a = wide({ x: 0 });
  const b = wide({ x: 400 });
  assert.equal(joinParts(project([a, b]), 'mendingPlate', b.id, a.id).joint.count, 2);
  const short = rail({ x: 0, length: 30 });
  const next = rail({ x: 30 });
  const { joint } = joinParts(project([short, next]), 'mendingPlate', next.id, short.id);
  assert.deepEqual([joint.length, joint.width], [50, 12]);
});

test('a corner plate goes on a frame corner, and is refused on pieces in line or with no flush face', () => {
  const upright = stile();
  const bottom = rail();
  const { joint, error } = joinParts(project([upright, bottom]), 'cornerPlate', bottom.id, upright.id);
  assert.equal(error, undefined);
  assert.deepEqual([joint.leg, joint.width, joint.screwsEach, joint.screwDiameter, joint.screwLength, joint.face], [80, 16, 4, 3.5, 16, '-z']);
  const state = joinParts(project([upright, bottom]), 'cornerPlate', bottom.id, upright.id).project;
  assert.deepEqual(jointFaces(state, state.joints[0]), ['-z', '+z']);
  const left = rail({ x: 0 });
  const right = rail({ name: 'Right rail', x: 400 });
  assert.equal(
    joinParts(project([left, right]), 'cornerPlate', right.id, left.id).error,
    'A corner plate needs two pieces meeting at a right angle with one flat face across both, and these are in line. Use a mending plate instead.',
  );
  const offset = rail({ name: 'Offset', x: 60, y: 100, z: 5 });
  assert.equal(
    joinParts(project([upright, offset]), 'cornerPlate', offset.id, upright.id).error,
    'A corner plate needs two pieces meeting at a right angle with one flat face across both. Line up a face of Offset with a face of Stile first.',
  );
});

test('a rail in the middle of a stile is a T, which also takes a corner plate', () => {
  const upright = stile();
  const middle = rail({ y: 270 });
  assert.equal(joinParts(project([upright, middle]), 'cornerPlate', middle.id, upright.id).error, undefined);
});

test('plate warnings: screws longer than a piece is thick, a plate wider than its face, a face that is no longer flush', () => {
  const left = rail({ x: 0 });
  const right = rail({ name: 'Right rail', x: 400 });
  const { project: state, joint } = joinParts(project([left, right]), 'mendingPlate', right.id, left.id);
  assert.equal(jointProblem(state, joint.id), null);
  assert.equal(jointProblem(updateJoint(state, joint.id, 'screwLength', 20), joint.id), 'The screws (20) are longer than Right rail is thick (18).');
  const onEdge = updateJoint(state, joint.id, 'face', '-y');
  assert.equal(onEdge.joints[0].face, '-y');
  assert.equal(jointProblem(updateJoint(onEdge, joint.id, 'width', 25), joint.id), 'The plate (80 × 25) is wider than the face it sits on (18).');
  assert.equal(updateJoint(state, joint.id, 'face', '+x'), null);
  const moved = { ...state, parts: state.parts.map((part) => (part.id === right.id ? { ...part, y: 5, z: 5 } : part)) };
  assert.match(jointProblem(moved, joint.id), /needs one flat face running across both pieces/);
});

test('a corner plate wider than the pieces it sits on is warned about', () => {
  const upright = stile();
  const bottom = rail();
  const { project: state, joint } = joinParts(project([upright, bottom]), 'cornerPlate', bottom.id, upright.id);
  assert.equal(jointProblem(updateJoint(state, joint.id, 'width', 70), joint.id), 'The plate (80 × 80 × 70) is wider than the face it sits on (60).');
});

test('suggested sizes for a plate follow the face it is on', () => {
  const left = rail({ x: 0 });
  const thinner = rail({ name: 'Thin', x: 400, thickness: 12 });
  const { project: state, joint } = joinParts(project([left, thinner]), 'mendingPlate', thinner.id, left.id);
  const onEdge = updateJoint(updateJoint(state, joint.id, 'face', '-y'), joint.id, 'screwLength', 30);
  assert.deepEqual(suggestedSizes(onEdge, onEdge.joints[0]).screwLength, 20);
  assert.deepEqual(suggestedSizes(onEdge, onEdge.joints[0]).face, '-y');
});

const side = () => makePart({ name: 'Side', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx') });
const shelf = (fields = {}) => makePart({ name: 'Shelf', length: 764, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 300, ...fields });

test('pocket screws are drilled in the picked piece, sized from its thickness, pockets on its back', () => {
  const upright = stile();
  const bottom = rail();
  const { joint, error } = joinParts(project([upright, bottom]), 'pocketScrews', bottom.id, upright.id);
  assert.equal(error, undefined);
  assert.deepEqual([joint.part, joint.to], [bottom.id, upright.id]);
  assert.deepEqual([joint.count, joint.diameter, joint.length, joint.face, joint.glued], [2, 4, 32, '-z', false]);
  const state = joinParts(project([upright, bottom]), 'pocketScrews', bottom.id, upright.id).project;
  assert.deepEqual(jointFaces(state, state.joints[0]), ['-z', '+z']);
});

test('pocket screw length follows the drilled piece: 25 under 15, 32 up to 22, 38 up to 30, 64 above', () => {
  for (const [thickness, length] of [[12, 25], [15, 32], [18, 32], [22, 32], [27, 38], [30, 38], [45, 64]]) {
    const upright = stile({ thickness });
    const bottom = rail({ thickness });
    assert.equal(joinParts(project([upright, bottom]), 'pocketScrews', bottom.id, upright.id).joint.length, length, `${thickness} thick`);
  }
});

test('one more pocket screw for every 150 of joint line over 150', () => {
  const left = { ...side(), width: 600 };
  for (const [width, count] of [[149, 2], [299, 2], [300, 3], [450, 4]]) {
    const board = shelf({ width });
    assert.equal(joinParts(project([left, board]), 'pocketScrews', board.id, left.id).joint.count, count, `${width} wide`);
  }
});

test('when the picked piece meets the other with its face, the other is drilled; face to face is refused', () => {
  const left = side();
  const board = shelf();
  const { joint } = joinParts(project([left, board]), 'pocketScrews', left.id, board.id);
  assert.deepEqual([joint.part, joint.to, joint.face], [board.id, left.id, '-y']);
  const under = makePart({ name: 'Under', length: 764, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 282 });
  assert.equal(
    joinParts(project([under, board]), 'pocketScrews', board.id, under.id).error,
    'Pocket screws go through the end or edge of one piece, and these lie face to face. Use screws instead.',
  );
});

test('pocket screws that would come out the far side of the other piece are warned about', () => {
  const left = side();
  const board = shelf();
  const { project: state, joint } = joinParts(project([left, board]), 'pocketScrews', board.id, left.id);
  assert.equal(jointProblem(state, joint.id), null);
  assert.equal(jointProblem(updateJoint(state, joint.id, 'length', 38), joint.id), 'The pocket screws (38) come out the far side of Side (18 thick).');
  assert.equal(updateJoint(state, joint.id, 'face', '+y').joints[0].face, '+y');
  assert.equal(updateJoint(state, joint.id, 'face', '-x'), null);
});

test('the hardware list counts plates, their screws with the other screws, pocket screws by size, and glue', () => {
  const upright = stile();
  const bottom = rail();
  const top = rail({ name: 'Top rail', y: 540 });
  const far = rail({ name: 'Far rail', x: 460 });
  const middle = rail({ name: 'Middle', y: 270 });
  let state = project([upright, bottom, top, far, middle]);
  state = joinParts(state, 'cornerPlate', bottom.id, upright.id).project;
  const mended = joinParts(state, 'mendingPlate', far.id, bottom.id);
  state = updateJoint(mended.project, mended.joint.id, 'glued', true);
  state = joinParts(state, 'pocketScrews', top.id, upright.id).project;
  state = joinParts(state, 'pocketScrews', middle.id, upright.id).project;
  assert.deepEqual(
    hardwareList(state).map(({ item, size, count, usedOn }) => [count, item, size, usedOn]),
    [
      [1, 'Mending plate', [80, 16], ['Far rail – Rail']],
      [1, 'Corner plate', [80, 80, 16], ['Rail – Stile']],
      [8, 'Screw', [3.5, 16], ['Rail – Stile', 'Far rail – Rail']],
      [4, 'Pocket screw', [4, 32], ['Top rail – Stile', 'Middle – Stile']],
      [null, 'Wood glue', null, ['Far rail – Rail']],
    ],
  );
});

test('plates sit on the chosen face across the joint, with screw heads; pocket screws show as ovals on the drilled piece', () => {
  const left = rail({ x: 0 });
  const right = rail({ name: 'Right rail', x: 400 });
  const mended = joinParts(project([left, right]), 'mendingPlate', right.id, left.id).project;
  const plates = hardwarePieces(mended).filter((piece) => piece.type === 'plate');
  assert.deepEqual(plates.map(({ min, max }) => [min, max]), [[[360, 22, -2], [440, 38, 0]]]);
  const heads = hardwarePieces(mended).filter((piece) => piece.type === 'head');
  assert.equal(heads.length, 4);
  assert.deepEqual(heads.map((head) => head.normal), Array(4).fill([0, 0, -1]));
  assert.deepEqual(heads.map((head) => head.centre[0] < 400), [true, true, false, false]);

  const upright = stile();
  const bottom = rail();
  const cornered = joinParts(project([upright, bottom]), 'cornerPlate', bottom.id, upright.id).project;
  const legs = hardwarePieces(cornered).filter((piece) => piece.type === 'plate');
  assert.deepEqual(legs.map(({ min, max }) => [min, max]), [[[44, 44, -2], [60, 124, 0]], [[60, 44, -2], [124, 60, 0]]]);
  assert.equal(hardwarePieces(cornered).filter((piece) => piece.type === 'head').length, 4);
  const pocketed = joinParts(project([upright, bottom]), 'pocketScrews', bottom.id, upright.id).project;
  const pockets = hardwarePieces(pocketed).filter((piece) => piece.type === 'pocket');
  assert.equal(pockets.length, 2);
  for (const pocket of pockets) {
    assert.equal(pocket.owner, bottom.id);
    assert.deepEqual([pocket.normal, pocket.along, pocket.centre[2]], [[0, 0, -1], [-1, 0, 0], 0]);
    assert.ok(pocket.centre[0] > 60 && pocket.centre[0] < 100, `pocket ${pocket.centre[0]} should sit just behind the end of Rail`);
  }
});

test('turning an assembly turns the face a plate or pocket is on with it', () => {
  const upright = stile();
  const bottom = rail();
  const { project: state, joint } = joinParts(project([upright, bottom]), 'pocketScrews', bottom.id, upright.id);
  const turned = rotateAssembly(state, upright.id, 'y');
  assert.equal(turned.joints[0].face, '-x');
  assert.equal(jointProblem(turned, joint.id), null);
  assert.deepEqual(jointFaces(turned, turned.joints[0]), ['-x', '+x']);
});
