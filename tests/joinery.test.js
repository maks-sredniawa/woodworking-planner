import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutList, legacyPose, makePart, makeShape, totals } from '../docs/app/src/model.js';
import { assemblyOverlaps, changeJoint, changePart, cutAllowances, hardwareList, hardwarePieces, jointProblem, joineryXray, joinParts, suggestedSizes, updateJoint } from '../docs/app/src/joints.js';

const leg = (fields = {}) => makePart({ name: 'Leg', length: 700, width: 45, thickness: 45, pose: legacyPose('yzx'), ...fields });
const rail = (fields = {}) => makePart({ name: 'Rail', length: 600, width: 80, thickness: 24, pose: legacyPose('xyz'), x: 45, y: 600, z: 10, ...fields });
const frame = () => {
  const left = leg();
  const right = leg({ x: 645 });
  const middle = rail();
  return { name: 'Frame', parts: [left, middle, right], joints: [] };
};
const named = (project, name) => project.parts.find((part) => part.name === name);

test('a mortise and tenon gives the tenon to the piece that meets the other with its end', () => {
  const project = frame();
  const picked = named(project, 'Leg');
  const { joint } = joinParts(project, 'tenon', picked.id, named(project, 'Rail').id);
  assert.equal(joint.part, named(project, 'Rail').id);
  assert.equal(joint.to, picked.id);
  assert.deepEqual(
    { length: joint.length, thickness: joint.thickness, width: joint.width, through: joint.through, glued: joint.glued },
    { length: 30, thickness: 8, width: 60, through: false, glued: true },
  );
});

const side = (fields = {}) => makePart({ name: 'Side', length: 1000, width: 244, thickness: 18, pose: legacyPose('yzx'), ...fields });
const shelf = (fields = {}) => makePart({ name: 'Shelf', length: 764, width: 244, thickness: 18, pose: legacyPose('xzy'), x: 18, y: 300, ...fields });
const case_ = () => ({ name: 'Case', parts: [side(), shelf(), side({ x: 782 })], joints: [] });

test('a dado houses the shelf end in a groove a third as deep as the side is thick', () => {
  const project = case_();
  const { joint } = joinParts(project, 'dado', project.parts[0].id, project.parts[1].id);
  assert.equal(joint.part, project.parts[1].id, 'the shelf goes in');
  assert.equal(joint.to, project.parts[0].id);
  assert.equal(joint.depth, 6);
  assert.equal(joint.glued, true);
});

test('dowels drill both pieces and size themselves by the thinner piece and the joint length', () => {
  const project = case_();
  const { joint } = joinParts(project, 'dowels', project.parts[0].id, project.parts[1].id);
  assert.equal(joint.part, project.parts[0].id, 'the picked piece stays first');
  assert.deepEqual([joint.count, joint.diameter, joint.length, joint.glued], [4, 8, 40, true]);
  const thin = { name: 'Thin', parts: [side({ thickness: 12 }), shelf({ x: 12, thickness: 12, width: 100 })], joints: [] };
  const small = joinParts(thin, 'dowels', thin.parts[0].id, thin.parts[1].id).joint;
  assert.deepEqual([small.count, small.diameter, small.length], [2, 6, 30]);
});

test('face to face pieces can be doweled but not housed or tenoned, and only a board gets a tenon', () => {
  const lower = makePart({ name: 'Lower', length: 600, width: 200, thickness: 18, pose: legacyPose('xzy') });
  const upper = makePart({ name: 'Upper', length: 600, width: 200, thickness: 18, pose: legacyPose('xzy'), y: 18 });
  const stack = { name: 'Stack', parts: [lower, upper], joints: [] };
  assert.equal(
    joinParts(stack, 'tenon', lower.id, upper.id).error,
    'A tenon needs the end of one piece against a face of the other, and these lie face to face.',
  );
  assert.equal(
    joinParts(stack, 'dado', lower.id, upper.id).error,
    'A dado needs the end or edge of one piece against a face of the other, and these lie face to face.',
  );
  const glued = joinParts(stack, 'dowels', lower.id, upper.id).joint;
  assert.equal(glued.length, 20, 'short enough for two 18 thick pieces');

  const disc = { ...makeShape('disc'), name: 'Disc', pose: legacyPose('yxz'), diameter: 400, thickness: 18, x: 18 };
  const post = side({ name: 'Post' });
  const round = { name: 'Round', parts: [post, disc], joints: [] };
  assert.equal(joinParts(round, 'tenon', post.id, disc.id).error, 'Only a board can have a tenon. Disc is a disc.');
  assert.equal(joinParts(round, 'dado', post.id, disc.id).error, 'Only a board can sit in a dado. Disc is a disc.');
});


