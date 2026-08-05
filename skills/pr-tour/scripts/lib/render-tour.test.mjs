import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderTour } from '../render-tour.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tourData = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/sample-tour.json'), 'utf8'),
);
const singleChapterTourData = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/single-chapter-tour.json'), 'utf8'),
);

function extractTourData(html) {
  const match = html.match(/window\.__TOUR_DATA__ = (.*);/);
  assert.ok(match, 'expected a window.__TOUR_DATA__ assignment in the rendered HTML');
  return JSON.parse(match[1]);
}

test('renders a full HTML document with no network dependencies', () => {
  const html = renderTour(tourData);
  assert.match(html, /^<!doctype html>/);
  assert.ok(!/<script[^>]*\bsrc=/.test(html), 'no <script src=...> tags allowed');
  assert.ok(!/<link[^>]*\brel=["']?stylesheet/i.test(html), 'no <link stylesheet> tags allowed');
  assert.ok(
    !/@import\s+(url\(\s*)?["']?https?:\/\//i.test(html),
    'no @import of a remote stylesheet allowed',
  );
  assert.ok(!/url\(\s*['"]?https?:\/\//i.test(html), 'no url(http(s)://...) references allowed');
  assert.ok(!/\bfetch\(/.test(html), 'no fetch() calls allowed');
  assert.ok(!/XMLHttpRequest/.test(html), 'no XMLHttpRequest usage allowed');
  assert.ok(html.includes('Diff2HtmlUI'), 'diff2html bundle must be inlined');
  assert.ok(html.includes('hljs'), 'highlight.js bundle must be inlined');
});

test('embeds the tour title and PR url', () => {
  const html = renderTour(tourData);
  assert.ok(html.includes('Add scroll position tracking'));
  assert.ok(html.includes('https://github.com/artsy/metaphysics/pull/7623'));
});

test('embeds chapters, snapshots, and grouped diff text', () => {
  const html = renderTour(tourData);
  assert.ok(html.includes('Track scroll behavior'));
  assert.ok(html.includes('Settings defaults'));
  assert.ok(html.includes('toggleFileReviewed'));
});

test('leaves no unresolved placeholder markers', () => {
  const html = renderTour(tourData);
  assert.ok(!html.includes('__TITLE__'));
  assert.ok(!html.includes('__PR_URL__'));
  assert.ok(!html.includes('/*__DIFF2HTML_CSS__*/'));
  assert.ok(!html.includes('/*__TOUR_DATA__*/'));
});

test('does not corrupt diff text that happens to contain a placeholder-like literal', () => {
  const dataWithPlaceholderInDiff = {
    title: tourData.title,
    prUrl: tourData.prUrl,
    chapters: [
      {
        id: 'c1',
        title: 'Template edits',
        snapshots: [
          {
            id: 's1',
            title: 'Edit the tour template',
            prose: 'Touches the placeholder markers in the template file itself.',
            hunks: [
              {
                path: 'skills/pr-tour/assets/tour.template.html',
                status: 'modified',
                diffHeader: 'diff --git a/tour.template.html b/tour.template.html',
                diffText:
                  '@@ -1,3 +1,3 @@\n-<title>__TITLE__</title>\n+<title>__TITLE__ (updated)</title>\n See __PR_URL__ for details.',
              },
            ],
          },
        ],
      },
    ],
  };

  const html = renderTour(dataWithPlaceholderInDiff);
  assert.ok(
    html.includes('__TITLE__ (updated)') || html.includes('__TITLE__&lt;/title&gt;') || html.includes('__TITLE__'),
    'literal __TITLE__ from diff text must survive in the embedded tour data',
  );
  assert.ok(
    html.includes('__PR_URL__'),
    'literal __PR_URL__ from diff text must survive in the embedded tour data',
  );
});

test('renderTour throws a clear error when chapters is missing', () => {
  assert.throws(
    () => renderTour({ title: 'No chapters key', prUrl: 'https://example.com/pr/1' }),
    /tour data must contain at least one chapter/,
  );
});

test('renderTour throws a clear error when chapters is empty', () => {
  assert.throws(
    () => renderTour({ title: 'Empty chapters', prUrl: 'https://example.com/pr/1', chapters: [] }),
    /tour data must contain at least one chapter/,
  );
});

test('renderTour throws a clear error when a chapter has no snapshots', () => {
  assert.throws(
    () =>
      renderTour({
        title: 'Empty chapter',
        prUrl: 'https://example.com/pr/1',
        chapters: [{ id: 'c1', title: 'Empty', snapshots: [] }],
      }),
    /chapter "c1" must contain at least one snapshot/,
  );
});

test('renderTour throws a clear error when called with no arguments', () => {
  assert.throws(() => renderTour({}), /tour data must contain at least one chapter/);
});

test('renderTour throws a clear error when a snapshot has an empty hunks array', () => {
  assert.throws(
    () =>
      renderTour({
        title: 'Empty snapshot',
        prUrl: 'https://example.com/pr/1',
        chapters: [
          {
            id: 'c1',
            title: 'Chapter',
            snapshots: [{ id: 's1', title: 'Empty', prose: 'no hunks', hunks: [] }],
          },
        ],
      }),
    /snapshot "s1" in chapter "c1" must contain at least one hunk/,
  );
});

test('renderTour throws a clear error when a snapshot is missing hunks entirely', () => {
  assert.throws(
    () =>
      renderTour({
        title: 'Missing hunks key',
        prUrl: 'https://example.com/pr/1',
        chapters: [
          {
            id: 'c1',
            title: 'Chapter',
            snapshots: [{ id: 's1', title: 'No hunks key', prose: 'no hunks key' }],
          },
        ],
      }),
    /snapshot "s1" in chapter "c1" must contain at least one hunk/,
  );
});

test('threads a renamed file\'s oldPath through to the embedded per-file data', () => {
  const dataWithRename = {
    title: 'Rename example',
    prUrl: 'https://example.com/pr/1',
    chapters: [
      {
        id: 'c1',
        title: 'Renames',
        snapshots: [
          {
            id: 's1',
            title: 'Rename a file',
            prose: 'Renames old.js to new.js with no content change.',
            hunks: [
              {
                path: 'new.js',
                oldPath: 'old.js',
                status: 'renamed',
                diffHeader:
                  'diff --git a/old.js b/new.js\nsimilarity index 100%\nrename from old.js\nrename to new.js',
                diffText: '',
              },
            ],
          },
        ],
      },
    ],
  };

  const html = renderTour(dataWithRename);
  const embedded = extractTourData(html);
  const file = embedded.chapters[0].snapshots[0].files[0];
  assert.equal(file.path, 'new.js');
  assert.equal(file.oldPath, 'old.js');
  assert.equal(file.status, 'renamed');
});

test('preserves a title containing literal $-replacement patterns', () => {
  const dataWithDollarTitle = { ...tourData, title: "a$&b$`c" };
  const html = renderTour(dataWithDollarTitle);
  assert.ok(
    html.includes('a$&amp;b$`c'),
    'title with literal $-patterns must survive escaped but unmangled',
  );
});

test('computes per-file, per-snapshot, per-chapter, and total added/deleted line stats', () => {
  const html = renderTour(tourData);
  const embedded = extractTourData(html);

  assert.equal(embedded.chapters.length, 2);

  const firstChapter = embedded.chapters[0];
  const firstSnapshot = firstChapter.snapshots[0];
  const firstFile = firstSnapshot.files[0];

  assert.deepEqual(firstFile.stats, { added: 1, deleted: 0 });
  assert.deepEqual(firstSnapshot.stats, { added: 1, deleted: 0 });
  assert.deepEqual(firstChapter.stats, { added: 1, deleted: 0 });
  assert.deepEqual(embedded.chapters[1].stats, { added: 1, deleted: 0 });
  assert.deepEqual(embedded.total, { added: 2, deleted: 0 });
});

test('preserves file status, path, and fileCount per snapshot', () => {
  const html = renderTour(tourData);
  const embedded = extractTourData(html);
  const snapshot = embedded.chapters[0].snapshots[0];
  assert.equal(snapshot.fileCount, 1);
  assert.equal(snapshot.files[0].path, 'src/client/App.tsx');
  assert.equal(snapshot.files[0].status, 'modified');
});

test('renders correctly with a single chapter (fallback case) and a null icon when omitted', () => {
  const html = renderTour(singleChapterTourData);
  const embedded = extractTourData(html);
  assert.equal(embedded.chapters.length, 1);
  assert.equal(embedded.chapters[0].title, 'Everything');
  assert.equal(embedded.chapters[0].icon, null);
  assert.ok(html.includes('Fix typo in README'));
});
