import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIENTATIONS,
  SHAPES,
  blank,
  bounds,
  cutList,
  duplicatePart,
  extents,
  faceArea,
  makePart,
  makeShape,
  MAX_SIZE_MM,
  outline,
  pieceVolume,
  movePart,
  newPartBeside,
  overlaps,
  parseProject,
  projectBounds,
  rotatePart,
  serialize,
  snapPosition,
  starterProject,
  totals,
  updatePart,
} from '../src/model.js';

test('every orientation maps length, width and thickness to three different axes', () => {
  for (const orientation of Object.keys(ORIENTATIONS)) {
    const size = extents(makePart({ length: 900, width: 300, thickness: 18, orientation }));
    assert.deepEqual(Object.values(size).sort((a, b) => a - b), [18, 300, 900], orientation);
    assert.equal(size[orientation[0]], 900);
    assert.equal(size[orientation[2]], 18);
  }
});

test('bounds start at the position and add the extents', () => {
  const part = makePart({ length: 1000, width: 250, thickness: 18, orientation: 'yzx', x: 782, y: 0, z: 6 });
  assert.deepEqual(bounds(part), { min: { x: 782, y: 0, z: 6 }, max: { x: 800, y: 1000, z: 256 } });
});

test('the starter bookshelf has no overlapping parts and fits 800 × 1000 × 250', () => {
  const { parts } = starterProject();
  assert.deepEqual(overlaps(parts), []);
  assert.deepEqual(projectBounds(parts), { min: { x: 0, y: 0, z: 0 }, max: { x: 800, y: 1000, z: 250 } });
});

test('boards that only touch do not overlap, boards that cross do', () => {
  const a = makePart({ length: 500, width: 100, thickness: 20, orientation: 'xzy' });
  const touching = makePart({ length: 500, width: 100, thickness: 20, orientation: 'xzy', y: 20 });
  const crossing = makePart({ length: 500, width: 100, thickness: 20, orientation: 'zxy', x: 200, y: 10 });
  assert.deepEqual(overlaps([a, touching]), []);
  assert.deepEqual(overlaps([a, touching, crossing]), [
    [a.id, crossing.id],
    [touching.id, crossing.id],
  ]);
});

test('cut list groups identical boards of the same wood and keeps their names', () => {
  const { parts } = starterProject();
  const list = cutList(parts);
  const shelves = list.find((row) => row.length === 764);
  assert.equal(shelves.count, 4);
  assert.deepEqual(shelves.names, ['Bottom', 'Shelf', 'Top']);
  assert.equal(list.reduce((sum, row) => sum + row.count, 0), parts.length);
  assert.equal(list.find((row) => row.species === 'birchPlywood').thickness, 6);
});

test('totals add volume, face area and weight', () => {
  const part = makePart({ length: 1000, width: 100, thickness: 20, species: 'oak' });
  const result = totals([part, { ...part, id: 'other' }]);
  assert.equal(result.count, 2);
  assert.ok(Math.abs(result.volume - 0.004) < 1e-12);
  assert.ok(Math.abs(result.area - 0.2) < 1e-12);
  assert.ok(Math.abs(result.weight - 2.88) < 1e-9);
});

test('updatePart rejects sizes that are not positive or are too large and rounds to 0.1 mm', () => {
  const part = makePart();
  assert.equal(updatePart(part, 'length', '0'), null);
  assert.equal(updatePart(part, 'length', '-5'), null);
  assert.equal(updatePart(part, 'length', 'abc'), null);
  assert.equal(updatePart(part, 'width', '20000'), null);
  assert.equal(updatePart(part, 'x', ''), null);
  assert.equal(updatePart(part, 'length', '612.345').length, 612.3);
  assert.equal(updatePart(part, 'x', '-40').x, -40);
  assert.equal(updatePart(part, 'species', 'unobtainium'), null);
  assert.equal(updatePart(part, 'orientation', 'xxx'), null);
});

test('a duplicate gets a new id and sits beside the original, not inside it', () => {
  const part = makePart({ orientation: 'yzx', thickness: 18 });
  const copy = duplicatePart(part);
  assert.notEqual(copy.id, part.id);
  assert.equal(copy.x, 38);
  assert.deepEqual(overlaps([part, copy]), []);
});