test('tenons and dados lengthen the piece that goes in, and the cut piece gets a note', () => {
  let project = frame();
  const [left, , right] = project.parts;
  project = joinParts(project, 'tenon', left.id, project.parts[1].id).project;
  project = joinParts(project, 'tenon', right.id, project.parts[1].id).project;
  const allowances = cutAllowances(project);
  assert.deepEqual(allowances.get(project.parts[1].id), { length: 60, width: 0, lengthItems: '2 × 30 tenons', widthItems: '', cuts: '' });
  assert.equal(allowances.get(left.id).cuts, 'Mortise 30 deep');

  const through = updateJoint(project, project.joints[0].id, 'through', true);
  const mixed = cutAllowances(through);
  assert.equal(mixed.get(project.parts[1].id).lengthItems, 'a 45 tenon and a 30 tenon');
  assert.equal(mixed.get(left.id).cuts, 'Through mortise');

  let housed = case_();
  housed = joinParts(housed, 'dado', housed.parts[0].id, housed.parts[1].id).project;
  housed = joinParts(housed, 'dado', housed.parts[2].id, housed.parts[1].id).project;
  const back = makePart({ name: 'Back', length: 1000, width: 800, thickness: 6, pose: legacyPose('yxz'), z: -6 });
  housed = joinParts({ ...housed, parts: [...housed.parts, back] }, 'dado', back.id, housed.parts[1].id).project;
  const shelfCut = cutAllowances(housed).get(housed.parts[1].id);
  assert.deepEqual(shelfCut, { length: 12, width: 2, lengthItems: '2 × 6 for dados', widthItems: '2 for a dado', cuts: '' });
  assert.equal(cutAllowances(housed).get(back.id).cuts, 'Dado 18 × 2');
});

test('dowels add no length and drill a note on both pieces', () => {
  let project = case_();
  project = joinParts(project, 'dowels', project.parts[0].id, project.parts[1].id).project;
  project = joinParts(project, 'dowels', project.parts[2].id, project.parts[1].id).project;
  const allowances = cutAllowances(project);
  assert.deepEqual(allowances.get(project.parts[1].id), { length: 0, width: 0, lengthItems: '', widthItems: '', cuts: '8 dowel holes ⌀8' });
  assert.equal(allowances.get(project.parts[0].id).cuts, '4 dowel holes ⌀8');
});

test('the cut list and totals use the cut size, and only identical cuts share a row', () => {
  let project = case_();
  const plain = shelf({ name: 'Loose', y: 600 });
  project = { ...project, parts: [...project.parts, plain] };
  const before = totals(project.parts);
  project = joinParts(project, 'dado', project.parts[0].id, project.parts[1].id).project;
  project = joinParts(project, 'dado', project.parts[2].id, project.parts[1].id).project;
  const allowances = cutAllowances(project);
  const rows = cutList(project.parts, allowances).filter((row) => row.names.includes('Shelf') || row.names.includes('Loose'));
  assert.deepEqual(rows.map((row) => [row.names.join(), row.length, row.lengthItems]), [['Shelf', 776, '2 × 6 for dados'], ['Loose', 764, '']]);
  const after = totals(project.parts, allowances);
  const added = 12 * 244 * 18;
  assert.ok(Math.abs((after.volume - before.volume) * 1e9 - added) < 1e-3);
  assert.ok(Math.abs((after.area - before.area) * 1e6 - 12 * 244) < 1e-6);
  assert.ok(Math.abs(after.weight - before.weight - (added / 1e9) * 510) < 1e-9);
});

const tenoned = () => {
  const project = frame();
  return joinParts(project, 'tenon', project.parts[0].id, project.parts[1].id).project;
};

test('cut joint sizes are refused past what the pieces allow, naming the piece', () => {
  const project = tenoned();
  const id = project.joints[0].id;
  assert.deepEqual(changeJoint(project, id, 'length', '46'), { refused: 'invalid', reason: 'Enter a length up to 45, the depth of Leg there, or tick Through tenon.' });
  assert.ok(changeJoint(project, id, 'length', '45').project);
  assert.equal(changeJoint(project, id, 'thickness', '24').reason, 'Enter a thickness under 24, the thickness of Rail.');
  assert.equal(changeJoint(project, id, 'width', '81').reason, 'Enter a width up to 80, the width of Rail.');
  assert.ok(changeJoint(project, id, 'width', '80').project);

  const housed = case_();
  const dado = joinParts(housed, 'dado', housed.parts[0].id, housed.parts[1].id).project;
  assert.equal(changeJoint(dado, dado.joints[0].id, 'depth', '18').reason, 'Enter a depth under 18, the thickness of Side.');
  const doweled = joinParts(housed, 'dowels', housed.parts[0].id, housed.parts[1].id).project;
  assert.equal(changeJoint(doweled, doweled.joints[0].id, 'diameter', '18').reason, 'Enter a diameter under 18, the thickness of the thinner piece.');
  assert.deepEqual(changeJoint(doweled, doweled.joints[0].id, 'count', '0'), { refused: 'invalid' });
});

