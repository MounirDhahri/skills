import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineStats } from './compute-line-stats.mjs';

test('counts added and deleted lines, ignoring the +++/--- file-header lines', () => {
  const diffText = [
    'diff --git a/foo.ts b/foo.ts',
    'index abc..def 100644',
    '--- a/foo.ts',
    '+++ b/foo.ts',
    '@@ -1,3 +1,4 @@',
    ' const a = 1;',
    '+const b = 2;',
    '+const c = 3;',
    '-const old = 0;',
    ' module.exports = { a };',
  ].join('\n');
  assert.deepEqual(computeLineStats(diffText), { added: 2, deleted: 1 });
});

test('returns zero counts for a diff with no hunk body (e.g. a pure rename)', () => {
  const diffText = [
    'diff --git a/renamed.ts b/renamed-new.ts',
    'similarity index 100%',
    'rename from renamed.ts',
    'rename to renamed-new.ts',
  ].join('\n');
  assert.deepEqual(computeLineStats(diffText), { added: 0, deleted: 0 });
});

test('returns zero counts for an empty string', () => {
  assert.deepEqual(computeLineStats(''), { added: 0, deleted: 0 });
});

test('counts a bare hunk body with no file header at all', () => {
  const diffText = '@@ -1,1 +1,2 @@\n-old\n+new one\n+new two';
  assert.deepEqual(computeLineStats(diffText), { added: 2, deleted: 1 });
});

test('counts a deleted line that happens to start with "---" (e.g. a YAML separator) instead of skipping it as a file header', () => {
  const diffText = '@@ -1,2 +1,1 @@\n----\n frontmatter';
  assert.deepEqual(computeLineStats(diffText), { added: 0, deleted: 1 });
});

test('counts an added line that happens to start with "+++" (e.g. "+++i;") instead of skipping it as a file header', () => {
  const diffText = '@@ -1,1 +1,2 @@\n counter\n+++i;';
  assert.deepEqual(computeLineStats(diffText), { added: 1, deleted: 0 });
});