test('a saved project loads back the same', () => {
  const project = starterProject();
  const loaded = parseProject(serialize(project));
  assert.equal(loaded.name, project.name);
  const strip = (parts) => parts.map(({ id, ...rest }) => rest);
  assert.deepEqual(strip(loaded.parts), strip(project.parts));
});

test('loading rejects files that are not projects or hold bad parts', () => {
  assert.throws(() => parseProject('not json'), /not valid JSON/);
  assert.throws(() => parseProject('{"format":"other"}'), /not a Woodworking planner project/);
  assert.throws(() => parseProject('{"format":"woodworking-planner","version":99,"parts":[]}'), /newer version/);
  assert.throws(
    () => parseProject('{"format":"woodworking-planner","version":1,"parts":[{"length":-1}]}'),
    /Part 1 has an invalid length/,
  );
});

test('a dragged board snaps flush against a nearby board face', () => {
  const side = makePart({ length: 1000, width: 244, thickness: 18, orientation: 'yzx', x: 0 });
  const shelf = makePart({ length: 764, width: 244, thickness: 18, orientation: 'xzy' });
  assert.deepEqual(snapPosition(shelf, { x: 25, z: 7 }, [side, shelf]), { x: 18, z: 0 });
  const right = makePart({ length: 1000, width: 244, thickness: 18, orientation: 'yzx', x: 900 });
  assert.equal(snapPosition(shelf, { x: 130 }, [right]).x, 136);
});

test('away from other boards a dragged board snaps to the 10 mm grid, and Alt turns snapping off', () => {
  const board = makePart();
  assert.deepEqual(snapPosition(board, { x: 343, z: -127 }, [board]), { x: 340, z: -130 });
  assert.deepEqual(snapPosition(board, { x: 343.27 }, [board], { snap: false }), { x: 343.3 });
});

test('a dragged board settles on the floor and never snaps below it', () => {
  const board = makePart();
  assert.equal(snapPosition(board, { y: 9 }, [board]).y, 0);
  assert.equal(snapPosition(board, { y: -40 }, [board]).y, 0);
  assert.equal(snapPosition(board, { y: -40 }, [board], { snap: false }).y, -40);
});

test('movePart changes only the given axes and refuses positions beyond the limit', () => {
  const board = makePart({ x: 5, y: 6, z: 7 });
  assert.deepEqual(
    (({ x, y, z }) => ({ x, y, z }))(movePart(board, { x: 12.34 })),
    { x: 12.3, y: 6, z: 7 },
  );
  assert.equal(movePart(board, { y: 20000 }), board);
});

test('turning a board swaps the two axes around the turn axis and keeps its centre', () => {
  const shelf = makePart({ length: 764, width: 244, thickness: 18, orientation: 'xzy', x: 18, y: 300, z: 6 });
  const turned = rotatePart(shelf, 'y');
  assert.equal(turned.orientation, 'zxy');
  assert.deepEqual(extents(turned), { z: 764, x: 244, y: 18 });
  const centre = (part) => {
    const size = extents(part);
    return [part.x + size.x / 2, part.y + size.y / 2, part.z + size.z / 2];
  };
  assert.deepEqual(centre(turned), centre(shelf));
  assert.deepEqual(rotatePart(turned, 'y'), shelf);
});

test('every rotation gives a valid orientation and four turns bring the board back', () => {
  for (const orientation of Object.keys(ORIENTATIONS)) {
    for (const axis of ['x', 'y', 'z']) {
      const board = makePart({ orientation, y: 2000 });
      const once = rotatePart(board, axis);
      assert.ok(once.orientation in ORIENTATIONS, `${orientation} around ${axis}`);
      let back = board;
      for (let i = 0; i < 4; i++) back = rotatePart(back, axis);
      assert.deepEqual(back, board);
    }
  }
});

test('tipping a board that lies on the floor keeps it on the floor, not through it', () => {
  const shelf = makePart({ length: 764, width: 244, thickness: 18, orientation: 'xzy', y: 0 });
  const tipped = rotatePart(shelf, 'x');
  assert.equal(tipped.orientation, 'xyz');
  assert.equal(tipped.y, 0);
});

