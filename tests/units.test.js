import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPose, makePart, movePart, overlaps, snapPosition, updatePart } from '../docs/app/src/model.js';
import { joinParts, rotateAssembly, touchingParts } from '../docs/app/src/joints.js';
import { parseProject, serialize } from '../docs/app/src/project.js';
import { cuttingFromFile } from '../docs/app/src/cutplan.js';
import { movePoint, rebase, scale, setBend } from '../docs/app/src/free.js';

const INCH = 25.4;
const flat = (fields) => makePart({ length: 609.6, width: 203.2, thickness: 19.05, pose: legacyPose('xzy'), ...fields });

function typedStack() {
  let [a, b, c] = ['A', 'B', 'C'].map((name) => flat({ name }));
  b = updatePart(b, 'y', 19.05);
  c = updatePart(c, 'y', 38.1);
  return { name: 'Stack', parts: [a, b, c], joints: [] };
}

function allTouchAndNoneOverlap(project) {
  const [a, b, c] = project.parts;
  assert.deepEqual(overlaps(project.parts), []);
  assert.deepEqual(touchingParts(project.parts, b.id).map((part) => part.name).sort(), ['A', 'C']);
  assert.ok(touchingParts(project.parts, a.id).some((part) => part.id === b.id));
  assert.ok(touchingParts(project.parts, c.id).some((part) => part.id === b.id));
}

test('three 3/4 in boards stacked by typing their positions touch and do not overlap', () => {
  const project = typedStack();
  assert.deepEqual(project.parts.map((part) => part.y), [0, 19.05, 38.1]);
  allTouchAndNoneOverlap(project);
});

test('the typed stack still touches after its assembly is turned', () => {
  let project = typedStack();
  const [a, b, c] = project.parts;
  project = joinParts(project, 'glue', a.id, b.id).project;
  project = joinParts(project, 'glue', b.id, c.id).project;
  for (const axis of ['x', 'y', 'z']) {
    const turned = rotateAssembly(project, a.id, axis);
    assert.notEqual(turned, project, axis);
    allTouchAndNoneOverlap(turned);
  }
});

test('a size or position typed in inches is kept, not put on the 0.1 mm grid', () => {
  const board = flat();
  assert.equal(updatePart(board, 'thickness', 19.05).thickness, 19.05);
  assert.equal(updatePart(board, 'x', 19.05 + 10).x, 29.05);
  assert.equal(updatePart(board, 'x', 0.79375).x, 0.79375);
  assert.equal(updatePart(board, 'thickness', '0.04'), null);
  assert.equal(updatePart(board, 'thickness', 0.1).thickness, 0.1);
  assert.equal(updatePart(board, 'sweep', '45.26').sweep, 45.3);
  assert.equal(movePart(board, { x: 12.7 + 0.79375 }).x, 13.49375);
});

test('a free drag lands on the given fine step and a snapped one on the given grid', () => {
  const board = flat();
  assert.equal(snapPosition(board, { x: 12.34 }, [board], { snap: false }).x, 12.3);
  assert.equal(snapPosition(board, { x: 0.15 }, [board], { snap: false }).x, 0.2);
  assert.equal(snapPosition(board, { x: 12.34 }, [board], { snap: false, fine: INCH / 16 }).x, 12.7);
  assert.equal(snapPosition(board, { x: 12.34 }, [board], { snap: false, fine: INCH / 32 }).x, 12.7);
  assert.equal(snapPosition(board, { x: 136 }, [board]).x, 140);
  assert.equal(snapPosition(board, { x: 136 }, [board], { grid: INCH / 2 }).x, 139.7);
});

test('outline points keep inch values exactly', () => {
  const points = [{ x: 0, y: 0, bend: 0 }, { x: 400, y: 0, bend: 0 }, { x: 400, y: 300, bend: 0 }];
  assert.equal(movePoint(points, 2, 406.4, 304.8)[2].x, 406.4);
  assert.equal(movePoint(points, 2, 400.79375, 300)[2].x, 400.79375);
  assert.equal(setBend(points, 0, 12.7)[0].bend, 12.7);
  assert.deepEqual(rebase(points.map((each) => ({ ...each, x: each.x + 19.05 })))[1], { x: 400, y: 0, bend: 0 });
  assert.equal(scale(points, 1.524, 1)[1].x, 609.6);
});

test('a project with inch sizes saves at version 7 and loads back identical', () => {
  const project = { ...typedStack(), cutting: { kerf: INCH / 8, trim: INCH / 16, stock: {} } };
  const text = serialize(project);
  assert.match(text, /"version": 7/);
  const loaded = parseProject(text);
  const sizes = (state) => state.parts.map(({ id, ...rest }) => rest);
  assert.deepEqual(sizes(loaded), sizes(project));
  assert.deepEqual([loaded.cutting.kerf, loaded.cutting.trim], [3.175, 1.5875]);
  assert.equal(serialize(loaded), text);
});

test('a file saved on the 0.1 mm grid loads every value as it did and saves back the same text', () => {
  const file = {
    format: 'woodworking-planner',
    version: 7,
    name: 'Old',
    parts: [
      { name: 'Side', shape: 'board', length: 612.3, width: 244.5, thickness: 18, x: -0.1, y: 300.3, z: 6.6, pose: '+y+z+x' },
      { name: 'Free', shape: 'free', length: 400, width: 300, thickness: 18, x: 30.7, points: [{ x: 0, y: 0, bend: 0 }, { x: 400, y: 0, bend: 12.3 }, { x: 0, y: 300, bend: 0 }] },
    ],
    joints: [{ kind: 'screws', part: 0, to: 1, count: 3, diameter: 3.5, length: 40.1, glued: false }],
    cutting: { kerf: 3.2, trim: 0.1, stock: {} },
  };
  const loaded = parseProject(JSON.stringify(file));
  const [side, free] = loaded.parts;
  assert.deepEqual([side.length, side.width, side.x, side.y, side.z], [612.3, 244.5, -0.1, 300.3, 6.6]);
  assert.deepEqual(free.points, file.parts[1].points);
  assert.deepEqual([loaded.joints[0].diameter, loaded.joints[0].length], [3.5, 40.1]);
  assert.deepEqual([loaded.cutting.kerf, loaded.cutting.trim], [3.2, 0.1]);
  assert.equal(serialize(parseProject(serialize(loaded))), serialize(loaded));
});

test('a cutting plan read from a file keeps a 1/8 in kerf and inch stock sizes', () => {
  const cutting = cuttingFromFile({ kerf: 3.175, trim: 0, stock: { 'pine:19.05': { length: 2438.4, width: 1219.2, own: true } } });
  assert.equal(cutting.kerf, 3.175);
  assert.deepEqual(cutting.stock['pine:19.05'], { length: 2438.4, width: 1219.2, own: true });
});