test('cut joints warn when they weaken a piece or no longer fit', () => {
  const project = tenoned();
  const id = project.joints[0].id;
  assert.equal(jointProblem(project, id), null);
  assert.equal(jointProblem(updateJoint(project, id, 'thickness', '13'), id), 'The tenon is thicker than half of Rail (12). That leaves thin shoulders.');
  const thinner = changePart(project, { ...project.parts[0], length: 700, thickness: 20 }).project;
  assert.match(jointProblem(thinner, id), /^Rail no longer touches Leg/);
  const shallow = changePart(project, { ...project.parts[0], width: 20 }).project;
  assert.equal(jointProblem(shallow, id), null, 'the leg is still 45 deep along the rail');

  const housed = case_();
  const dado = joinParts(housed, 'dado', housed.parts[0].id, housed.parts[1].id).project;
  assert.equal(jointProblem(updateJoint(dado, dado.joints[0].id, 'depth', '10'), dado.joints[0].id), 'The dado is deeper than half of Side (9). That weakens it.');
  const flat = { ...dado, parts: dado.parts.map((part, i) => (i === 1 ? { ...part, pose: legacyPose('yzx'), length: 244, width: 764, y: 300 } : part)) };
  assert.ok(jointProblem(flat, dado.joints[0].id));

  const lower = makePart({ name: 'Lower', length: 600, width: 200, thickness: 18, pose: legacyPose('xzy') });
  const upper = makePart({ name: 'Upper', length: 600, width: 200, thickness: 18, pose: legacyPose('xzy'), y: 18 });
  const stack = joinParts({ name: 'Stack', parts: [lower, upper], joints: [] }, 'dowels', lower.id, upper.id).project;
  assert.equal(jointProblem(updateJoint(stack, stack.joints[0].id, 'length', '60'), stack.joints[0].id), 'The dowels (60) are longer than the two holes can hold (24).');
});

test('suggested sizes keep the through and glued ticks', () => {
  let project = tenoned();
  const id = project.joints[0].id;
  project = updateJoint(updateJoint(updateJoint(project, id, 'through', true), id, 'glued', false), id, 'width', '30');
  const suggested = suggestedSizes(project, project.joints[0]);
  assert.deepEqual([suggested.through, suggested.glued, suggested.width], [true, false, 60]);
});

test('dowels are listed as dowel pins and glued cut joints as wood glue', () => {
  let project = case_();
  project = joinParts(project, 'dowels', project.parts[0].id, project.parts[1].id).project;
  project = joinParts(project, 'dado', project.parts[2].id, project.parts[1].id).project;
  assert.deepEqual(
    hardwareList(project).map(({ item, size, count, usedOn }) => [count, item, size, usedOn]),
    [
      [4, 'Dowel pin', [8, 40], ['Side – Shelf']],
      [null, 'Wood glue', null, ['Side – Shelf', 'Shelf – Side']],
    ],
  );
});

test('the tenon is drawn in the rail’s wood reaching into the leg, and traced when either piece is picked', () => {
  const project = tenoned();
  const [left, middle, right] = project.parts;
  const wood = hardwarePieces(project).filter((piece) => piece.type === 'wood');
  assert.deepEqual(wood.map(({ owner, species, min, max }) => ({ owner, species, min, max })), [
    { owner: middle.id, species: 'pine', min: [15, 610, 18], max: [45, 670, 26] },
  ]);
  assert.deepEqual(joineryXray(project, left.id), [{ type: 'box', owner: middle.id, min: [15, 610, 18], max: [45, 670, 26] }]);
  assert.deepEqual(joineryXray(project, middle.id), joineryXray(project, left.id));
  assert.deepEqual(joineryXray(project, right.id), []);
  assert.deepEqual(assemblyOverlaps(project), [], 'pieces in a cut joint do not overlap');
});

test('a dado draws the housed end and traces the groove right across the side', () => {
  const housed = case_();
  const project = joinParts(housed, 'dado', housed.parts[0].id, housed.parts[1].id).project;
  const [wood] = hardwarePieces(project).filter((piece) => piece.type === 'wood');
  assert.deepEqual([wood.min, wood.max], [[12, 300, 0], [18, 318, 244]]);
  assert.deepEqual(joineryXray(project, project.parts[1].id), [{ type: 'box', owner: project.parts[0].id, min: [12, 300, 0], max: [18, 318, 244] }]);
});

test('dowels are traced as cylinders across the joint line and are not drawn otherwise', () => {
  const housed = case_();
  const project = joinParts(housed, 'dowels', housed.parts[0].id, housed.parts[1].id).project;
  assert.deepEqual(hardwarePieces(project), []);
  const traced = joineryXray(project, project.parts[0].id);
  assert.equal(traced.length, 4);
  assert.ok(traced.every((piece) => piece.type === 'dowel' && piece.radius === 4));
  const [first] = traced;
  assert.deepEqual([first.from[0], first.to[0]], [6, 46], 'the side takes what its 18 can hold (12), the shelf the rest');
  assert.ok(traced.every((piece) => piece.from[1] === 309 && piece.to[1] === 309));
});