test('a locked board refuses moves, rotations and size changes but keeps its name and wood editable', () => {
  const board = updatePart(makePart({ x: 40 }), 'locked', true);
  assert.equal(board.locked, true);
  assert.equal(movePart(board, { x: 90 }), board);
  assert.equal(rotatePart(board, 'y'), board);
  for (const field of ['length', 'width', 'thickness', 'x', 'y', 'z']) assert.equal(updatePart(board, field, '120'), null, field);
  assert.equal(updatePart(board, 'orientation', 'zxy'), null);
  assert.equal(updatePart(board, 'name', 'Leg').name, 'Leg');
  assert.equal(updatePart(board, 'species', 'oak').species, 'oak');
  assert.equal(updatePart(board, 'locked', false).locked, false);
  assert.equal(updatePart(board, 'locked', 'yes'), null);
});

test('a copy of a locked board starts unlocked, and the lock survives saving', () => {
  const board = updatePart(makePart({ x: 300, y: 20 }), 'locked', true);
  assert.equal(duplicatePart(board).locked, false);
  const [loaded] = parseProject(serialize({ name: 'Locked', parts: [board] })).parts;
  assert.equal(loaded.locked, true);
  assert.equal(loaded.x, 300);
  assert.equal(loaded.y, 20);
  const [old] = parseProject('{"format":"woodworking-planner","version":1,"parts":[{"length":500}]}').parts;
  assert.equal(old.locked, false);
});

const survivesSaving = (parts) => parseProject(serialize({ name: 'Limits', parts }));

test('every edit keeps a project near the size limit loadable', () => {
  const long = makePart({ length: MAX_SIZE_MM, x: 0 });
  const added = newPartBeside([long]);
  assert.doesNotThrow(() => survivesSaving([long, added]));
  assert.ok(Math.abs(added.x) <= MAX_SIZE_MM, `added at x ${added.x}`);

  const spread = [makePart({ x: -MAX_SIZE_MM }), makePart({ length: MAX_SIZE_MM, x: 0 })];
  const squeezed = newPartBeside(spread);
  assert.doesNotThrow(() => survivesSaving([...spread, squeezed]));

  const high = makePart({ y: MAX_SIZE_MM - 10 });
  const copy = duplicatePart(high);
  assert.notEqual(copy, high);
  assert.doesNotThrow(() => survivesSaving([high, copy]));
  assert.deepEqual(overlaps([high, copy]), []);

  const far = makePart({ length: MAX_SIZE_MM, x: 9000, z: 9900, y: 9990 });
  for (const axis of ['x', 'y', 'z']) {
    const turned = rotatePart(far, axis);
    assert.doesNotThrow(() => survivesSaving([turned]), `turn around ${axis}`);
  }
  assert.equal(rotatePart(far, 'y'), far, 'a turn that would leave the limit leaves the board as it was');
  assert.doesNotThrow(() => survivesSaving([movePart(far, { x: MAX_SIZE_MM + 1 })]));
});

test('a board placed beside the project goes right, then left, then to the origin', () => {
  assert.equal(newPartBeside([]).x, 0);
  assert.equal(newPartBeside([makePart({ length: 800 })]).x, 850);
  assert.equal(newPartBeside([makePart({ length: MAX_SIZE_MM, x: 0 })]).x, -650);
  assert.equal(newPartBeside([makePart({ length: MAX_SIZE_MM, x: -MAX_SIZE_MM }), makePart({ length: MAX_SIZE_MM })]).x, 0);
});

test('a duplicate that has no room on either side is refused', () => {
  const slab = makePart({ thickness: MAX_SIZE_MM, orientation: 'xyz', z: 0 });
  assert.equal(duplicatePart(slab), slab);
});

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);

