import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, blank, cutList, extents, faceArea, freeSwitchProblem, makePart, makeShape, outline, pieceVolume, roundMm, stretchProblem, updatePart } from '../docs/app/src/model.js';
import { parseProject, serialize } from '../docs/app/src/project.js';
import { addPoint, area, box, insertPoint, bendToward, fromStroke, movePoint, outlineProblem, removePoint, winding } from '../docs/app/src/free.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} is not ${expected}`);

test('a new free shape is a 400 × 300 rectangle with one corner cut, 18 thick', () => {
  assert.equal(SHAPES.free, 'Free shape');
  const piece = makeShape('free');
  assert.equal(piece.name, 'Free shape');
  assert.deepEqual(piece.points.map(({ x, y, bend }) => [x, y, bend]), [[0, 0, 0], [400, 0, 0], [400, 200, 0], [300, 300, 0], [0, 300, 0]]);
  assert.deepEqual(blank(piece), { length: 400, width: 300, thickness: 18 });
  close(faceArea(piece), 400 * 300 - (100 * 100) / 2);
  close(pieceVolume(piece), (400 * 300 - 5000) * 18);
  assert.deepEqual(outline(piece).points, [[-200, -150], [200, -150], [200, 50], [100, 150], [-200, 150]]);
  assert.deepEqual(Object.values(extents({ ...piece, pose: '+y+z+x' })).sort((a, b) => a - b), [18, 300, 400]);
});

test('switching to a free shape keeps its outline as points, and switching back loses nothing', () => {
  const board = makePart({ length: 720, width: 330, thickness: 22 });
  const free = updatePart(board, 'shape', 'free');
  assert.equal(free.name, 'Free shape');
  assert.deepEqual(free.points.map(({ x, y, bend }) => [x, y, bend]), [[0, 0, 0], [720, 0, 0], [720, 330, 0], [0, 330, 0]]);
  assert.deepEqual(blank(free), { length: 720, width: 330, thickness: 22 });
  const back = updatePart(free, 'shape', 'board');
  assert.deepEqual({ ...back, points: undefined }, { ...board, points: undefined });
  assert.equal(updatePart({ ...board, locked: true }, 'shape', 'free'), null);

  const rounded = { ...board, corners: 'rounded', cornerRadius: 40, cornerTopLeft: false };
  const roundedFree = updatePart(rounded, 'shape', 'free');
  assert.equal(roundedFree.points.length, 7, 'three rounded corners give two points each');
  close(faceArea(roundedFree), faceArea(rounded), 1e-4);
  assert.deepEqual(blank(roundedFree), blank(rounded));

  const cut = { ...board, corners: 'cut', cutLength: 50, cutWidth: 80 };
  close(faceArea(updatePart(cut, 'shape', 'free')), 720 * 330 - 4 * 2000);

  const triangle = updatePart(updatePart(board, 'shape', 'triangle'), 'shape', 'free');
  assert.equal(triangle.points.length, 3);
  close(faceArea(triangle), (720 * 330) / 2);
});

test('a disc becomes four points with bends and an arc keeps its curves, both with the same area and blank', () => {
  const disc = updatePart(makeShape('disc'), 'shape', 'free');
  assert.equal(disc.points.length, 4);
  assert.ok(disc.points.every((each) => each.bend > 0), 'every edge of a disc bulges outward');
  close(faceArea(disc), Math.PI * 200 ** 2, 1e-3);
  assert.deepEqual([disc.length, disc.width], [400, 400]);

  for (const sweep of [90, 200, 359]) {
    const arc = { ...makeShape('arc'), sweep };
    const free = updatePart(arc, 'shape', 'free');
    close(faceArea(free), faceArea(arc), 2e-3);
    assert.deepEqual([free.length, free.width], [blank(arc).length, blank(arc).width], `sweep ${sweep}`);
    assert.ok(free.points.some((each) => each.bend < 0), 'the inner edge bends inward');
  }
  assert.equal(updatePart({ ...makeShape('arc'), sweep: 360 }, 'shape', 'free'), null, 'a full ring has a hole');
});

test('a dowel becomes a rectangle as wide as its diameter, not the board width', () => {
  const dowel = { ...makeShape('dowel'), width: 330, dowelDiameter: 30 };
  const free = updatePart(dowel, 'shape', 'free');
  assert.deepEqual([free.length, free.width, free.thickness], [dowel.length, 30, 30]);
  close(faceArea(free), dowel.length * 30);
  assert.equal(freeSwitchProblem({ ...dowel, width: 20000 }), null, 'a board width past the limit does not block the switch');
});

