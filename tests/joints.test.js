import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPose, makePart, projectBounds, rotatePart, updatePart } from '../docs/app/src/model.js';
import {
  applySuggestedSizes,
  assemblyOverlaps,
  changeJoint,
  changePart,
  changePosition,
  jointRemoval,
  partRemoval,
  removeJoint,
  removePart,
  suggestSizes,
  contact,
  dragMode,
  hingeAxis,
  hardwareList,
  hardwarePieces,
  insideCorner,
  hingeEdges,
  jointProblem,
  joinParts,
  moveAssembly,
  rotateAssembly,
  snapAssembly,
  swingLocked,
  swingingHinge,
  touchingParts,
  updateJoint,
  worldBounds,
} from '../docs/app/src/joints.js';

const side = (fields = {}) =>
  makePart({ name: 'Side', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx'), ...fields });
const shelf = (fields = {}) =>
  makePart({ name: 'Shelf', length: 764, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 300, ...fields });

test('a shelf butted against a side touches it across the side face', () => {
  const left = side();
  const board = shelf();
  assert.deepEqual(contact(left, board), {
    axis: 'x',
    sign: 1,
    at: 18,
    region: { y: [300, 318], z: [0, 244] },
  });
  assert.equal(contact(board, left).sign, -1);
});

test('pieces that only share an edge, sit apart or cross do not touch', () => {
  const left = side();
  assert.equal(contact(left, shelf({ y: 1000 })), null);
  assert.equal(contact(left, shelf({ x: 19 })), null);
  assert.equal(contact(left, shelf({ x: 10 })), null);
});

test('touching pieces lists only the pieces that touch the given one', () => {
  const left = side();
  const board = shelf();
  const far = shelf({ name: 'Far', x: 2000 });
  assert.deepEqual(
    touchingParts([left, board, far], board.id).map((part) => part.name),
    ['Side'],
  );
});

const project = (parts, joints = []) => ({ name: 'Test', parts, joints });

test('joining two touching pieces adds a joint with defaults sized from the pieces', () => {
  const left = side();
  const board = shelf();
  const result = joinParts(project([left, board]), 'screws', board.id, left.id);
  assert.equal(result.error, undefined);
  assert.equal(result.project.joints.length, 1);
  const [joint] = result.project.joints;
  assert.equal(joint.kind, 'screws');
  assert.equal(joint.part, board.id);
  assert.equal(joint.to, left.id);
  assert.deepEqual([joint.count, joint.diameter, joint.length], [2, 4, 45]);
});

test('pieces that do not touch, or are already joined, cannot be joined', () => {
  const left = side();
  const board = shelf({ x: 40 });
  assert.match(joinParts(project([left, board]), 'glue', board.id, left.id).error, /don’t touch/);
  const touching = shelf();
  const once = joinParts(project([left, touching]), 'glue', touching.id, left.id).project;
  assert.match(joinParts(once, 'screws', left.id, touching.id).error, /already joined/);
});

test('moving any piece of an assembly moves every piece joined to it', () => {
  const left = side();
  const board = shelf();
  const loose = shelf({ name: 'Loose', x: 2000 });
  const joined = joinParts(project([left, board, loose]), 'glue', board.id, left.id).project;
  const moved = moveAssembly(joined, board.id, { x: 118, y: 350 });
  const by = Object.fromEntries(moved.parts.map((part) => [part.name, [part.x, part.y, part.z]]));
  assert.deepEqual(by, { Side: [100, 50, 0], Shelf: [118, 350, 0], Loose: [2000, 300, 0] });
});

test('an assembly with a locked piece does not move', () => {
  const left = side({ locked: true });
  const board = shelf();
  const joined = joinParts(project([left, board]), 'nails', board.id, left.id).project;
  assert.equal(moveAssembly(joined, board.id, { x: 500 }), joined);
});

const door = (fields = {}) =>
  makePart({ name: 'Door', length: 800, width: 400, thickness: 18, pose: legacyPose('yxz'), z: 244, ...fields });
const hung = () => {
  const frame = side();
  const leaf = door();
  return joinParts(project([frame, leaf]), 'hinge', leaf.id, frame.id);
};

test('a door hinged to a side hangs on its left edge with two butt hinges, closed', () => {
  const { joint, error } = hung();
  assert.equal(error, undefined);
  assert.equal(joint.edge, '-x');
  assert.equal(joint.open, 0);
  assert.deepEqual(
    [joint.hingeType, joint.count, joint.size, joint.screwsEach, joint.screwDiameter, joint.screwLength, joint.opensTo],
    ['butt', 2, 75, 6, 3.5, 16, 180],
  );
});

test('opening the hinge swings the door out to the front around its left edge', () => {
  const { project: closed, joint } = hung();
  const doorId = joint.part;
  assert.deepEqual(worldBounds(closed, doorId), { min: { x: 0, y: 0, z: 244 }, max: { x: 400, y: 800, z: 262 } });
  const open = updateJoint(closed, joint.id, 'open', 90);
  assert.deepEqual(worldBounds(open, doorId), { min: { x: -18, y: 0, z: 244 }, max: { x: 0, y: 800, z: 644 } });
  assert.equal(updateJoint(closed, joint.id, 'open', 181), null);
});

test('moving the frame carries the open door with it, dragging the door swings it', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 90);
  const moved = moveAssembly(open, joint.to, { x: 100 });
  assert.deepEqual(worldBounds(moved, joint.part).min, { x: 82, y: 0, z: 244 });
  assert.equal(swingingHinge(open, joint.part)?.id, joint.id);
  assert.equal(swingingHinge(open, joint.to), null);
});