const outlineBox = (part) => {
  const { points, holes } = outline(part);
  const all = [...points, ...holes.flat()];
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

test('a disc is a diameter square blank as thick as the disc, with a round face', () => {
  const disc = makeShape('disc');
  assert.equal(disc.name, 'Disc');
  assert.deepEqual(blank(disc), { length: 400, width: 400, thickness: 18 });
  assert.deepEqual(extents({ ...disc, orientation: 'yxz' }), { y: 400, x: 400, z: 18 });
  close(faceArea(disc), Math.PI * 200 ** 2);
  close(pieceVolume(disc), Math.PI * 200 ** 2 * 18);
});

test('a dowel is a round rod: its blank is length × diameter × diameter', () => {
  const dowel = makeShape('dowel');
  assert.deepEqual(blank(dowel), { length: 450, width: 30, thickness: 30 });
  assert.deepEqual(extents({ ...dowel, orientation: 'yzx' }), { y: 450, z: 30, x: 30 });
  close(pieceVolume(dowel), Math.PI * 15 ** 2 * 450);
  close(faceArea(dowel), 450 * 30);
});

test('an arc is a ring segment centred on the width axis, and its blank is the tightest box around it', () => {
  const arc = makeShape('arc');
  const quarter = blank(arc);
  assert.equal(quarter.length, 565.7);
  assert.equal(quarter.width, 159.6);
  close(faceArea(arc), (Math.PI * (400 ** 2 - 340 ** 2)) / 4);
  assert.deepEqual(blank({ ...arc, sweep: 180 }), { length: 800, width: 400, thickness: 18 });
  assert.deepEqual(blank({ ...arc, sweep: 360 }), { length: 800, width: 800, thickness: 18 });
  assert.equal(blank({ ...arc, sweep: 270 }).width, 682.8);
  for (const sweep of [1, 45, 90, 180, 200, 270, 359, 360]) {
    const piece = { ...arc, sweep };
    const box = outlineBox(piece);
    const size = blank(piece);
    assert.ok(Math.abs(box.maxX - box.minX - size.length) < 0.1, `outline length at ${sweep}°`);
    assert.ok(Math.abs(box.maxY - box.minY - size.width) < 0.1, `outline width at ${sweep}°`);
    assert.ok(Math.abs(box.maxX + box.minX) < 0.1 && Math.abs(box.maxY + box.minY) < 0.1, `outline centred at ${sweep}°`);
  }
  assert.equal(outline({ ...arc, sweep: 360 }).holes.length, 1);
});

test('a triangle has the legs as length and width and half their area', () => {
  const triangle = makeShape('triangle');
  assert.deepEqual(blank(triangle), { length: 200, width: 200, thickness: 18 });
  close(faceArea(triangle), 20000);
  assert.deepEqual(outline(triangle).points, [[-100, -100], [100, -100], [-100, 100]]);
});

test('rounded and cut corners take their area off the board, and square corners take none', () => {
  const board = makePart({ length: 600, width: 280 });
  close(faceArea(board), 600 * 280);
  const rounded = { ...board, corners: 'rounded', cornerRadius: 20, cornerBottomLeft: false, cornerBottomRight: false };
  close(faceArea(rounded), 600 * 280 - 2 * 400 * (1 - Math.PI / 4));
  const cut = { ...board, corners: 'cut', cutLength: 50, cutWidth: 80 };
  close(faceArea(cut), 600 * 280 - 4 * 2000);
  assert.deepEqual(blank(cut), { length: 600, width: 280, thickness: 18 });
  const box = outlineBox(rounded);
  assert.deepEqual([box.minX, box.maxX, box.minY, box.maxY].map(Math.round), [-300, 300, -140, 140]);
  assert.equal(outline({ ...board, corners: 'cut', cutLength: 50, cutWidth: 80, cornerTopRight: false, cornerBottomLeft: false, cornerBottomRight: false }).points.length, 5);
  close(faceArea({ ...rounded, corners: 'square' }), 600 * 280);
});

test('switching shape keeps length, width and thickness, so switching back loses nothing', () => {
  const board = makePart({ length: 720, width: 330, thickness: 22 });
  const disc = updatePart(board, 'shape', 'disc');
  assert.equal(disc.name, 'Disc', 'a default name follows the shape');
  const back = updatePart(updatePart(disc, 'shape', 'triangle'), 'shape', 'board');
  assert.deepEqual(back, board);
  assert.equal(updatePart({ ...board, name: 'Leg' }, 'shape', 'dowel').name, 'Leg', 'a chosen name stays');
  assert.equal(updatePart(board, 'shape', 'hexagon'), null);
  assert.equal(updatePart({ ...board, locked: true }, 'shape', 'disc'), null);
});

test('every shape keeps working with rotation, duplication, snapping and overlaps', () => {
  for (const shape of Object.keys(SHAPES)) {
    const piece = { ...makeShape(shape), y: 500 };
    let back = piece;
    for (let i = 0; i < 4; i++) back = rotatePart(back, 'x');
    assert.deepEqual(back, piece, `${shape} turns back`);
    const copy = duplicatePart(piece);
    assert.deepEqual(overlaps([piece, copy]), [], `${shape} copy sits beside it`);
    const beside = newPartBeside([piece], shape);
    assert.equal(beside.shape, shape);
    assert.deepEqual(overlaps([piece, beside]), [], `${shape} added beside`);
    assert.equal(snapPosition(piece, { x: 7 }, [piece]).x, 10);
  }
});

test('the cut list names the blank and groups identical pieces including their shape', () => {
  const disc = makeShape('disc');
  const rounded = { ...makePart({ width: 280 }), corners: 'rounded', cornerTopLeft: false, cornerTopRight: false };
  const flipped = { ...rounded, id: 'flip', cornerTopLeft: true, cornerTopRight: true, cornerBottomLeft: false, cornerBottomRight: false };
  const diagonal = { ...rounded, id: 'diag', cornerTopLeft: true, cornerBottomLeft: false };
  const plain = makePart({ width: 280 });
  const parts = [disc, { ...disc, id: 'd2', name: 'Lid' }, { ...disc, id: 'd3', diameter: 300 }, rounded, flipped, diagonal, plain, makeShape('dowel'), makeShape('arc'), { ...makeShape('arc'), id: 'a2', sweep: 120 }];
  const list = cutList(parts);
  assert.equal(list.reduce((sum, row) => sum + row.count, 0), parts.length);
  const discs = list.filter((row) => row.shape === 'disc');
  assert.deepEqual(discs.map((row) => [row.length, row.count]), [[400, 2], [300, 1]]);
  assert.deepEqual(discs[0].names, ['Disc', 'Lid']);
  const boards = list.filter((row) => row.shape === 'board');
  assert.deepEqual(boards.map((row) => row.count).sort(), [1, 1, 2], 'the same corners flipped group, diagonal and square ones do not');
  assert.equal(list.filter((row) => row.shape === 'arc').length, 2);
  const dowel = list.find((row) => row.shape === 'dowel');
  assert.deepEqual([dowel.length, dowel.width, dowel.thickness], [450, 30, 30]);
  close(discs[0].volume, pieceVolume(disc));
  const sum = totals(parts);
  close(sum.area * 1e6, parts.reduce((total, part) => total + faceArea(part), 0));
});

test('new shape fields are checked: positive, within limits and fitting the piece', () => {
  const board = makePart({ length: 600, width: 280, corners: 'rounded' });
  assert.equal(updatePart(board, 'cornerRadius', '140').cornerRadius, 140);
  assert.equal(updatePart(board, 'cornerRadius', '140.1'), null, 'a radius more than half the width');
  assert.equal(updatePart(board, 'cornerRadius', '0'), null);
  assert.equal(updatePart(board, 'cornerRadius', '0.04'), null, 'a radius that rounds to 0');
  const cut = { ...board, corners: 'cut' };
  assert.equal(updatePart(cut, 'cutLength', '300').cutLength, 300);
  assert.equal(updatePart(cut, 'cutLength', '301'), null);
  assert.equal(updatePart(cut, 'cutWidth', '141'), null);
  assert.equal(updatePart({ ...board, cornerRadius: 100 }, 'width', '150'), null, 'shrinking under the corners');
  assert.equal(updatePart({ ...board, corners: 'square', cornerRadius: 100 }, 'width', '150').width, 150, 'square corners ignore the radius');
  const refit = updatePart({ ...board, corners: 'square', cornerRadius: 100, width: 150 }, 'corners', 'rounded');
  assert.equal(refit.cornerRadius, 75, 'turning corners on fits a stale radius to the board');
  assert.equal(updatePart(board, 'corners', 'bevelled'), null);
  assert.equal(updatePart(board, 'cornerTopLeft', 'yes'), null);
  assert.equal(updatePart(board, 'cornerTopLeft', false).cornerTopLeft, false);

  const arc = makeShape('arc');
  assert.equal(updatePart(arc, 'bandWidth', '400'), null, 'band as wide as the radius');
  assert.equal(updatePart(arc, 'outerRadius', '60'), null);
  assert.equal(updatePart(arc, 'outerRadius', '5000').outerRadius, 5000);
  assert.equal(updatePart(arc, 'outerRadius', '5001'), null);
  assert.equal(updatePart(arc, 'sweep', '0.5'), null);
  assert.equal(updatePart(arc, 'sweep', '361'), null);
  assert.equal(updatePart(arc, 'sweep', '360').sweep, 360);
  assert.equal(updatePart(arc, 'sweep', ''), null);
  for (const field of ['diameter', 'dowelDiameter']) {
    assert.equal(updatePart(arc, field, String(MAX_SIZE_MM + 1)), null, field);
    assert.equal(updatePart(arc, field, 'Infinity'), null, field);
    assert.equal(updatePart(arc, field, '-3'), null, field);
  }
});

test('every shape edit survives saving and loading, even at the limits', () => {
  const pieces = [
    { ...makeShape('arc'), outerRadius: 5000, bandWidth: 4999.9, sweep: 360, x: MAX_SIZE_MM },
    { ...makeShape('disc'), diameter: MAX_SIZE_MM },
    { ...makeShape('dowel'), dowelDiameter: MAX_SIZE_MM, length: 0.1 },
    { ...makePart({ length: 0.2, width: 0.2 }), corners: 'rounded', cornerRadius: 0.1 },
    { ...makePart(), corners: 'cut', cutLength: 300, cutWidth: 100, cornerTopLeft: false, locked: true },
    makeShape('triangle'),
  ];
  const strip = (parts) => parts.map(({ id, ...rest }) => rest);
  assert.deepEqual(strip(survivesSaving(pieces).parts), strip(pieces));
  for (const piece of pieces) {
    for (const axis of ['x', 'y', 'z']) assert.doesNotThrow(() => survivesSaving([rotatePart(piece, axis)]));
    assert.doesNotThrow(() => survivesSaving([piece, duplicatePart(piece)]));
  }
  const edge = makePart({ length: 0.3, width: 0.3, cornerRadius: 20 });
  const turnedOn = updatePart(edge, 'corners', 'rounded');
  assert.equal(turnedOn.cornerRadius, 0.1);
  assert.doesNotThrow(() => survivesSaving([turnedOn]));
});

test('a version 1 file loads every part as a board with square corners, and bad shape fields are refused', () => {
  const [old] = parseProject('{"format":"woodworking-planner","version":1,"parts":[{"name":"Side","length":900,"width":250,"thickness":18}]}').parts;
  assert.equal(old.shape, 'board');
  assert.equal(old.corners, 'square');
  assert.deepEqual(blank(old), { length: 900, width: 250, thickness: 18 });
  assert.match(serialize({ name: 'n', parts: [old] }), /"version": 2/);
  const file = (part) => JSON.stringify({ format: 'woodworking-planner', version: 2, parts: [part] });
  assert.throws(() => parseProject(file({ shape: 'hexagon' })), /Part 1 has an invalid shape/);
  assert.throws(() => parseProject(file({ shape: 'arc', bandWidth: 500 })), /invalid bandWidth/);
  assert.throws(() => parseProject(file({ sweep: 0 })), /invalid sweep/);
  assert.throws(() => parseProject(file({ corners: 'rounded', width: 30 })), /invalid cornerRadius/);
  assert.doesNotThrow(() => parseProject(file({ corners: 'square', width: 30 })));
  assert.throws(() => parseProject(file({ corners: 'cut', cutWidth: 150 })), /invalid cutWidth/);
  assert.throws(() => parseProject(file({ cornerTopLeft: 1 })), /invalid cornerTopLeft/);
  assert.throws(() => parseProject(file({ outerRadius: 6000 })), /invalid outerRadius/);
  assert.throws(() => parseProject('{"format":"woodworking-planner","version":3,"parts":[]}'), /newer version/);
});
