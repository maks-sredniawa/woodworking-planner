import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutList, legacyPose, makePart, makeShape, totals, updatePart } from '../docs/app/src/model.js';
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

test('the housing piece must offer a face: end to end and edge into end grain are refused', () => {
  const first = makePart({ name: 'First', length: 600, width: 80, thickness: 20, pose: legacyPose('xyz') });
  const second = makePart({ name: 'Second', length: 400, width: 80, thickness: 20, pose: legacyPose('xyz'), x: 600 });
  const butted = { name: 'Butted', parts: [first, second], joints: [] };
  assert.equal(joinParts(butted, 'tenon', first.id, second.id).error, 'A tenon needs the end of one piece against a face of the other, and these meet end to end.');
  assert.equal(joinParts(butted, 'dado', first.id, second.id).error, 'A dado needs the end or edge of one piece against a face of the other, and these meet end to end.');

  const stile = makePart({ name: 'Stile', length: 700, width: 60, thickness: 20, pose: legacyPose('yxz') });
  const crossRail = makePart({ name: 'Rail', length: 400, width: 80, thickness: 20, pose: legacyPose('xyz'), x: 60, y: 300 });
  const door = { name: 'Door', parts: [stile, crossRail], joints: [] };
  assert.equal(
    joinParts(door, 'dado', stile.id, crossRail.id).error,
    'A dado needs the end or edge of one piece against a face of the other, and Rail meets the edge of Stile with its end.',
  );
  const { joint } = joinParts(door, 'tenon', stile.id, crossRail.id);
  assert.deepEqual([joint.part, joint.to], [crossRail.id, stile.id], 'the rail’s end goes into the stile’s edge');
});

test('a cut joint on a piece switched away from Board is its own problem, adds no length and draws nothing', () => {
  const project = tenoned();
  const id = project.joints[0].id;
  const railId = project.joints[0].part;
  const rod = changePart(project, updatePart(named(project, 'Rail'), 'shape', 'dowel')).project;
  assert.equal(jointProblem(rod, id), 'Only a board can have a tenon. Rail is a dowel.');
  assert.equal(cutAllowances(rod).has(railId), false);
  assert.equal(cutList(rod.parts, cutAllowances(rod)).find((row) => row.names.includes('Rail')).length, 600);
  assert.deepEqual(hardwarePieces(rod), []);
  assert.deepEqual(joineryXray(rod, railId), []);

  const disc = changePart(project, { ...updatePart(named(project, 'Rail'), 'shape', 'disc'), diameter: 400 }).project;
  assert.match(jointProblem(disc, id), /^Rail no longer touches Leg/, 'a disc meets the leg along a line, not on a face');
  assert.equal(cutAllowances(disc).has(railId), false);
  assert.deepEqual(hardwarePieces(disc), []);

  const housed = case_();
  const dado = joinParts(housed, 'dado', housed.parts[0].id, housed.parts[1].id).project;
  const triangle = changePart(dado, updatePart(dado.parts[1], 'shape', 'triangle')).project;
  assert.equal(jointProblem(triangle, dado.joints[0].id), 'Only a board can sit in a dado. Shelf is a triangle.');
  assert.equal(cutAllowances(triangle).size, 0);
});

test('a free shape can house a cut joint but never goes in, even when its outline is still a rectangle', () => {
  const project = tenoned();
  const id = project.joints[0].id;
  const railId = project.joints[0].part;
  const free = changePart(project, updatePart(named(project, 'Rail'), 'shape', 'free')).project;
  assert.equal(jointProblem(free, id), 'Only a board can have a tenon. Rail is a free shape.');
  assert.equal(cutAllowances(free).has(railId), false);
  assert.equal(cutList(free.parts, cutAllowances(free)).find((row) => row.names.includes('Rail')).length, 600);
  assert.deepEqual(joineryXray(free, railId), []);
  const loose = { ...free, joints: [] };
  assert.equal(joinParts(loose, 'tenon', named(loose, 'Leg').id, railId).error, 'Only a board can have a tenon. Rail is a free shape.');

  const housed = case_();
  const freeSide = { ...housed, parts: housed.parts.map((part, i) => (i === 0 ? updatePart(part, 'shape', 'free') : part)) };
  const { project: dadoed, joint } = joinParts(freeSide, 'dado', freeSide.parts[0].id, freeSide.parts[1].id);
  assert.deepEqual([joint.part, joint.to, joint.depth], [freeSide.parts[1].id, freeSide.parts[0].id, 6]);
  assert.equal(cutAllowances(dadoed).get(freeSide.parts[0].id).cuts, 'Dado 18 × 6');
});