test('dragging an assembly snaps to where its open door stands, not where the door would be closed', () => {
  const { project: closed, joint } = hung();
  const wall = shelf({ name: 'Wall', x: -500, z: 660 });
  const withWall = (state) => ({ ...state, parts: [...state.parts, wall] });
  const open = withWall(updateJoint(closed, joint.id, 'open', 90));
  assert.deepEqual(snapAssembly(open, joint.to, { z: 10 }), { z: 16 });
  assert.deepEqual(snapAssembly(withWall(closed), joint.to, { z: 10 }), { z: 10 });
  assert.deepEqual(snapAssembly(open, wall.id, { z: 640 }), { z: 644 });
  assert.deepEqual(snapAssembly(withWall(closed), wall.id, { z: 640 }), { z: 640 });
  assert.deepEqual(snapAssembly(open, joint.to, { z: 10 }, { snap: false }), { z: 10 });
});

test('lifting an assembly with snapping stops its lowest piece on the floor', () => {
  const left = side();
  const board = shelf();
  const glued = joinParts(project([left, board]), 'glue', board.id, left.id).project;
  assert.equal(snapAssembly(glued, board.id, { y: -40 }).y, 300);
  assert.equal(snapAssembly(glued, board.id, { y: 309 }).y, 300);
  assert.equal(snapAssembly(glued, board.id, { y: -40 }, { snap: false }).y, -40);
});

test('the ±10,000 mm limit on moving or turning an assembly counts where an open door stands', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 90);
  assert.equal(moveAssembly(open, joint.to, { x: -9990 }), open);
  assert.equal(moveAssembly(closed, joint.to, { x: -9990 }).parts[0].x, -9990);
  const pastEdge = updateJoint(moveAssembly(closed, joint.to, { x: -9990 }), joint.id, 'open', 90);
  assert.equal(worldBounds(pastEdge, joint.part).min.x, -10008);
  assert.equal(moveAssembly(pastEdge, joint.to, { x: -9980 }).parts[0].x, -9980);
  assert.equal(moveAssembly(pastEdge, joint.to, { x: -9995 }), pastEdge);
  const low = moveAssembly(open, joint.to, { y: -9990 });
  assert.equal(rotateAssembly(low, joint.to, 'z'), low);
  const closedLow = moveAssembly(closed, joint.to, { y: -9990 });
  assert.notEqual(rotateAssembly(closedLow, joint.to, 'z'), closedLow);
});