test('a free shape keeps its outline while it is another shape, so switching back to Free restores it', () => {
  const drawn = updatePart(makeShape('free'), 'points', pts([0, 0], [400, 0, 40], [400, 300], [100, 300], [0, 200]));
  for (const other of ['board', 'disc', 'dowel', 'arc', 'triangle']) {
    const away = updatePart(drawn, 'shape', other);
    const again = updatePart(away, 'shape', 'free');
    assert.deepEqual(again.points, drawn.points, `Free → ${other} → Free`);
    assert.deepEqual([again.length, again.width], [drawn.length, drawn.width]);
  }
  const ring = updatePart(updatePart(drawn, 'shape', 'arc'), 'sweep', '360');
  assert.deepEqual(updatePart(ring, 'shape', 'free').points, drawn.points, 'a full ring that was a free shape gets its outline back');

  const longer = updatePart(updatePart(updatePart(drawn, 'shape', 'board'), 'length', '880'), 'shape', 'free');
  assert.deepEqual([longer.length, longer.width], [880, 300], 'a board made longer meanwhile stretches the outline');
  assert.equal(longer.points.length, drawn.points.length);

  const board = updatePart(drawn, 'shape', 'board');
  const loaded = parseProject(serialize({ name: 'Kept', parts: [board], joints: [] })).parts[0];
  assert.deepEqual(updatePart(loaded, 'shape', 'free').points, drawn.points, 'the outline is saved with the board too');
});

test('stretching an outline with bent edges keeps its blank on its points', () => {
  const disc = updatePart(makeShape('disc'), 'shape', 'free');
  for (const [side, size] of [['length', 800], ['length', 100], ['width', 800], ['width', 100]]) {
    const stretched = updatePart(disc, side, String(size));
    const span = box(stretched.points);
    assert.equal(stretched[side], size, `${side} ${size} lands as typed`);
    assert.equal(stretched[side === 'length' ? 'width' : 'length'], 400, `${side} ${size} keeps the other side`);
    assert.deepEqual(blank(stretched), { length: roundMm(span.maxX - span.minX), width: roundMm(span.maxY - span.minY), thickness: 18 }, `${side} ${size}`);
    assert.ok(Math.abs(span.minX) < 0.1 && Math.abs(span.minY) < 0.1, `${side} ${size} starts at the blank's corner`);
  }
});

test('a refused switch to Free or stretch of a free shape names what is wrong', () => {
  assert.equal(freeSwitchProblem({ ...makeShape('arc'), sweep: 360 }), 'ring');
  assert.equal(freeSwitchProblem(makePart({ width: 0.5 })), 'together');
  assert.equal(freeSwitchProblem(makePart()), null);
  const piece = makeShape('free');
  assert.equal(stretchProblem(piece, 'length', 0.1), 'together');
  assert.equal(stretchProblem(piece, 'length', 900), null);
});

const pts = (...list) => list.map(([x, y, bend = 0]) => ({ x, y, bend }));

test('a new outline is re-based to its blank, which becomes the length and width', () => {
  const piece = { ...makeShape('free'), x: 100, y: 50, z: 20 };
  const next = updatePart(piece, 'points', pts([-50, -20], [250, -20, 30], [250, 180], [-50, 180]));
  assert.deepEqual(next.points.map(({ x, y, bend }) => [x, y, bend]), [[0, 0, 0], [300, 0, 30], [300, 200, 0], [0, 200, 0]]);
  assert.deepEqual([next.length, next.width, next.thickness], [330, 200, 18], 'the bulge on the right edge widens the blank');
  assert.deepEqual([next.x, next.y, next.z], [100, 50, 20], 'the left, bottom, back corner stays where it was');
  assert.equal(updatePart({ ...piece, locked: true }, 'points', pts([0, 0], [10, 0], [0, 10])), null);
  assert.equal(updatePart(piece, 'points', pts([0, 0], [10, 0])), null, 'fewer than 3 points');
  assert.equal(updatePart(piece, 'points', pts([0, 0], [100, 100], [100, 0], [0, 100])), null, 'a crossing outline');
  assert.equal(updatePart(piece, 'points', pts([0, 0], [10, 0], [0, 10, 8])), null, 'a bend more than half its edge');
  assert.equal(updatePart(piece, 'points', Array.from({ length: 65 }, (_, i) => [Math.cos(i / 10) * 500, Math.sin(i / 10) * 500]).map(([x, y]) => ({ x, y, bend: 0 }))), null);
});

