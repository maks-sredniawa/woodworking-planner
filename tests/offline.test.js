import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = new URL('../docs/app/', import.meta.url).pathname;

function appFiles(dir = APP) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? appFiles(path) : [relative(APP, path)];
  });
}

test('the offline copy holds every file the app is made of', () => {
  const worker = readFileSync(join(APP, 'sw.js'), 'utf8');
  const cached = JSON.parse(worker.match(/const FILES = (\[[^\]]*\]);/)[1].replaceAll("'", '"'));
  const wanted = appFiles().filter((file) => file !== 'sw.js');
  assert.deepEqual([...cached].filter((file) => file !== '.').sort(), wanted.sort());
  assert.ok(cached.includes('.'), 'the start page itself is cached');
});

test('the manifest makes the app installable from its own folder', () => {
  const manifest = JSON.parse(readFileSync(join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, '.');
  assert.equal(manifest.scope, '.');
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), sizes.join());
  for (const icon of manifest.icons) assert.ok(appFiles().includes(icon.src), icon.src);
});