test('a typed move refused at the ±10,000 mm limit names the piece that would cross it', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 90);
  assert.equal(changePosition(open, joint.part, { x: -9990 }).piece.id, joint.part);
  assert.equal(changePosition(open, joint.to, { x: -9990 }).piece.id, joint.part);
  const farFrame = moveAssembly(closed, joint.to, { x: -9990 });
  assert.equal(changePosition(farFrame, joint.part, { x: -10020 }).piece.id, joint.to);
  assert.equal(changePosition(open, joint.part, { x: 100 }).project.parts[0].x, 100);
});

test('a piece swings on only one hinge and nothing joins a piece while its hinge is open', () => {
  const frame = side();
  const leaf = door();
  const right = side({ name: 'Right side', x: 382 });
  const handle = makePart({ name: 'Handle', length: 100, width: 20, thickness: 20, pose: legacyPose('yxz'), x: 350, y: 300, z: 262 });
  const hinged = joinParts(project([frame, leaf, right, handle]), 'hinge', leaf.id, frame.id);
  assert.match(joinParts(hinged.project, 'hinge', leaf.id, right.id).error, /already swings on a hinge/);
  const passing = updateJoint(hinged.project, hinged.joint.id, 'stops', false);
  const open = updateJoint(passing, hinged.joint.id, 'open', 30);
  assert.match(joinParts(open, 'glue', handle.id, leaf.id).error, /Close it first/);
});

test('a hinge cannot swing when the door is also fixed to the frame through another piece', () => {
  const frame = side();
  const leaf = door({ length: 1000 });
  const top = makePart({ name: 'Top', length: 400, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 982 });
  let state = project([frame, leaf, top]);
  const hinge = joinParts(state, 'hinge', leaf.id, frame.id);
  state = joinParts(hinge.project, 'screws', top.id, frame.id).project;
  state = joinParts(state, 'screws', leaf.id, top.id).project;
  state = updateJoint(state, hinge.joint.id, 'open', 90);
  assert.match(jointProblem(state, hinge.joint.id), /Can’t swing: Door is also fixed to Side through Top/);
  assert.deepEqual(worldBounds(state, leaf.id).min, { x: 0, y: 0, z: 244 });
});

test('turning a piece of an assembly turns the whole assembly about its footprint, hinge and all', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 40);
  const turned = rotateAssembly(open, joint.to, 'y');
  const [frame, leaf] = turned.parts;
  assert.ok(contact(frame, leaf), 'the door still touches the side');
  assert.deepEqual(projectBounds(turned.parts), { min: { x: 69, y: 0, z: -69 }, max: { x: 331, y: 1000, z: 331 } });
  const hinge = turned.joints[0];
  assert.equal(hinge.open, 40);
  assert.notEqual(hinge.edge, joint.edge);
  assert.deepEqual(hingeEdges(turned, hinge).includes(hinge.edge), true);
  const tipped = rotateAssembly(closed, joint.part, 'x');
  assert.equal(projectBounds(tipped.parts).min.y, 0);
});

test('turning an assembly with tenth-of-a-millimetre sizes keeps every joint touching', () => {
  for (const axis of ['x', 'y', 'z']) {
    for (const x of [0, 0.1, 0.3]) {
      for (const width of [244, 244.1, 300.3]) {
        const left = side({ x, width });
        const board = shelf({ x: x + 18, width, length: 764.3 });
        let { project: state, joint } = joinParts(project([left, board]), 'screws', board.id, left.id);
        for (let turn = 1; turn <= 4; turn++) {
          state = rotateAssembly(state, left.id, axis);
          assert.equal(jointProblem(state, joint.id), null, `turn ${turn} about ${axis} at x ${x}, width ${width}`);
        }
      }
    }
  }
});

test('turning a piece that is not joined turns only that piece, as before', () => {
  const loose = shelf();
  const state = project([loose, side()]);
  assert.deepEqual(rotateAssembly(state, loose.id, 'y').parts[0], rotatePart(loose, 'y'));
});

