import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, cutList, makePart, makeShape, partFromFile, updatePart } from '../docs/app/src/model.js';
import { DEFAULT_CUTTING, cuttingFromFile, cuttingPlan, defaultStock, misfitIds, planPieces } from '../docs/app/src/cutplan.js';
import { parseProject, serialize, starterProject } from '../docs/app/src/project.js';

const settings = (fields = {}) => ({ ...DEFAULT_CUTTING, ...fields });
const piecesOf = (parts) => planPieces(cutList(parts));
const planOf = (parts, fields) => cuttingPlan(piecesOf(parts), settings(fields));
const board = (fields) => makePart({ species: 'pine', thickness: 18, ...fields });
const own = (length, width) => ({ length, width, own: true });

function assertSound(plan, { kerf, trim }) {
  for (const group of plan.groups) {
    const { length, width } = group.stock;
    for (const sheet of group.sheets) {
      for (const piece of sheet.placements) {
        assert.ok(piece.x >= trim - 1e-9 && piece.y >= trim - 1e-9, `${piece.name} starts inside the trim`);
        assert.ok(piece.x + piece.length <= length - trim + 1e-9, `${piece.name} runs past the end`);
        assert.ok(piece.y + piece.width <= width - trim + 1e-9, `${piece.name} runs past the edge`);
      }
      sheet.placements.forEach((a, i) => {
        for (const b of sheet.placements.slice(i + 1)) {
          const apart = Math.max(b.x - (a.x + a.length), a.x - (b.x + b.length), b.y - (a.y + a.width), a.y - (b.y + b.width));
          assert.ok(apart >= kerf - 1e-9, `${a.name} and ${b.name} are ${apart} apart, less than the ${kerf} kerf`);
        }
      });
    }
  }
}

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

test('one piece goes on one board at its top-left corner, and the rest counts as waste', () => {
  const shelf = board({ name: 'Shelf', length: 764, width: 244 });
  const plan = planOf([shelf]);
  assert.equal(plan.boards, 1);
  assert.equal(plan.sheets, 0);
  const [group] = plan.groups;
  assert.deepEqual([group.stock.length, group.stock.width], [2400, 244]);
  assert.equal(group.sheets.length, 1);
  assert.deepEqual(group.sheets[0].placements, [{ id: shelf.id, name: 'Shelf', number: 1, x: 0, y: 0, length: 764, width: 244, turned: false }]);
  assert.equal(Math.round(group.waste * 1000) / 1000, Math.round((1 - 764 / 2400) * 1000) / 1000);
  assert.equal(plan.waste, group.waste);
});

test('the saw kerf is left between neighbours, so four 600 pieces need two 2,400 boards', () => {
  const parts = Array.from({ length: 4 }, (_, i) => board({ name: `Rail ${i + 1}`, length: 600, width: 200 }));
  assert.equal(planOf(parts, { kerf: 0 }).boards, 1);
  const plan = planOf(parts, { kerf: 3 });
  assert.equal(plan.boards, 2);
  assertSound(plan, { kerf: 3, trim: 0 });
  const xs = plan.groups[0].sheets[0].placements.map((piece) => piece.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 603, 1206]);
});

test('edge trim is cut off every edge before anything is laid out', () => {
  const parts = [board({ length: 1000, width: 100 }), board({ length: 1000, width: 100 })];
  const plan = planOf(parts, { trim: 10, kerf: 3, stock: { 'pine:18': own(2400, 244) } });
  assertSound(plan, { kerf: 3, trim: 10 });
  assert.deepEqual([plan.groups[0].sheets[0].placements[0].x, plan.groups[0].sheets[0].placements[0].y], [10, 10]);
  assert.equal(plan.boards, 1);
  const exact = planOf([board({ length: 2400, width: 244 })], { trim: 1 });
  assert.equal(exact.groups[0].misfits.length, 1);
});

test('a piece keeping its grain is never turned; one that may turn is turned when that is the only way it fits', () => {
  const stock = { 'pine:18': own(1000, 600) };
  const kept = board({ name: 'Panel', length: 500, width: 900 });
  const keptPlan = planOf([kept], { stock });
  assert.deepEqual(keptPlan.groups[0].misfits, [{ id: kept.id, name: 'Panel', length: 500, width: 900, reason: 'grain' }]);
  assert.equal(keptPlan.groups[0].sheets.length, 0);
  const free = { ...kept, grain: false };
  const [placed] = planOf([free], { stock }).groups[0].sheets[0].placements;
  assert.deepEqual([placed.length, placed.width, placed.turned], [900, 500, true]);
  const many = Array.from({ length: 30 }, (_, i) => board({ name: `P${i}`, length: 300 + i * 10, width: 120 + i }));
  for (const sheet of planOf(many, { stock: { 'pine:18': own(2400, 600) } }).groups[0].sheets) {
    assert.ok(sheet.placements.every((piece) => !piece.turned), 'a piece keeping its grain was turned');
  }
});