test('a tenon is sized by where the pieces meet and drawn inside the housing piece', () => {
  const left = leg();
  const high = rail({ y: 650 });
  const { project, joint } = joinParts({ name: 'High', parts: [left, high], joints: [] }, 'tenon', left.id, high.id);
  assert.equal(joint.width, 25, 'half of the 50 where the rail meets the leg');
  const [wood] = hardwarePieces(project).filter((piece) => piece.type === 'wood');
  assert.deepEqual([wood.min, wood.max], [[15, 662.5, 18], [45, 687.5, 26]]);
  assert.deepEqual(joineryXray(project, left.id), [{ type: 'box', owner: high.id, min: [15, 662.5, 18], max: [45, 687.5, 26] }]);
});

test('a tenon wider or thicker than where the pieces meet is suggested smaller, refused, flagged and drawn as wide as it is', () => {
  const left = leg();
  const top = rail({ y: 680 });
  const { project, joint } = joinParts({ name: 'Top', parts: [left, top], joints: [] }, 'tenon', left.id, top.id);
  assert.equal(joint.width, 10, 'half of the 20 where the rail meets the leg');
  assert.equal(jointProblem(project, joint.id), null);
  assert.equal(changeJoint(project, joint.id, 'width', '21').reason, 'Enter a width up to 20, where Rail meets Leg.');
  assert.ok(changeJoint(project, joint.id, 'width', '20').project);
  const wide = { ...project, joints: [{ ...joint, width: 60 }] };
  assert.equal(jointProblem(wide, joint.id), 'The tenon (60) is wider than where Rail meets Leg (20). Make it narrower.');
  assert.equal(suggestedSizes(wide, wide.joints[0]).width, 10);
  const [wood] = hardwarePieces(wide).filter((piece) => piece.type === 'wood');
  assert.deepEqual([wood.min, wood.max], [[15, 680, 18], [45, 740, 26]], 'the full 60 is drawn, kept on the rail’s end and out of the top of the leg');

  const out = rail({ z: 40 });
  const side = joinParts({ name: 'Out', parts: [left, out], joints: [] }, 'tenon', left.id, out.id);
  assert.equal(side.joint.thickness, 2.5, 'half of the 5 where the rail meets the leg');
  assert.equal(changeJoint(side.project, side.joint.id, 'thickness', '6').reason, 'Enter a thickness up to 5, where Rail meets Leg.');
  const thick = { ...side.project, joints: [{ ...side.joint, thickness: 8 }] };
  assert.equal(jointProblem(thick, side.joint.id), 'The tenon (8) is thicker than where Rail meets Leg (5). Make it thinner.');
});

test('a tenon on a rail with rounded corners is checked and drawn at the size it has', () => {
  const project = tenoned();
  const id = project.joints[0].id;
  const rounded = changePart(project, updatePart(updatePart(named(project, 'Rail'), 'corners', 'rounded'), 'cornerRadius', '20')).project;
  assert.equal(jointProblem(rounded, id), 'The tenon (60) is wider than where Rail meets Leg (40.6). Make it narrower.');
  const [wood] = hardwarePieces(rounded).filter((piece) => piece.type === 'wood');
  assert.deepEqual([wood.min, wood.max], [[15, 610, 18], [45, 670, 26]]);
  assert.equal(suggestedSizes(rounded, rounded.joints[0]).width, 20.3);
});

const triangle = (fields = {}) => ({ ...makeShape('triangle'), name: 'Triangle', length: 400, width: 400, thickness: 45, pose: legacyPose('xyz'), y: 600, ...fields });
const post = (fields = {}) => makePart({ name: 'Post', length: 600, width: 80, thickness: 24, pose: legacyPose('yxz'), x: 300, z: 10, ...fields });