test('an angle bracket goes in the inside corner under a shelf, and needs one', () => {
  const left = side();
  const board = shelf();
  const { joint } = joinParts(project([left, board]), 'bracket', board.id, left.id);
  assert.deepEqual([joint.count, joint.leg, joint.width, joint.screwsEach, joint.screwDiameter, joint.screwLength], [2, 40, 16, 4, 3.5, 16]);
  assert.deepEqual(insideCorner(left, board), { axis: 'x', at: 18, across: 'y', edge: 300, side: -1, along: 'z', span: [0, 244], base: left.id, standing: board.id });
  const under = makePart({ name: 'Under', length: 764, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 282 });
  const stacked = makePart({ name: 'Stacked', length: 764, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 300 });
  assert.match(joinParts(project([under, stacked]), 'bracket', stacked.id, under.id).error, /inside corner/);
});

test('an angle bracket takes screws no longer than the thinner piece, and warns when they are longer', () => {
  const left = side();
  const board = shelf({ thickness: 12 });
  const { project: state, joint } = joinParts(project([left, board]), 'bracket', board.id, left.id);
  assert.equal(joint.screwLength, 12);
  assert.equal(jointProblem(state, joint.id), null);
  assert.equal(jointProblem(updateJoint(state, joint.id, 'screwLength', 16), joint.id), 'The screws (16) are longer than Shelf is thick (12).');
  assert.equal(jointProblem(updateJoint(state, joint.id, 'screwLength', 20), joint.id), 'The screws (20) are longer than Shelf is thick (12).');
});

test('a door that swings through other pieces overlaps them; swung clear, it does not', () => {
  const { project: closed, joint } = hung();
  const box = makePart({ name: 'Box', length: 100, width: 100, thickness: 100, pose: legacyPose('xzy'), x: -150, y: 0, z: 250 });
  const state = updateJoint({ ...closed, parts: [...closed.parts, box] }, joint.id, 'stops', false);
  assert.deepEqual(assemblyOverlaps(state), []);
  assert.deepEqual(assemblyOverlaps(updateJoint(state, joint.id, 'open', 90)), []);
  assert.deepEqual(assemblyOverlaps(updateJoint(state, joint.id, 'open', 150)), [[joint.part, box.id]]);
});

test('the hardware list counts and sizes every fixing, screws from brackets and hinges included', () => {
  const left = side();
  const board = shelf();
  const lower = shelf({ name: 'Lower', y: 100 });
  const leaf = door();
  const back = makePart({ name: 'Back', length: 1000, width: 400, thickness: 6, pose: legacyPose('yxz'), z: -6 });
  let state = project([left, board, lower, leaf, back]);
  const screwed = joinParts(state, 'screws', board.id, left.id);
  state = updateJoint(screwed.project, screwed.joint.id, 'glued', true);
  state = joinParts(state, 'bracket', lower.id, left.id).project;
  state = joinParts(state, 'hinge', leaf.id, left.id).project;
  state = joinParts(state, 'nails', back.id, left.id).project;
  assert.deepEqual(
    hardwareList(state).map(({ item, size, count, usedOn }) => [count, item, size, usedOn]),
    [
      [2, 'Butt hinge', [75], ['Door – Side']],
      [2, 'Angle bracket', [40, 40, 16], ['Lower – Side']],
      [20, 'Screw', [3.5, 16], ['Lower – Side', 'Door – Side']],
      [2, 'Screw', [4, 45], ['Shelf – Side']],
      [10, 'Nail', [1.2, 15], ['Back – Side']],
      [null, 'Wood glue', null, ['Shelf – Side']],
    ],
  );
});