test('a piece bigger than its stock is reported, left out of the diagrams and counted', () => {
  const side = board({ name: 'Side', length: 3100, width: 244 });
  const shelf = board({ name: 'Shelf', length: 764, width: 244 });
  const plan = planOf([side, shelf]);
  const [group] = plan.groups;
  assert.deepEqual(group.misfits, [{ id: side.id, name: 'Side', length: 3100, width: 244, reason: 'big' }]);
  assert.deepEqual([group.stock.length, group.stock.width], [2400, 244]);
  assert.deepEqual(group.sheets.flatMap((sheet) => sheet.placements.map((piece) => piece.name)), ['Shelf']);
  assert.equal(plan.misfits, 1);
  const alone = planOf([side]);
  assert.equal(alone.boards, 0);
  assert.equal(alone.groups[0].sheets.length, 0);
});

test('offcuts worth keeping are listed with both sides at least 100', () => {
  const plan = planOf([board({ length: 764, width: 244 })], { stock: { 'pine:18': own(2400, 244) } });
  assert.deepEqual(plan.groups[0].sheets[0].offcuts, [{ x: 767, y: 0, length: 1633, width: 244 }]);
  const thin = planOf([board({ length: 2400, width: 150 })], { stock: { 'pine:18': own(2400, 244) } });
  assert.deepEqual(thin.groups[0].sheets[0].offcuts, []);
});

test('a hundred pieces nest soundly on sheets in well under a second, the same way every time', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const parts = Array.from({ length: 100 }, (_, i) =>
    makePart({
      name: `Piece ${i + 1}`,
      species: i % 3 ? 'birchPlywood' : 'mdf',
      thickness: 18,
      length: Math.round(100 + random() * 1100),
      width: Math.round(60 + random() * 500),
      grain: i % 2 === 0,
    }),
  );
  const started = performance.now();
  const plan = planOf(parts, { kerf: 4, trim: 5 });
  const took = performance.now() - started;
  assert.ok(took < 1000, `took ${took.toFixed(0)} ms`);
  assertSound(plan, { kerf: 4, trim: 5 });
  const placed = plan.groups.flatMap((group) => group.sheets.flatMap((sheet) => sheet.placements));
  assert.equal(placed.length, 100);
  assert.equal(new Set(placed.map((piece) => piece.id)).size, 100);
  const area = parts.reduce((sum, part) => sum + part.length * part.width, 0);
  assert.ok(plan.sheets <= Math.ceil(area / (2430 * 1210) / 0.8) + 2, `${plan.sheets} sheets for ${(area / 1e6).toFixed(1)} m²`);
  assert.deepEqual(planOf(parts, { kerf: 4, trim: 5 }), plan);
});

test('the example bookshelf needs one plywood sheet and three pine boards', () => {
  const plan = planOf(starterProject().parts);
  assert.deepEqual(plan.groups.map((group) => [group.key, group.kind, group.sheets.length]), [['birchPlywood:6', 'sheet', 1], ['pine:18', 'board', 3]]);
  assert.deepEqual([plan.sheets, plan.boards, plan.misfits], [1, 3, 0]);
  assert.deepEqual([plan.groups[1].stock.length, plan.groups[1].stock.width], [2400, 244]);
  assertSound(plan, { kerf: 3, trim: 0 });
  const stockArea = 2440 * 1220 + 3 * 2400 * 244;
  const pieces = 1000 * 800 + 2 * 1000 * 244 + 4 * 764 * 244;
  assert.equal(plan.waste.toFixed(4), ((stockArea - pieces) / stockArea).toFixed(4));
});

test('dowels are not laid out', () => {
  const plan = planOf([makeShape('dowel'), board({ length: 500, width: 100 })]);
  assert.deepEqual(plan.groups.map((group) => group.key), ['pine:18']);
});

test('sheets come first, then boards, each by wood name and then thickness', () => {
  const parts = [
    board({ species: 'walnut', thickness: 20 }),
    board({ species: 'oak', thickness: 25 }),
    board({ species: 'oak', thickness: 18 }),
    board({ species: 'mdf', thickness: 12 }),
    board({ species: 'birchPlywood', thickness: 18 }),
  ];
  assert.deepEqual(planOf(parts).groups.map((group) => group.key), ['birchPlywood:18', 'mdf:12', 'oak:18', 'oak:25', 'walnut:20']);
});

