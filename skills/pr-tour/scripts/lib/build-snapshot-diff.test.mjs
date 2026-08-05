import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupHunksByFile } from './build-snapshot-diff.mjs';

test('groups hunks by file, preserving first-appearance order, header once per file', () => {
  const hunks = [
    { path: 'a.js', status: 'modified', diffHeader: 'diff --git a/a.js b/a.js', diffText: '@@ -1,1 +1,1 @@\n-old a\n+new a' },
    { path: 'b.js', status: 'added', diffHeader: 'diff --git a/b.js b/b.js', diffText: '@@ -0,0 +1,1 @@\n+new b' },
    { path: 'a.js', status: 'modified', diffHeader: 'diff --git a/a.js b/a.js', diffText: '@@ -10,1 +10,1 @@\n-old a2\n+new a2' },
  ];

  const files = groupHunksByFile(hunks);

  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'a.js');
  assert.equal(files[0].status, 'modified');
  assert.equal(files[1].path, 'b.js');
  assert.equal(files[1].status, 'added');

  const aHeaderCount = (files[0].diffText.match(/diff --git a\/a\.js/g) || []).length;
  assert.equal(aHeaderCount, 1, 'a.js header must appear exactly once');
  assert.ok(files[0].diffText.includes('@@ -1,1 +1,1 @@'));
  assert.ok(files[0].diffText.includes('@@ -10,1 +10,1 @@'));
  assert.ok(
    files[0].diffText.indexOf('@@ -1,1 +1,1 @@') < files[0].diffText.indexOf('@@ -10,1 +10,1 @@'),
    'a.js hunks must stay in first-appearance order',
  );
});

test('single-file, single-hunk snapshot round-trips cleanly', () => {
  const hunks = [
    { path: 'only.js', status: 'modified', diffHeader: 'diff --git a/only.js b/only.js\n--- a/only.js\n+++ b/only.js', diffText: '@@ -1,1 +1,1 @@\n-x\n+y' },
  ];
  const files = groupHunksByFile(hunks);
  assert.equal(files.length, 1);
  assert.equal(
    files[0].diffText,
    'diff --git a/only.js b/only.js\n--- a/only.js\n+++ b/only.js\n@@ -1,1 +1,1 @@\n-x\n+y',
  );
});

test('threads oldPath through for a renamed file', () => {
  const hunks = [
    {
      path: 'renamed-new.js',
      oldPath: 'renamed-old.js',
      status: 'renamed',
      diffHeader: 'diff --git a/renamed-old.js b/renamed-new.js',
      diffText: '@@ -1,1 +1,1 @@\n-old\n+new',
    },
  ];
  const files = groupHunksByFile(hunks);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'renamed-new.js');
  assert.equal(files[0].oldPath, 'renamed-old.js');
});

test('falls back to path as oldPath when oldPath is omitted (non-renamed file)', () => {
  const hunks = [
    { path: 'a.js', status: 'modified', diffHeader: 'diff --git a/a.js b/a.js', diffText: '@@ -1,1 +1,1 @@\n-old\n+new' },
  ];
  const files = groupHunksByFile(hunks);
  assert.equal(files[0].oldPath, 'a.js');
});

test('a zero-hunk file (e.g. a pure rename) is represented via a single empty-diffText hunk entry', () => {
  // groupHunksByFile only groups what it's given. SKILL.md's coverage rule
  // handles zero-hunk files (pure renames, binary files) by having the
  // agent add one hunk-shaped entry with diffText: "" for that file, which
  // groupHunksByFile then handles exactly like any other single-hunk file.
  const hunks = [
    {
      path: 'renamed.js',
      status: 'renamed',
      diffHeader: 'diff --git a/old.js b/renamed.js\nsimilarity index 100%\nrename from old.js\nrename to renamed.js',
      diffText: '',
    },
  ];
  const files = groupHunksByFile(hunks);
  assert.equal(files.length, 1);
  assert.equal(files[0].status, 'renamed');
  assert.ok(files[0].diffText.startsWith('diff --git a/old.js b/renamed.js'));
});