test('hardware is placed where it sits: hinge knuckles on the hinge line, screw heads on the outside face', () => {
  const { project: hinged, joint } = hung();
  const knuckles = hardwarePieces(hinged).filter((piece) => piece.type === 'knuckle');
  assert.equal(knuckles.length, 2);
  for (const knuckle of knuckles) {
    assert.equal(knuckle.owner, joint.to);
    assert.deepEqual([knuckle.from[0], knuckle.from[2], knuckle.to[0], knuckle.to[2]], [0, 244, 0, 244]);
    assert.equal(Math.abs(knuckle.to[1] - knuckle.from[1]), 75);
  }
  assert.ok(knuckles[0].from[1] > 0 && knuckles[1].to[1] < 800 && knuckles[1].to[1] > 600);

  const left = side();
  const board = shelf();
  const screwed = joinParts(project([left, board]), 'screws', board.id, left.id).project;
  const heads = hardwarePieces(screwed).filter((piece) => piece.type === 'head');
  assert.equal(heads.length, 2);
  for (const head of heads) {
    assert.equal(head.owner, left.id);
    assert.deepEqual([head.centre[0], head.centre[1], head.normal], [0, 309, [-1, 0, 0]]);
  }
});

test('a concealed hinge marks the hinge line on the frame beside each cup, like the other hinges', () => {
  const { project: butt, joint } = hung();
  const concealed = updateJoint(butt, joint.id, 'hingeType', 'concealed');
  const pieces = hardwarePieces(concealed);
  const cups = pieces.filter((piece) => piece.kind === 'cup');
  const knuckles = pieces.filter((piece) => piece.type === 'knuckle');
  assert.equal(cups.length, 2);
  assert.equal(knuckles.length, 2);
  knuckles.forEach((knuckle, i) => {
    assert.equal(knuckle.owner, joint.to);
    assert.deepEqual([knuckle.from[0], knuckle.from[2], knuckle.to[0], knuckle.to[2]], [0, 244, 0, 244]);
    assert.equal(Math.abs(knuckle.to[1] - knuckle.from[1]), 35);
    assert.equal((knuckle.from[1] + knuckle.to[1]) / 2, cups[i].centre[1]);
  });
});

test('a concealed hinge on a hinge line shorter than two cups keeps its knuckles on the line', () => {
  const frame = side();
  const short = door({ length: 60 });
  const { project: hinged, joint } = joinParts(project([frame, short]), 'hinge', short.id, frame.id);
  const concealed = updateJoint(updateJoint(hinged, joint.id, 'hingeType', 'concealed'), joint.id, 'count', 2);
  const knuckles = hardwarePieces(concealed).filter((piece) => piece.type === 'knuckle');
  assert.deepEqual(knuckles.map((knuckle) => [knuckle.from[1], knuckle.to[1]]), [[0, 35], [25, 60]]);
});

test('the hinge line follows the frame, and a locked door or assembly is pinned', () => {
  const { project: closed, joint } = hung();
  assert.deepEqual(hingeAxis(closed, joint.id), { origin: [0, 800, 244], direction: [0, -1, 0], length: 800 });
  const moved = moveAssembly(closed, joint.to, { x: 100 });
  assert.deepEqual(hingeAxis(moved, joint.id).origin, [100, 800, 244]);
  const lockedDoor = { ...closed, parts: closed.parts.map((part) => (part.id === joint.part ? { ...part, locked: true } : part)) };
  assert.equal(dragMode(closed, joint.part), 'swing');
  assert.equal(dragMode(closed, joint.to), 'move');
  assert.equal(dragMode(lockedDoor, joint.part), 'none');
  assert.equal(dragMode(lockedDoor, joint.to), 'none');
  assert.equal(updateJoint(lockedDoor, joint.id, 'open', 20), null);
});

