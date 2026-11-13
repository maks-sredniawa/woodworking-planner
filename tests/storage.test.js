import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, starterProject } from '../docs/app/src/project.js';
import { fileName, loadSaved } from '../docs/app/src/storage.js';

const KEY = 'woodworking-planner:project';
const UNREADABLE_KEY = 'woodworking-planner:unreadable-project';

function fakeStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  return store;
}

test('file names drop accents and spell out letters that have no accent to drop', () => {
  assert.equal(fileName({ name: 'Półka' }), 'polka.woodplan.json');
  assert.equal(fileName({ name: 'ŁÓDŹ' }), 'lodz.woodplan.json');
  assert.equal(fileName({ name: 'Bord på føtter' }), 'bord-pa-fotter.woodplan.json');
  assert.equal(fileName({ name: 'Đồ gỗ' }), 'do-go.woodplan.json');
  assert.equal(fileName({ name: 'Großes Regal' }), 'grosses-regal.woodplan.json');
  assert.equal(fileName({ name: 'Café crème' }), 'cafe-creme.woodplan.json');
  assert.equal(fileName({ name: '書棚' }), 'project.woodplan.json');
});

test('a readable save loads, and an empty browser loads nothing', () => {
  fakeStorage({ [KEY]: serialize(starterProject()) });
  const loaded = loadSaved();
  assert.equal(loaded.error, null);
  assert.equal(loaded.project.name, 'Small bookshelf');
  fakeStorage();
  assert.deepEqual(loadSaved(), { project: null, error: null });
});

test('an unreadable save is reported and kept, not dropped', () => {
  const text = '{"format":"woodworking-planner","version":99,"parts":[]}';
  const store = fakeStorage({ [KEY]: text });
  const loaded = loadSaved();
  assert.equal(loaded.project, null);
  assert.match(loaded.error, /newer version/);
  assert.equal(store.get(KEY), text);
  assert.equal(store.get(UNREADABLE_KEY), text);
});

test('an unreadable save says whether its copy was kept', () => {
  const text = '{"format":"woodworking-planner","version":99,"parts":[]}';
  fakeStorage({ [KEY]: text });
  assert.equal(loadSaved().kept, true);
  const store = fakeStorage({ [KEY]: text });
  globalThis.localStorage.setItem = () => {
    throw new Error('full');
  };
  const loaded = loadSaved();
  assert.equal(loaded.kept, false);
  assert.match(loaded.error, /newer version/);
  assert.equal(store.get(KEY), text);
});