test('a tenon into a triangle is sized, checked, listed and drawn by the wood at the joint, not the triangle’s box', () => {
  const housing = triangle();
  const tall = post();
  const { project, joint } = joinParts({ name: 'Slope', parts: [housing, tall], joints: [] }, 'tenon', housing.id, tall.id);
  assert.deepEqual([joint.part, joint.to, joint.length], [tall.id, housing.id, 10], 'two thirds of the 20 left at the slope');
  assert.equal(jointProblem(project, joint.id), null);
  assert.equal(changeJoint(project, joint.id, 'length', '21').reason, 'Enter a length up to 20, the depth of Triangle there, or tick Through tenon.');
  const long = { ...project, joints: [{ ...joint, length: 265 }] };
  assert.equal(jointProblem(long, joint.id), 'The tenon (265) is longer than Triangle is deep there (20). Shorten it or tick Through tenon.');
  assert.equal(cutAllowances(project).get(tall.id).length, 10);
  const through = updateJoint(project, joint.id, 'through', true);
  assert.equal(cutAllowances(through).get(tall.id).length, 20);
  const [wood] = hardwarePieces(project).filter((piece) => piece.type === 'wood');
  assert.deepEqual([wood.min, wood.max], [[310, 600, 18], [370, 610, 26]]);
});

test('dowels into a triangle drill no deeper than the wood at the joint', () => {
  const housing = triangle();
  const tall = post();
  const project = joinParts({ name: 'Slope', parts: [housing, tall], joints: [] }, 'dowels', tall.id, housing.id).project;
  const traced = joineryXray(project, housing.id);
  assert.equal(traced.length, 2);
  assert.ok(traced.every((piece) => piece.to[1] === 613), `two thirds of the 20 at the slope, got ${traced.map((piece) => piece.to[1])}`);
});

test('a dado groove across a triangle stops at its outline', () => {
  const housing = updatePart(side(), 'shape', 'triangle');
  const housed = shelf();
  const project = joinParts({ name: 'Slope', parts: [housing, housed], joints: [] }, 'dado', housing.id, housed.id).project;
  const [groove] = joineryXray(project, housed.id);
  const [end] = hardwarePieces(project).filter((piece) => piece.type === 'wood');
  const edgeAt = (y) => 244 * (1 - y / 1000);
  assert.deepEqual([groove.min, groove.max.slice(0, 2)], [[12, 300, 0], [18, 318]]);
  assert.ok(Math.abs(groove.max[2] - edgeAt(318)) < 0.5, `the groove stops at the slope, got ${groove.max[2]}`);
  assert.ok(end.max[2] <= groove.max[2] + 1e-9, 'the housed end stays inside the groove');
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
  const endOn = changePart(project, { ...project.parts[0], length: 45, width: 700, thickness: 45, pose: legacyPose('xyz') }).project;
  assert.equal(jointProblem(endOn, id), 'Leg no longer offers a face to Rail. Turn it back, or remove the joint.');

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

test('cut joints follow the true outline: shaped pieces in a joint never overlap, and a rail pushed into its leg still does', () => {
  const roundedShelf = shelf({ corners: 'rounded', cornerRadius: 50, cornerTopLeft: false, cornerTopRight: false });
  const housed = { name: 'Case', parts: [side(), roundedShelf, side({ x: 782 })], joints: [] };
  for (const kind of ['dado', 'dowels']) {
    const project = joinParts(housed, kind, housed.parts[0].id, roundedShelf.id).project;
    assert.deepEqual(assemblyOverlaps(project), [], `a ${kind} joint does not overlap`);
  }
  const dadoed = joinParts(housed, 'dado', housed.parts[0].id, roundedShelf.id).project;
  const [end] = hardwarePieces(dadoed).filter((piece) => piece.type === 'wood');
  assert.deepEqual([end.min, end.max.slice(0, 2)], [[12, 300, 0], [18, 318]]);
  assert.ok(end.max[2] >= 194 && end.max[2] < 195, `the housed end stops where the rounded corner leaves the side, got ${end.max[2]}`);

  const freeLeg = updatePart(leg(), 'shape', 'free');
  const railed = rail();
  const { project: framed, joint } = joinParts({ name: 'Free', parts: [freeLeg, railed], joints: [] }, 'tenon', freeLeg.id, railed.id);
  assert.deepEqual([joint.part, joint.to], [railed.id, freeLeg.id]);
  assert.equal(jointProblem(framed, joint.id), null);
  assert.deepEqual(assemblyOverlaps(framed), []);

  const project = tenoned();
  const [left, middle] = project.parts;
  const pushed = changePart(project, { ...middle, x: 40 }).project;
  assert.deepEqual(assemblyOverlaps(pushed), [[left.id, middle.id]]);
  assert.match(jointProblem(pushed, project.joints[0].id), /^Rail no longer touches Leg/);
});