test('nothing on the hinge swings a locked door: not Opens up to, the type, the edge or suggested sizes', () => {
  const { project: closed, joint } = hung();
  const lockDoor = (state) => ({ ...state, parts: state.parts.map((part) => (part.id === joint.part ? { ...part, locked: true } : part)) });
  const open = lockDoor(updateJoint(closed, joint.id, 'open', 150));
  assert.equal(swingLocked(open, joint.id), true);
  assert.equal(swingLocked(closed, joint.id), false);
  assert.equal(updateJoint(open, joint.id, 'opensTo', 30), null);
  assert.equal(updateJoint(open, joint.id, 'hingeType', 'concealed'), null);
  assert.equal(updateJoint(open, joint.id, 'edge', '+x'), null);
  assert.equal(updateJoint(open, joint.id, 'opensTo', 170).joints[0].open, 150);
  assert.equal(updateJoint(open, joint.id, 'count', 3).joints[0].count, 3);
  assert.equal(updateJoint(lockDoor(closed), joint.id, 'edge', '+x').joints[0].edge, '+x');

  const roomy = updateJoint(updateJoint(updateJoint(closed, joint.id, 'hingeType', 'concealed'), joint.id, 'opensTo', 200), joint.id, 'open', 150);
  assert.equal(applySuggestedSizes(lockDoor(roomy), joint.id), null);
  const suggested = applySuggestedSizes(roomy, joint.id).joints[0];
  assert.deepEqual([suggested.opensTo, suggested.open], [110, 110]);
});

test('concealed hinges warn on a door thinner than 16 mm but still swing', () => {
  const frame = side();
  const thin = door({ thickness: 12 });
  const { project: hinged, joint } = joinParts(project([frame, thin]), 'hinge', thin.id, frame.id);
  const concealed = updateJoint(hinged, joint.id, 'hingeType', 'concealed');
  assert.equal(concealed.joints[0].opensTo, 110);
  assert.match(jointProblem(concealed, joint.id), /at least 16 mm thick/);
  assert.equal(dragMode(concealed, thin.id), 'swing');
  assert.equal(jointProblem(hinged, joint.id), null);
});

test('hinge screws are sized from the thickness of the pieces, even for a piece hinged on its end', () => {
  const frame = side();
  const flap = shelf();
  const { joint } = joinParts(project([frame, flap]), 'hinge', flap.id, frame.id);
  assert.equal(joint.screwLength, 16);
  const thin = shelf({ thickness: 12 });
  const { project: hinged, joint: thinJoint } = joinParts(project([frame, thin]), 'hinge', thin.id, frame.id);
  assert.match(jointProblem(updateJoint(hinged, thinJoint.id, 'hingeType', 'concealed'), thinJoint.id), /Shelf is 12 mm/);
});

test('a refused joint change says why: not a value, past the limit, a locked piece or pieces apart', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 120);
  const locked = { ...open, parts: open.parts.map((part) => (part.id === joint.part ? { ...part, locked: true } : part)) };
  assert.deepEqual(changeJoint(locked, joint.id, 'open', 'abc'), { refused: 'invalid' });
  assert.deepEqual(changeJoint(locked, joint.id, 'open', 200), { refused: 'limit' });
  const refusal = changeJoint(locked, joint.id, 'open', 30);
  assert.deepEqual([refusal.refused, refusal.piece?.name], ['locked', 'Door']);
  const lockedSuggest = suggestSizes({ ...locked, joints: [{ ...locked.joints[0], opensTo: 270, open: 200 }] }, joint.id);
  assert.deepEqual([lockedSuggest.refused, lockedSuggest.piece?.name], ['locked', 'Door']);
  assert.equal(changeJoint(open, joint.id, 'open', 30).project.joints[0].open, 30);
  const apart = { ...locked, parts: locked.parts.map((part) => (part.id === joint.to ? { ...part, x: -500 } : part)) };
  assert.deepEqual(suggestSizes(apart, joint.id), { refused: 'apart' });
  assert.deepEqual(suggestSizes(locked, joint.id).refused, undefined);
});

test('removing the hinge or the frame of a locked open door is refused, since it would swing the door shut', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 90);
  const locked = { ...open, parts: open.parts.map((part) => (part.id === joint.part ? { ...part, locked: true } : part)) };
  assert.equal(removeJoint(locked, joint.id), locked);
  assert.equal(removePart(locked, joint.to), locked);
  assert.equal(removeJoint(open, joint.id).joints.length, 0);
  const shut = { ...closed, parts: locked.parts };
  assert.equal(removePart(shut, joint.to).parts.length, 1);
});