test('a board group defaults to the smallest preset every piece fits on; a sheet group to 2,440 × 1,220', () => {
  const size = (stock) => [stock.length, stock.width];
  const pieces = (...list) => list.map(([length, width, grain = true]) => ({ length, width, grain }));
  assert.deepEqual(size(defaultStock('board', pieces([100, 80]))), [2400, 94]);
  assert.deepEqual(size(defaultStock('board', pieces([764, 244], [1000, 244]))), [2400, 244]);
  assert.deepEqual(size(defaultStock('board', pieces([2600, 150]))), [3000, 194]);
  assert.deepEqual(size(defaultStock('board', pieces([1500, 300]))), [2000, 400]);
  assert.deepEqual(size(defaultStock('board', pieces([300, 1500]))), [2400, 244], 'nothing fits with the grain kept');
  assert.deepEqual(size(defaultStock('board', pieces([300, 1500, false]))), [2000, 400]);
  assert.deepEqual(size(defaultStock('board', pieces([5000, 100]))), [2400, 244]);
  assert.deepEqual(size(defaultStock('sheet', pieces([2600, 1500]))), [2440, 1220]);
});

test('a chosen stock size is used for its group only', () => {
  const parts = [board({ length: 764, width: 244 }), board({ species: 'oak', length: 764, width: 244 })];
  const plan = planOf(parts, { stock: { 'pine:18': own(3000, 244) } });
  const sizes = Object.fromEntries(plan.groups.map((group) => [group.key, [group.stock.length, group.stock.width, group.stock.own]]));
  assert.deepEqual(sizes, { 'oak:18': [2400, 244, false], 'pine:18': [3000, 244, true] });
});

test('identical layouts are told apart from the rest so they can be drawn once', () => {
  const parts = [
    ...Array.from({ length: 6 }, () => board({ name: 'Slat', length: 1100, width: 244 })),
    board({ name: 'Cleat', length: 300, width: 244 }),
  ];
  const [group] = planOf(parts).groups;
  assert.equal(group.sheets.length, 4);
  assert.deepEqual(group.runs.map((run) => [run.first, run.last, run.sheet.placements.length]), [[1, 3, 2], [4, 4, 1]]);
});

test('placements are numbered from the top-left, row by row', () => {
  const parts = Array.from({ length: 4 }, (_, i) => makePart({ name: `P${i}`, species: 'mdf', length: 1000, width: 500 }));
  const [sheet] = planOf(parts).groups[0].sheets;
  const ordered = [...sheet.placements].sort((a, b) => a.y - b.y || a.x - b.x);
  assert.deepEqual(ordered.map((piece) => piece.number), [1, 2, 3, 4]);
});

test('the fit check for the parts list matches the plan without laying anything out', () => {
  const side = board({ name: 'Side', length: 3100, width: 244 });
  const top = board({ name: 'Top', length: 600, width: 1300 });
  const shelf = board({ name: 'Shelf', length: 764, width: 244 });
  const pieces = piecesOf([side, top, shelf]);
  assert.deepEqual([...misfitIds(pieces, settings())].sort(), [side.id, top.id].sort());
  assert.deepEqual([...misfitIds(pieces, settings({ stock: { 'pine:18': own(4000, 1400) } }))], []);
});

test('saw settings and stock choices load from a file, with defaults when missing', () => {
  assert.deepEqual(cuttingFromFile(undefined), DEFAULT_CUTTING);
  const raw = { kerf: 2.5, trim: 10, stock: { 'pine:18': { length: 3000, width: 244, own: false }, 'oak:20': { length: 1234, width: 321, own: true } } };
  assert.deepEqual(cuttingFromFile(raw), raw);
  assert.throws(() => cuttingFromFile({ kerf: 11 }), /invalid saw kerf/);
  assert.throws(() => cuttingFromFile({ trim: -1 }), /invalid edge trim/);
  assert.throws(() => cuttingFromFile({ stock: { 'teak:18': { length: 2400, width: 244 } } }), /invalid stock size/);
  assert.throws(() => cuttingFromFile({ stock: { 'pine:18': { length: 99, width: 244 } } }), /invalid stock size/);
});

test('a project saves its cutting settings and grain ticks in format version 4 and older files still open', () => {
  const project = { ...starterProject(), cutting: { kerf: 4, trim: 5, stock: { 'pine:18': own(3000, 244) } } };
  project.parts[1] = { ...project.parts[1], grain: false };
  const text = serialize(project);
  assert.match(text, /"version": 4/);
  const loaded = parseProject(text);
  assert.deepEqual(loaded.cutting, project.cutting);
  assert.equal(loaded.parts[1].grain, false);
  assert.equal(loaded.parts[2].grain, true);
  const old = parseProject('{"format":"woodworking-planner","version":3,"parts":[{"species":"mdf"}],"joints":[]}');
  assert.deepEqual(old.cutting, DEFAULT_CUTTING);
  assert.equal(old.parts[0].grain, false);
});
