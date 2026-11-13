import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, blank, cutList, extents, faceArea, makePart, makeShape, outline, pieceVolume, updatePart } from '../docs/app/src/model.js';
import { parseProject, serialize } from '../docs/app/src/project.js';

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
  assert.deepEqual(updatePart(free, 'shape', 'board'), board);
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
  assert.throws(() => parseProject(file({ shape: 'free', points: pts([0, 0], [100, 100], [100, 0], [0, 100]) })), /Part 1 has an invalid outline/);
  assert.throws(() => parseProject(file({ shape: 'free', points: [{ x: 'a', y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })), /Part 1 has an invalid outline/);
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
