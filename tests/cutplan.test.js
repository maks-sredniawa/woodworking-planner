import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, cutList, makePart, partFromFile, updatePart } from '../docs/app/src/model.js';

test('sheet woods and board woods are told apart, and MDF has no grain', () => {
  assert.deepEqual(
    Object.keys(SPECIES).filter((key) => SPECIES[key].stock === 'sheet'),
    ['birchPlywood', 'mdf'],
  );
  assert.ok(Object.values(SPECIES).every((wood) => wood.stock === 'sheet' || wood.stock === 'board'));
  assert.deepEqual(Object.keys(SPECIES).filter((key) => !SPECIES[key].grain), ['mdf']);
});

test('a piece keeps its grain along the length by default, except in MDF', () => {
  assert.equal(makePart().grain, true);
  assert.equal(makePart({ species: 'mdf' }).grain, false);
  assert.equal(partFromFile({ species: 'mdf' }, 0).grain, false);
  assert.equal(partFromFile({ species: 'oak' }, 0).grain, true);
  assert.equal(partFromFile({ species: 'oak', grain: false }, 0).grain, false);
  assert.throws(() => partFromFile({ grain: 'yes' }, 0), /Part 1 has an invalid grain/);
});

test('the grain tick changes on a locked piece and follows a switch to or from MDF', () => {
  const locked = makePart({ locked: true });
  assert.equal(updatePart(locked, 'grain', false).grain, false);
  const unticked = updatePart(makePart(), 'grain', false);
  assert.equal(updatePart(unticked, 'species', 'oak').grain, false, 'a wood with grain keeps the choice');
  assert.equal(updatePart(makePart(), 'species', 'mdf').grain, false);
  assert.equal(updatePart(makePart({ species: 'mdf' }), 'species', 'pine').grain, true);
});

test('each cut-list row names the pieces it stands for', () => {
  const a = makePart({ name: 'Shelf' });
  const b = makePart({ name: 'Shelf' });
  const c = makePart({ name: 'Top', length: 900 });
  const rows = cutList([a, b, c]);
  assert.deepEqual(rows.map((row) => row.parts.map((part) => part.id)), [[c.id], [a.id, b.id]]);
});
