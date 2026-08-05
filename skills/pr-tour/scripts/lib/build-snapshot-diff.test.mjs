import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotDiffText } from './build-snapshot-diff.mjs';

test('groups hunks by file, preserving first-appearance order', () => {
  const snapshot = {
    hunks: [
      { path: 'a.js', diffHeader: 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js', diffText: '@@ -1,1 +1,1 @@\n-old a\n+new a' },
      { path: 'b.js', diffHeader: 'diff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js', diffText: '@@ -1,1 +1,1 @@\n-old b\n+new b' },
      { path: 'a.js', diffHeader: 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js', diffText: '@@ -10,1 +10,1 @@\n-old a2\n+new a2' },
    ],
  };

  const result = buildSnapshotDiffText(snapshot);

  const aHeaderIndex = result.indexOf('diff --git a/a.js b/a.js');
  const aHunk2Index = result.indexOf('@@ -10,1 +10,1 @@');
  const bHeaderIndex = result.indexOf('diff --git a/b.js b/b.js');

  assert.ok(aHeaderIndex !== -1 && aHunk2Index !== -1 && bHeaderIndex !== -1);
  assert.ok(aHeaderIndex < aHunk2Index, 'a.js header must precede its second hunk');
  assert.ok(aHunk2Index < bHeaderIndex, 'both a.js hunks must be grouped together, before b.js');
  assert.equal(result.match(/diff --git a\/a\.js/g).length, 1, 'a.js header must appear exactly once');
});

test('single-file snapshot round-trips cleanly', () => {
  const snapshot = {
    hunks: [
      { path: 'only.js', diffHeader: 'diff --git a/only.js b/only.js\n--- a/only.js\n+++ b/only.js', diffText: '@@ -1,1 +1,1 @@\n-x\n+y' },
    ],
  };
  const result = buildSnapshotDiffText(snapshot);
  assert.equal(
    result,
    'diff --git a/only.js b/only.js\n--- a/only.js\n+++ b/only.js\n@@ -1,1 +1,1 @@\n-x\n+y',
  );
});
