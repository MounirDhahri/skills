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

test('embeds snapshot data with grouped diff text', () => {
  const html = renderTour(tourData);
  assert.ok(html.includes('Track scroll behavior'));
  assert.ok(html.includes('Settings defaults'));
  assert.ok(html.includes('diffScrollContainerRef'));
});

test('leaves no unresolved placeholder markers', () => {
  const html = renderTour(tourData);
  assert.ok(!html.includes('__TITLE__'));
  assert.ok(!html.includes('__PR_URL__'));
  assert.ok(!html.includes('/*__DIFF2HTML_CSS__*/'));
  assert.ok(!html.includes('/*__TOUR_DATA__*/'));
});

test('does not corrupt diff text that happens to contain a placeholder-like literal', () => {
  // Regression test: the __TITLE__/__PR_URL__ global replaces must run
  // BEFORE the tour data/assets are inlined, otherwise diff text from the
  // PR itself (e.g. a PR that edits this skill's own template) could
  // contain the literal substring "__TITLE__" or "__PR_URL__" and get
  // silently rewritten by the later global replace.
  const dataWithPlaceholderInDiff = {
    ...tourData,
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
            diffText: '@@ -1,3 +1,3 @@\n-<title>__TITLE__</title>\n+<title>__TITLE__ (updated)</title>\n See __PR_URL__ for details.',
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

test('renderTour throws a clear error when snapshots is missing', () => {
  assert.throws(
    () => renderTour({ title: 'No snapshots key', prUrl: 'https://example.com/pr/1' }),
    /tour data must contain at least one snapshot/,
  );
});

test('renderTour throws a clear error when snapshots is empty', () => {
  assert.throws(
    () => renderTour({ title: 'Empty snapshots', prUrl: 'https://example.com/pr/1', snapshots: [] }),
    /tour data must contain at least one snapshot/,
  );
});

test('renderTour throws a clear error when called with no arguments', () => {
  assert.throws(
    () => renderTour({}),
    /tour data must contain at least one snapshot/,
  );
});

test('preserves a title containing literal $-replacement patterns', () => {
  // Regression test for the Task 5 fix: String.prototype.replace() treats
  // "$&", "$`", "$'" specially when the replacement is a plain string.
  // Titles/URLs containing these literal sequences must survive verbatim.
  const dataWithDollarTitle = {
    ...tourData,
    title: "a$&b$`c",
  };
  const html = renderTour(dataWithDollarTitle);
  assert.ok(html.includes('a$&amp;b$`c'), 'title with literal $-patterns must survive escaped but unmangled');
});
