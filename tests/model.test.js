import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIENTATIONS,
  bounds,
  cutList,
  duplicatePart,
  extents,
  makePart,
  overlaps,
  parseProject,
  projectBounds,
  serialize,
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