const lockPart = (state, id) => ({ ...state, parts: state.parts.map((part) => (part.id === id ? { ...part, locked: true } : part)) });
const resized = (state, id, field, raw) => updatePart(state.parts.find((part) => part.id === id), field, raw);

test('resizing or reshaping the frame of a locked open door is refused and names the door; other part edits go through', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 90);
  const locked = lockPart(open, joint.part);
  const narrow = resized(locked, joint.to, 'width', 100);
  const refused = changePart(locked, narrow);
  assert.equal(refused.refused, 'locked');
  assert.equal(refused.piece.name, 'Door');
  assert.equal(refused.project, undefined);
  assert.equal(changePart(locked, resized(locked, joint.to, 'shape', 'disc')).refused, 'locked');
  assert.equal(changePart(locked, resized(locked, joint.to, 'name', 'Frame')).project.parts[0].name, 'Frame');
  assert.equal(changePart(open, resized(open, joint.to, 'width', 100)).project.parts[0].width, 100);
  assert.equal(changePart(lockPart(closed, joint.part), resized(closed, joint.to, 'width', 100)).project.parts[0].width, 100);
});

test('a locked piece fixed to an open door also keeps the door from swinging, and is the one named', () => {
  const { project: closed, joint } = hung();
  const knob = makePart({ name: 'Knob', length: 100, width: 30, thickness: 18, pose: legacyPose('yxz'), x: 300, y: 300, z: 262 });
  const glued = joinParts({ ...closed, parts: [...closed.parts, knob] }, 'glue', knob.id, joint.part).project;
  const open = lockPart(updateJoint(glued, joint.id, 'open', 90), knob.id);
  assert.equal(changePart(open, resized(open, joint.to, 'width', 100)).piece.name, 'Knob');
  assert.equal(jointRemoval(open, joint.id).piece.name, 'Knob');
  assert.equal(partRemoval(open, joint.to).piece.name, 'Knob');
  assert.equal(removeJoint(open, joint.id), open);
});

test('a refused removal says which locked piece it would swing; an allowed one returns the new project', () => {
  const { project: closed, joint } = hung();
  const open = updateJoint(closed, joint.id, 'open', 90);
  const locked = lockPart(open, joint.part);
  assert.deepEqual(Object.keys(jointRemoval(locked, joint.id)), ['refused', 'piece']);
  assert.equal(partRemoval(locked, joint.to).piece.name, 'Door');
  assert.equal(jointRemoval(open, joint.id).project.joints.length, 0);
  assert.equal(partRemoval(open, joint.to).project.parts.length, 1);
});

test('four turns about the same axis bring an assembly, or a lone piece, back exactly, tenths of a millimetre included', () => {
  for (const [length, width, x, z] of [[244.1, 18, 0.1, 0], [300.3, 18.1, 0.3, 0.1], [764, 244.1, 18, 6.1]]) {
    const loose = makePart({ length, width, thickness: 18, pose: legacyPose('xzy'), x, z });
    for (const axis of ['x', 'y', 'z']) {
      let turned = loose;
      for (let i = 0; i < 4; i++) turned = rotatePart(turned, axis);
      assert.deepEqual([turned.x, turned.y, turned.z, turned.pose], [loose.x, loose.y, loose.z, loose.pose], `${length}×${width} about ${axis}`);
    }
    const frame = side({ x, width: length });
    const leaf = shelf({ x: x + 18, width: length, z: 0, thickness: width });
    const state = joinParts(project([frame, leaf]), 'glue', leaf.id, frame.id).project;
    for (const axis of ['x', 'y', 'z']) {
      let turned = state;
      for (let i = 0; i < 4; i++) turned = rotateAssembly(turned, frame.id, axis);
      assert.deepEqual(
        turned.parts.map((part) => [part.x, part.y, part.z, part.pose]),
        state.parts.map((part) => [part.x, part.y, part.z, part.pose]),
        `assembly ${length}×${width} about ${axis}`,
      );
    }
  }
});
