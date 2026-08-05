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
  assert.ok(!html.includes('http://') || html.includes('__PR_URL__') === false, 'no stray placeholder left');
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