test('changing the length or width of a free shape stretches its outline that way', () => {
  const piece = makeShape('free');
  const longer = updatePart(piece, 'length', '800');
  assert.deepEqual(longer.points.map(({ x, y }) => [x, y]), [[0, 0], [800, 0], [800, 200], [600, 300], [0, 300]]);
  const narrower = updatePart(longer, 'width', '150');
  assert.deepEqual(narrower.points.map(({ x, y }) => [x, y]), [[0, 0], [800, 0], [800, 100], [600, 150], [0, 150]]);
  close(faceArea(narrower), 800 * 150 - (200 * 50) / 2);
  const disc = updatePart(makeShape('disc'), 'shape', 'free');
  const oval = updatePart(disc, 'length', '800');
  assert.equal(oval.length, 800);
  assert.ok(oval.points.every((each) => each.bend > 0), 'stretched curves still bulge outward');
  assert.equal(updatePart(piece, 'length', '0.1'), null, 'squeezed until points meet');
});

test('a free shape is saved with its outline, in format version 4, and older files still open', () => {
  const disc = updatePart(makeShape('disc'), 'shape', 'free');
  const text = serialize({ name: 'Shapes', parts: [makeShape('free'), disc, makePart()], joints: [] });
  assert.match(text, /"version": 4/);
  const loaded = parseProject(text);
  assert.deepEqual(loaded.parts.map(({ id, ...rest }) => rest), [makeShape('free'), disc, makePart()].map(({ id, ...rest }) => rest));
  assert.equal('points' in loaded.parts[2], false, 'only a free shape carries points');

  const file = (part, version = 4) => JSON.stringify({ format: 'woodworking-planner', version, parts: [part] });
  const plain = parseProject(file({ shape: 'free', length: 500, width: 250 })).parts[0];
  assert.deepEqual(plain.points.map(({ x, y }) => [x, y]), [[0, 0], [500, 0], [500, 250], [0, 250]], 'no outline saved: its blank');
  assert.equal('points' in parseProject(file({ shape: 'board', points: [] }, 3)).parts[0], false);
  const rectangle = pts([0, 0], [400, 0], [400, 300], [0, 300]);
  for (const sizes of [{}, { length: 1000, width: 1000 }, { length: 600, width: 200 }]) {
    const loaded = parseProject(file({ shape: 'free', points: rectangle, ...sizes })).parts[0];
    assert.deepEqual([loaded.length, loaded.width], [400, 300], `the blank comes from the points, not ${JSON.stringify(sizes)}`);
  }
  const moved = parseProject(file({ shape: 'free', points: pts([-50, 20], [350, 20], [350, 320], [-50, 320]) })).parts[0];
  assert.deepEqual(moved.points, rectangle, 'saved points away from the corner are re-based');
  assert.throws(() => parseProject(file({ shape: 'free', points: pts([0, 0], [100, 100], [100, 0], [0, 100]) })), /Part 1 has an invalid outline/);
  assert.throws(() => parseProject(file({ shape: 'free', points: [{ x: 'a', y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })), /Part 1 has an invalid outline/);
  assert.throws(() => parseProject(file({ shape: 'free', points: [{ x: null, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })), /Part 1 has an invalid outline/);
  assert.throws(() => parseProject('{"format":"woodworking-planner","version":5,"parts":[]}'), /newer version/);
});

test('the cut list groups free shapes only when their outlines match', () => {
  const one = makeShape('free');
  const two = { ...makeShape('free'), name: 'Leg' };
  const other = updatePart(makeShape('free'), 'points', pts([0, 0], [400, 0], [400, 300], [100, 300], [0, 200]));
  const rows = cutList([one, two, other]).filter((row) => row.shape === 'free');
  assert.deepEqual(rows.map((row) => row.count), [2, 1]);
  assert.deepEqual(rows[0].names, ['Free shape', 'Leg']);
});

test('an outline that crosses itself, has points together, has no area or is too big is named', () => {
  const crossed = pts([0, 0], [300, 0], [300, 200], [200, 200], [200, -100], [0, 100]);
  assert.deepEqual(outlineProblem(crossed, 10000), { kind: 'crossing', edges: [0, 3] });
  assert.deepEqual(outlineProblem(pts([0, 0], [300, 0], [300, 0.5], [0, 200]), 10000), { kind: 'together', points: [1, 2] });
  assert.deepEqual(outlineProblem(pts([0, 0], [100, 0], [200, 0]), 10000), { kind: 'flat' });
  assert.deepEqual(outlineProblem(pts([0, 0], [10001, 0], [0, 10]), 10000), { kind: 'big' });
  assert.deepEqual(outlineProblem(pts([0, 0], [100, 0], [100, 300], [0, 300, -150]), 10000), { kind: 'crossing', edges: [1, 3] }, 'an edge bent in far enough to cross the opposite one');
  assert.equal(outlineProblem(pts([0, 0], [400, 0], [400, 300], [0, 300, -150]), 10000), null);
  assert.deepEqual(outlineProblem(pts([0, 0], [400, 0], [100, 0], [0, 300]), 10000), { kind: 'crossing', edges: [0, 1] }, 'an edge folding back over the one before');
});

test('moving, adding and removing points keeps every bend within half its edge', () => {
  const square = pts([0, 0], [400, 0, 150], [400, 300], [0, 300]);
  const moved = movePoint(square, 2, 400, 100);
  assert.deepEqual([moved[2].x, moved[2].y], [400, 100]);
  assert.equal(moved[1].bend, 50, 'the bend of the shortened edge shrinks to half of it');
  const added = addPoint(pts([0, 0], [400, 0], [400, 300], [0, 300]), 1);
  assert.deepEqual(added.map(({ x, y }) => [x, y]), [[0, 0], [400, 0], [400, 150], [400, 300], [0, 300]]);
  const disc = updatePart(makeShape('disc'), 'shape', 'free').points;
  const split = addPoint(disc, 0);
  assert.equal(split.length, 5);
  close(area(split), area(disc), 1e-3);
  assert.deepEqual(removePoint(added, 2), pts([0, 0], [400, 0], [400, 300], [0, 300]));
  assert.equal(bendToward(square, 1, [1000, 150]), 150, 'a dragged bend stops at half its edge');
  assert.equal(bendToward(square, 1, [380, 150]), -20, 'dragged inward it bends inward');
});

test('a hand-drawn stroke becomes a few points, with bends where it curves', () => {
  const circle = Array.from({ length: 120 }, (_, i) => [200 * Math.cos((i / 120) * 2 * Math.PI), 200 * Math.sin((i / 120) * 2 * Math.PI)]);
  const round = fromStroke(circle);
  assert.ok(round.length >= 3 && round.length <= 8, `${round.length} points for a circle`);
  assert.ok(round.every((each) => each.bend > 0), 'a circle is drawn as outward arcs');
  close(area(round), Math.PI * 200 ** 2, 0.03);
  const square = [];
  for (let i = 0; i < 50; i++) square.push([i * 6, 0]);
  for (let i = 0; i < 50; i++) square.push([300, i * 6]);
  for (let i = 0; i < 50; i++) square.push([300 - i * 6, 300]);
  for (let i = 0; i < 50; i++) square.push([0, 300 - i * 6]);
  const box = fromStroke(square.reverse());
  assert.deepEqual(box.map(({ bend }) => bend), [0, 0, 0, 0]);
  assert.ok(area(box) > 0 && winding(box) === 1, 'a clockwise stroke is turned round');
  const zigzag = Array.from({ length: 400 }, (_, i) => [i * 5, i % 2 ? 40 + i : i]);
  assert.ok(fromStroke(zigzag).length <= 24);
  assert.equal(fromStroke([[0, 0], [5, 0], [5, 40], [0, 40]]), null, 'too small to be an outline');
});

test('a point added on an edge lands where it was asked, and a curved edge stays on its circle', () => {
  const square = pts([0, 0], [400, 0], [400, 300], [0, 300]);
  assert.deepEqual(insertPoint(square, 0, [100, 7]).map(({ x, y }) => [x, y]), [[0, 0], [100, 0], [400, 0], [400, 300], [0, 300]]);
  const disc = updatePart(makeShape('disc'), 'shape', 'free').points;
  const split = insertPoint(disc, 0, [380, 60]);
  close(area(split), area(disc), 1e-3);
  const [x, y] = [split[1].x - 200, split[1].y - 200];
  close(Math.hypot(x, y), 200, 1e-3);
});
