import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseUnifiedDiff } from './parse-diff.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleDiff = readFileSync(
  resolve(__dirname, '../fixtures/sample.diff'),
  'utf8',
);

test('parses a modified file with two hunks', () => {
  const files = parseUnifiedDiff(sampleDiff);
  const foo = files.find((f) => f.path === 'src/foo.js');
  assert.ok(foo, 'expected src/foo.js to be present');
  assert.equal(foo.status, 'modified');
  assert.equal(foo.oldPath, 'src/foo.js');
  assert.equal(foo.hunks.length, 2);
  assert.match(foo.hunks[0], /^@@ -1,3 \+1,4 @@/);
  assert.match(foo.hunks[1], /^@@ -10,2 \+11,3 @@/);
  assert.match(foo.header, /^diff --git a\/src\/foo\.js b\/src\/foo\.js/);
});

test('parses an added file', () => {
  const files = parseUnifiedDiff(sampleDiff);
  const added = files.find((f) => f.path === 'src/new.js');
  assert.ok(added);
  assert.equal(added.status, 'added');
  assert.equal(added.hunks.length, 1);
  assert.match(added.hunks[0], /export const x = 1;/);
});

test('parses a deleted file', () => {
  const files = parseUnifiedDiff(sampleDiff);
  const deleted = files.find((f) => f.path === 'src/old.js');
  assert.ok(deleted);
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.hunks.length, 1);
  assert.match(deleted.hunks[0], /export const z = 1;/);
});

test('returns exactly three files for the fixture', () => {
  const files = parseUnifiedDiff(sampleDiff);
  assert.equal(files.length, 3);
});
