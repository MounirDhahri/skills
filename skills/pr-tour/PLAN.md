# pr-tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `pr-tour` skill — an agent reads a GitHub PR, groups its diff into narrative snapshots with prose, and a deterministic Node script renders those into one self-contained, offline-capable HTML file with difit-style diff highlighting and Prev/Next navigation.

**Architecture:** Two independent halves. (1) A pure-function diff parser and snapshot-diff builder, each unit tested against fixture diff text with Node's built-in test runner — no LLM involved. (2) A render script that takes an authored JSON document plus vendored front-end assets and produces the final HTML — also fully deterministic and testable without a PR or an LLM in the loop. `SKILL.md` is the thin layer that tells the agent how to fetch a PR, author the JSON, and invoke the render script.

**Tech Stack:** Plain Node.js (`.mjs`, ES modules, no bundler, no `package.json`/`node_modules` needed to run), `node:test` + `node:assert/strict` for tests, `gh` CLI for PR access, vendored `diff2html` (UI-slim bundle) + `highlight.js` browser bundles for the front end (no CDN, no network at render or view time).

## Global Constraints

- v1 accepts a GitHub PR reference only (URL, `#N`, bare number, or current branch) — no local git ref/branch-only input. (Spec: "Input")
- No publishing/hosting step — the skill's job ends at writing the `.html` file locally. (Spec: "Explicitly out of scope for v1")
- Snapshot list is flat, not Codiff's two-level chapter/stop nesting. (Spec: "Data model")
- Every hunk in the PR's diff must land in exactly one snapshot — no "support" bucket to drop unassigned hunks into. (Spec: "Data model")
- The outline (snapshot titles + summaries) must be shown to the user as plain text and approved before rendering — hard checkpoint, no skipping. (Spec: "Workflow" step 4)
- The generated HTML must have zero network dependencies — every asset (diff2html, highlight.js, CSS, JS) is inlined at render time from vendored files, not fetched from a CDN. (Spec: "Rendering / UI")
- No save/resume-progress state in v1. (Spec: "Explicitly out of scope for v1")

---

## File Structure

```
skills/pr-tour/
  SKILL.md                       — agent-facing workflow instructions
  README.md                      — short human-facing description
  LICENSE                        — MIT, matches other skills in this repo
  DESIGN.md                      — already written (this plan implements it)
  PLAN.md                        — this file
  assets/
    diff2html.min.css            — vendored, diff2html 3.4.56
    diff2html-ui-slim.min.js     — vendored, diff2html 3.4.56 (UI logic, no bundled hljs)
    highlight.min.js             — vendored, @highlightjs/cdn-assets 11.11.1 (exposes global `hljs`)
    github-dark.min.css          — vendored, @highlightjs/cdn-assets 11.11.1 (token color theme)
    tour.template.html           — HTML shell with placeholder markers, filled in by render-tour.mjs
    app.js                       — client-side nav/render logic, inlined into the output HTML verbatim
  scripts/
    render-tour.mjs              — CLI entry point: reads a tour JSON, writes the final HTML
    lib/
      parse-diff.mjs             — parses `gh pr diff` output into per-file/per-hunk records
      parse-diff.test.mjs
      build-snapshot-diff.mjs    — reassembles a snapshot's hunks into a valid unified diff string
      build-snapshot-diff.test.mjs
      render-tour.test.mjs       — tests renderTour() directly (no subprocess)
    fixtures/
      sample.diff                — small multi-file unified diff used by parse-diff.test.mjs
      sample-tour.json           — small tour JSON used by render-tour.test.mjs
```

`parse-diff.mjs` is used by the **agent**, not by `render-tour.mjs` — the agent runs it (via a tiny CLI wrapper, added in Task 2) to get structured hunk data it can reason about and assign to snapshots. `render-tour.mjs` only consumes the already-authored tour JSON; it never re-parses a raw diff. This keeps the render step's input contract simple (plain JSON in, HTML out) and keeps the parser reusable/testable on its own.

---

## Task 1: Vendor diff2html + highlight.js browser assets

**Files:**
- Create: `skills/pr-tour/assets/diff2html.min.css`
- Create: `skills/pr-tour/assets/diff2html-ui-slim.min.js`
- Create: `skills/pr-tour/assets/highlight.min.js`
- Create: `skills/pr-tour/assets/github-dark.min.css`

**Interfaces:**
- Produces: four static asset files that Task 4/5 read verbatim and inline into the output HTML. `diff2html-ui-slim.min.js` is a UMD bundle that attaches `window.Diff2HtmlUI` (a class) when loaded as a plain `<script>` tag. `highlight.min.js` is a UMD bundle that attaches `window.hljs`. Neither depends on the other at load time, but `Diff2HtmlUI`'s `highlight: true` config option calls into `window.hljs` at draw time, so both must be loaded before `app.js` runs.

These are pinned, reproducible npm downloads — not a build step, just extraction. Versions are pinned so re-running this task later reproduces the same bytes.

- [ ] **Step 1: Download and extract diff2html 3.4.56**

```bash
mkdir -p /tmp/pr-tour-vendor && cd /tmp/pr-tour-vendor
npm pack diff2html@3.4.56
tar xf diff2html-3.4.56.tgz
```

- [ ] **Step 2: Download and extract @highlightjs/cdn-assets 11.11.1**

```bash
cd /tmp/pr-tour-vendor
npm pack @highlightjs/cdn-assets@11.11.1
tar xf highlightjs-cdn-assets-11.11.1.tgz -C hljs-extracted --one-top-level 2>/dev/null || (mkdir hljs-extracted && tar xf highlightjs-cdn-assets-11.11.1.tgz -C hljs-extracted)
```

- [ ] **Step 3: Copy the four files into the skill's assets directory**

```bash
mkdir -p skills/pr-tour/assets
cp /tmp/pr-tour-vendor/package/bundles/css/diff2html.min.css skills/pr-tour/assets/
cp /tmp/pr-tour-vendor/package/bundles/js/diff2html-ui-slim.min.js skills/pr-tour/assets/
cp /tmp/pr-tour-vendor/hljs-extracted/package/highlight.min.js skills/pr-tour/assets/
cp /tmp/pr-tour-vendor/hljs-extracted/package/styles/github-dark.min.css skills/pr-tour/assets/
```

- [ ] **Step 4: Verify the files landed and look right**

```bash
ls -la skills/pr-tour/assets/
head -c 120 skills/pr-tour/assets/diff2html-ui-slim.min.js
head -c 120 skills/pr-tour/assets/highlight.min.js
```

Expected: four files present; `diff2html-ui-slim.min.js` starts with a UMD wrapper (`!function(e,n){if("object"==typeof exports...`); `highlight.min.js` starts with the `/*! Highlight.js v11.11.1 ...` banner comment.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-tour/assets/
git commit -m "Vendor diff2html and highlight.js browser bundles for pr-tour"
```

---

## Task 2: Diff parser

**Files:**
- Create: `skills/pr-tour/scripts/lib/parse-diff.mjs`
- Create: `skills/pr-tour/scripts/lib/parse-diff.test.mjs`
- Create: `skills/pr-tour/scripts/fixtures/sample.diff`

**Interfaces:**
- Produces: `parseUnifiedDiff(diffText: string) -> Array<{ path: string, oldPath: string, status: 'added'|'deleted'|'modified'|'renamed', header: string, hunks: string[] }>`. `header` is the file's diff preamble (the `diff --git ...` line through the `+++ ...` line, verbatim). Each entry of `hunks` is one complete hunk's text, starting with its `@@ ... @@` line, verbatim from the source diff, trailing whitespace trimmed. This is what the agent runs (via Task 6's SKILL.md instructions, using a one-line `node -e` invocation or a tiny inline script) to turn `gh pr diff` output into structured data it can group into snapshots. It is also consumed directly by this task's own tests.

- [ ] **Step 1: Write the fixture diff**

Create `skills/pr-tour/scripts/fixtures/sample.diff` with this exact content:

```
diff --git a/src/foo.js b/src/foo.js
index abc123..def456 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 module.exports = { a };
 
@@ -10,2 +11,3 @@
 function foo() {}
+function bar() {}
diff --git a/src/new.js b/src/new.js
new file mode 100644
index 0000000..111222
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/src/old.js b/src/old.js
deleted file mode 100644
index 333444..0000000
--- a/src/old.js
+++ /dev/null
@@ -1,2 +0,0 @@
-export const z = 1;
-export const w = 2;
```

- [ ] **Step 2: Write the failing test**

Create `skills/pr-tour/scripts/lib/parse-diff.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd skills/pr-tour && node --test scripts/lib/parse-diff.test.mjs
```

Expected: FAIL — `parse-diff.mjs` does not exist yet (`Cannot find module`).

- [ ] **Step 4: Write the implementation**

Create `skills/pr-tour/scripts/lib/parse-diff.mjs`:

```js
export function parseUnifiedDiff(diffText) {
  const chunks = diffText.split(/(?=^diff --git )/m).filter((c) => c.trim().length > 0);
  return chunks.map(parseFileChunk);
}

function parseFileChunk(chunk) {
  const lines = chunk.split('\n');
  const hunkStart = lines.findIndex((line) => line.startsWith('@@ '));
  const headerLines = hunkStart === -1 ? lines : lines.slice(0, hunkStart);
  const header = headerLines.join('\n').trimEnd();

  const gitLine = headerLines.find((line) => line.startsWith('diff --git '));
  const gitMatch = gitLine ? gitLine.match(/^diff --git a\/(.+) b\/(.+)$/) : null;

  const minusLine = headerLines.find((line) => line.startsWith('--- '));
  const plusLine = headerLines.find((line) => line.startsWith('+++ '));

  const isAdded =
    headerLines.some((line) => line.startsWith('new file mode')) ||
    minusLine === '--- /dev/null';
  const isDeleted =
    headerLines.some((line) => line.startsWith('deleted file mode')) ||
    plusLine === '+++ /dev/null';
  const isRenamed = headerLines.some((line) => line.startsWith('rename from'));

  const status = isDeleted ? 'deleted' : isAdded ? 'added' : isRenamed ? 'renamed' : 'modified';

  const oldPath = minusLine && minusLine !== '--- /dev/null'
    ? minusLine.replace(/^--- a\//, '')
    : gitMatch?.[1] ?? null;
  const path = plusLine && plusLine !== '+++ /dev/null'
    ? plusLine.replace(/^\+\+\+ b\//, '')
    : oldPath;

  const hunks = [];
  if (hunkStart !== -1) {
    let current = [];
    for (const line of lines.slice(hunkStart)) {
      if (line.startsWith('@@ ') && current.length > 0) {
        hunks.push(current.join('\n').trimEnd());
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) hunks.push(current.join('\n').trimEnd());
  }

  return { path, oldPath, status, header, hunks };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd skills/pr-tour && node --test scripts/lib/parse-diff.test.mjs
```

Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add skills/pr-tour/scripts/lib/parse-diff.mjs skills/pr-tour/scripts/lib/parse-diff.test.mjs skills/pr-tour/scripts/fixtures/sample.diff
git commit -m "Add unified diff parser for pr-tour"
```

---

## Task 3: Snapshot diff-text builder

**Files:**
- Create: `skills/pr-tour/scripts/lib/build-snapshot-diff.mjs`
- Create: `skills/pr-tour/scripts/lib/build-snapshot-diff.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 2 directly (it operates on the tour JSON's hunk shape, not `parse-diff.mjs`'s output shape — see note below).
- Produces: `buildSnapshotDiffText(snapshot: { hunks: Array<{ path: string, diffHeader: string, diffText: string }> }) -> string`. Returns one valid unified-diff string covering every hunk in the snapshot, grouped by file (each file's header appears once, followed by that file's hunks in the order they appeared in `snapshot.hunks`), files in order of first appearance. Consumed by Task 5's `render-tour.mjs`.

Note on the two shapes: `parse-diff.mjs` (Task 2) produces `{ path, oldPath, status, header, hunks: string[] }` — one record per file, `hunks` a plain array. The **tour JSON** (what the agent authors and `render-tour.mjs` reads) is flatter: one record per **hunk**, each carrying its own `path`/`diffHeader`/`diffText` (see `SKILL.md`, Task 6, for the exact schema and why — it lets the agent assign individual hunks to snapshots without re-deriving which file they belonged to). This task's job is to go from that flat per-hunk list back to a valid per-file grouped diff string, for one snapshot at a time.

- [ ] **Step 1: Write the failing test**

Create `skills/pr-tour/scripts/lib/build-snapshot-diff.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd skills/pr-tour && node --test scripts/lib/build-snapshot-diff.test.mjs
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `skills/pr-tour/scripts/lib/build-snapshot-diff.mjs`:

```js
export function buildSnapshotDiffText(snapshot) {
  const order = [];
  const byPath = new Map();

  for (const hunk of snapshot.hunks) {
    if (!byPath.has(hunk.path)) {
      byPath.set(hunk.path, { header: hunk.diffHeader, texts: [] });
      order.push(hunk.path);
    }
    byPath.get(hunk.path).texts.push(hunk.diffText);
  }

  return order
    .map((path) => {
      const { header, texts } = byPath.get(path);
      return [header, ...texts].join('\n');
    })
    .join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd skills/pr-tour && node --test scripts/lib/build-snapshot-diff.test.mjs
```

Expected: PASS, 2 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-tour/scripts/lib/build-snapshot-diff.mjs skills/pr-tour/scripts/lib/build-snapshot-diff.test.mjs
git commit -m "Add snapshot diff-text builder for pr-tour"
```

---

## Task 4: HTML template + client app.js

**Files:**
- Create: `skills/pr-tour/assets/tour.template.html`
- Create: `skills/pr-tour/assets/app.js`

**Interfaces:**
- Produces: `tour.template.html` contains these exact placeholder markers, each appearing **exactly once**, which Task 5's `render-tour.mjs` replaces via literal string substitution (not regex, so no escaping concerns beyond exact match):
  - `/*__DIFF2HTML_CSS__*/`
  - `/*__HLJS_CSS__*/`
  - `/*__DIFF2HTML_JS__*/`
  - `/*__HLJS_JS__*/`
  - `/*__APP_JS__*/`
  - `/*__TOUR_DATA__*/`
  - `__TITLE__` (may appear more than once — replaced globally)
  - `__PR_URL__` (may appear more than once — replaced globally)
- Consumes (at runtime, in the browser): `window.__TOUR_DATA__` (shape: `{ title: string, prUrl: string, snapshots: Array<{ id: string, title: string, prose: string, diffText: string }> }`, set by the `/*__TOUR_DATA__*/` block), `window.Diff2HtmlUI` (from the inlined diff2html bundle), `window.hljs` (from the inlined highlight.js bundle). `app.js` expects these five DOM ids to exist, created by the template: `snapshot-list`, `snapshot-title`, `snapshot-prose`, `diff-container`, `progress`, `prev-btn`, `next-btn`, `view-line`, `view-side`.

- [ ] **Step 1: Create the template**

Create `skills/pr-tour/assets/tour.template.html`:

```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<title>__TITLE__ — PR Tour</title>
<style>
/*__DIFF2HTML_CSS__*/
</style>
<style>
/*__HLJS_CSS__*/
</style>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0d1117; color: #e6edf3; }
  .layout { display: flex; height: 100vh; }
  .sidebar { width: 260px; overflow-y: auto; border-right: 1px solid #30363d; background: #161b22; flex-shrink: 0; }
  .sidebar h1 { font-size: 14px; padding: 16px; margin: 0; border-bottom: 1px solid #30363d; }
  .sidebar h1 a { color: #58a6ff; text-decoration: none; }
  .sidebar ol { list-style: none; margin: 0; padding: 8px; }
  .sidebar li { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .sidebar li:hover { background: #21262d; }
  .sidebar li.active { background: rgba(31, 111, 235, 0.2); color: #58a6ff; font-weight: 600; }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .prose-card { padding: 16px 20px; border-bottom: 1px solid #30363d; }
  .prose-card h2 { margin: 0 0 8px; font-size: 16px; }
  .prose-card p { margin: 0; color: #c9d1d9; line-height: 1.5; white-space: pre-wrap; }
  .toolbar { display: flex; gap: 8px; padding: 8px 20px; border-bottom: 1px solid #30363d; }
  .toolbar button { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .toolbar button.active { background: #1f6feb; border-color: #1f6feb; }
  .diff-container { flex: 1; overflow: auto; padding: 12px 20px; }
  .nav-bar { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid #30363d; background: #161b22; }
  .nav-bar button { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
  .nav-bar button:disabled { opacity: 0.4; cursor: default; }
  .nav-bar .progress { font-size: 13px; color: #8b949e; }
</style>
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <h1><a href="__PR_URL__" target="_blank" rel="noopener">__TITLE__</a></h1>
      <ol id="snapshot-list"></ol>
    </nav>
    <div class="main">
      <div class="prose-card">
        <h2 id="snapshot-title"></h2>
        <p id="snapshot-prose"></p>
      </div>
      <div class="toolbar">
        <button id="view-line" class="active">Unified</button>
        <button id="view-side">Split</button>
      </div>
      <div class="diff-container" id="diff-container"></div>
      <div class="nav-bar">
        <button id="prev-btn">&larr; Prev</button>
        <span class="progress" id="progress"></span>
        <button id="next-btn">Next &rarr;</button>
      </div>
    </div>
  </div>
  <script>
/*__HLJS_JS__*/
  </script>
  <script>
/*__DIFF2HTML_JS__*/
  </script>
  <script>
/*__TOUR_DATA__*/
  </script>
  <script>
/*__APP_JS__*/
  </script>
</body>
</html>
```

- [ ] **Step 2: Create the client app**

Create `skills/pr-tour/assets/app.js`:

```js
(function () {
  var data = window.__TOUR_DATA__;
  var state = { index: 0, format: 'line-by-line' };

  var listEl = document.getElementById('snapshot-list');
  var titleEl = document.getElementById('snapshot-title');
  var proseEl = document.getElementById('snapshot-prose');
  var diffEl = document.getElementById('diff-container');
  var progressEl = document.getElementById('progress');
  var prevBtn = document.getElementById('prev-btn');
  var nextBtn = document.getElementById('next-btn');
  var lineBtn = document.getElementById('view-line');
  var sideBtn = document.getElementById('view-side');

  data.snapshots.forEach(function (snapshot, i) {
    var li = document.createElement('li');
    li.textContent = (i + 1) + '. ' + snapshot.title;
    li.addEventListener('click', function () {
      state.index = i;
      render();
    });
    listEl.appendChild(li);
  });

  function render() {
    var snapshot = data.snapshots[state.index];

    Array.prototype.forEach.call(listEl.children, function (li, i) {
      li.classList.toggle('active', i === state.index);
    });

    titleEl.textContent = snapshot.title;
    proseEl.textContent = snapshot.prose;
    progressEl.textContent = (state.index + 1) + ' / ' + data.snapshots.length;
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === data.snapshots.length - 1;

    diffEl.innerHTML = '';
    var ui = new window.Diff2HtmlUI(diffEl, snapshot.diffText, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: state.format,
      colorScheme: 'dark',
      highlight: true,
    });
    ui.draw();
    ui.highlightCode();
  }

  function go(delta) {
    var next = state.index + delta;
    if (next < 0 || next >= data.snapshots.length) return;
    state.index = next;
    render();
  }

  prevBtn.addEventListener('click', function () { go(-1); });
  nextBtn.addEventListener('click', function () { go(1); });

  lineBtn.addEventListener('click', function () {
    state.format = 'line-by-line';
    lineBtn.classList.add('active');
    sideBtn.classList.remove('active');
    render();
  });
  sideBtn.addEventListener('click', function () {
    state.format = 'side-by-side';
    sideBtn.classList.add('active');
    lineBtn.classList.remove('active');
    render();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });

  render();
})();
```

- [ ] **Step 3: Sanity-check the placeholder markers are each present exactly once**

```bash
cd skills/pr-tour
for marker in '/\*__DIFF2HTML_CSS__\*/' '/\*__HLJS_CSS__\*/' '/\*__DIFF2HTML_JS__\*/' '/\*__HLJS_JS__\*/' '/\*__APP_JS__\*/' '/\*__TOUR_DATA__\*/'; do
  count=$(grep -c "$marker" assets/tour.template.html)
  echo "$marker: $count"
done
```

Expected: every marker prints `1`.

- [ ] **Step 4: Commit**

```bash
git add skills/pr-tour/assets/tour.template.html skills/pr-tour/assets/app.js
git commit -m "Add HTML template and client-side nav app for pr-tour"
```

---

## Task 5: Render script

**Files:**
- Create: `skills/pr-tour/scripts/render-tour.mjs`
- Create: `skills/pr-tour/scripts/lib/render-tour.test.mjs`
- Create: `skills/pr-tour/scripts/fixtures/sample-tour.json`

**Interfaces:**
- Consumes: `buildSnapshotDiffText` from Task 3 (`../lib/build-snapshot-diff.mjs`); the five vendored assets and template from Task 1/4, read from `../assets/` relative to this script's own file location (not `process.cwd()`, so the script works regardless of where it's invoked from).
- Produces: `renderTour(tourData: { title: string, prUrl: string, snapshots: Array<{ id: string, title: string, prose: string, hunks: Array<{ path: string, status: string, diffHeader: string, diffText: string }> }> }) -> string` (the full HTML document as a string) — exported for direct testing. Also a CLI entry point: `node render-tour.mjs --data <tour.json> --out <output.html>`, used by `SKILL.md` (Task 6).

- [ ] **Step 1: Write the tour JSON fixture**

Create `skills/pr-tour/scripts/fixtures/sample-tour.json`:

```json
{
  "title": "Add scroll position tracking",
  "prUrl": "https://github.com/artsy/metaphysics/pull/7623",
  "snapshots": [
    {
      "id": "s1",
      "title": "Track scroll behavior",
      "prose": "Adds a scrollBehavior field to the diff scroll options and threads it through App.tsx.",
      "hunks": [
        {
          "path": "src/client/App.tsx",
          "status": "modified",
          "diffHeader": "diff --git a/src/client/App.tsx b/src/client/App.tsx\nindex abc123..def456 100644\n--- a/src/client/App.tsx\n+++ b/src/client/App.tsx",
          "diffText": "@@ -308,6 +308,7 @@\n   diffScrollContainerRef,\n   setDiffData,\n });\n \n const toggleFileReviewed = useCallback("
        }
      ]
    },
    {
      "id": "s2",
      "title": "Settings defaults",
      "prose": "Adds a default scrollAnimation setting alongside the existing appearance settings.",
      "hunks": [
        {
          "path": "src/client/components/SettingsModal.test.tsx",
          "status": "modified",
          "diffHeader": "diff --git a/src/client/components/SettingsModal.test.tsx b/src/client/components/SettingsModal.test.tsx\nindex 111..222 100644\n--- a/src/client/components/SettingsModal.test.tsx\n+++ b/src/client/components/SettingsModal.test.tsx",
          "diffText": "@@ -25,6 +25,7 @@\n   syntaxTheme: 'vsDark',\n   editor: 'cursor' as const,\n   colorVision: 'normal' as const,\n+  scrollAnimation: 'auto' as const,"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `skills/pr-tour/scripts/lib/render-tour.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd skills/pr-tour && node --test scripts/lib/render-tour.test.mjs
```

Expected: FAIL — `render-tour.mjs` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `skills/pr-tour/scripts/render-tour.mjs`:

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshotDiffText } from './lib/build-snapshot-diff.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '../assets');

function readAsset(name) {
  return readFileSync(resolve(ASSETS_DIR, name), 'utf8');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeForInlineScript(json) {
  return json.replace(/</g, '\\u003c');
}

export function renderTour(tourData) {
  const template = readAsset('tour.template.html');

  const snapshots = tourData.snapshots.map((s) => ({
    id: s.id,
    title: s.title,
    prose: s.prose,
    diffText: buildSnapshotDiffText(s),
  }));

  const dataJson = escapeForInlineScript(
    JSON.stringify({ title: tourData.title, prUrl: tourData.prUrl, snapshots }),
  );

  return template
    .replace('/*__DIFF2HTML_CSS__*/', readAsset('diff2html.min.css'))
    .replace('/*__HLJS_CSS__*/', readAsset('github-dark.min.css'))
    .replace('/*__DIFF2HTML_JS__*/', readAsset('diff2html-ui-slim.min.js'))
    .replace('/*__HLJS_JS__*/', readAsset('highlight.min.js'))
    .replace('/*__APP_JS__*/', readAsset('app.js'))
    .replace('/*__TOUR_DATA__*/', `window.__TOUR_DATA__ = ${dataJson};`)
    .replace(/__TITLE__/g, escapeHtml(tourData.title))
    .replace(/__PR_URL__/g, escapeHtml(tourData.prUrl));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--data') args.data = argv[i + 1];
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  if (!args.data || !args.out) {
    throw new Error('Usage: render-tour.mjs --data <tour.json> --out <output.html>');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tourData = JSON.parse(readFileSync(resolve(args.data), 'utf8'));
  const html = renderTour(tourData);
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log(`Wrote tour to ${outPath}`);
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd skills/pr-tour && node --test scripts/lib/render-tour.test.mjs
```

Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 6: Run the CLI end-to-end against the fixture and eyeball the output**

```bash
cd skills/pr-tour
node scripts/render-tour.mjs --data scripts/fixtures/sample-tour.json --out /tmp/pr-tour-sample.html
open /tmp/pr-tour-sample.html   # macOS; use xdg-open on Linux
```

Expected: a browser tab opens showing "Add scroll position tracking" with two snapshots in the sidebar, Prev/Next working, Unified/Split toggle working, syntax-highlighted diff text.

- [ ] **Step 7: Confirm it works fully offline**

Turn off Wi-Fi (or use the browser's offline dev-tools toggle), reload `/tmp/pr-tour-sample.html`. Expected: page still renders identically — this is the whole point of vendoring the assets.

- [ ] **Step 8: Commit**

```bash
git add skills/pr-tour/scripts/render-tour.mjs skills/pr-tour/scripts/lib/render-tour.test.mjs skills/pr-tour/scripts/fixtures/sample-tour.json
git commit -m "Add render-tour.mjs to generate self-contained PR tour HTML"
```

---

## Task 6: SKILL.md — agent-facing workflow

**Files:**
- Create: `skills/pr-tour/SKILL.md`

**Interfaces:**
- Consumes: `scripts/lib/parse-diff.mjs` (Task 2, invoked via a one-line `node -e` snippet to print structured JSON the agent then reads), `scripts/render-tour.mjs` (Task 5, invoked as the final CLI step).
- Produces: the tour JSON schema documented inline (this is the contract the agent must author to match what `render-tour.mjs` expects — path/status/diffHeader/diffText fields must match exactly what Task 5's `buildSnapshotDiffText` and `renderTour` read).

- [ ] **Step 1: Write the SKILL.md file**

Create `skills/pr-tour/SKILL.md`:

```markdown
---
name: pr-tour
description: Turn a GitHub pull request into a shareable, self-contained HTML "tour" — hunks grouped into narrative snapshots with descriptions, difit-style diff highlighting, and Prev/Next navigation. Use when the user wants to make a large or non-obvious PR easier to review, asks for a "PR tour", "guided walkthrough as HTML", "snapshot-by-snapshot review", or references a GitHub PR URL and wants it turned into a walkthrough document.
allowed-tools: Read Write Bash(gh:*) Bash(node:*) Bash(mkdir:*)
---

# PR Tour

Read a GitHub pull request, group its diff into narrative snapshots (not
one-per-file, not one-per-hunk — group by review idea), write a short
description for each, get the user's approval on the outline, then render
everything into one self-contained HTML file with `scripts/render-tour.mjs`.

The rendered file has zero network dependencies (diff2html and highlight.js
are vendored and inlined) — it can be opened straight from disk or shared as
a single attachment.

## Workflow

### 1. Resolve the PR

Accept a PR reference: full GitHub URL, `#N`, `pr:N`, bare number, or
"current branch". Resolve to `owner/repo` + PR number with `gh`:

```bash
gh pr view <ref> --json number,title,body,url,headRefOid,baseRefName,headRefName,files,headRepository
```

If no reference is given, default to the current branch's PR (same command
with no `<ref>`).

### 2. Fetch and parse the diff

```bash
gh pr diff <ref> > /tmp/pr-tour-<id>.diff
```

Parse it into structured per-file/per-hunk records with the bundled parser:

```bash
node --input-type=module -e "
import { parseUnifiedDiff } from '$(pwd)/skills/pr-tour/scripts/lib/parse-diff.mjs';
import { readFileSync } from 'node:fs';
const diff = readFileSync('/tmp/pr-tour-<id>.diff', 'utf8');
console.log(JSON.stringify(parseUnifiedDiff(diff), null, 2));
"
```

Read the result. Each entry is `{ path, oldPath, status, header, hunks: string[] }`
— `header` is that file's diff preamble, `hunks` are the individual `@@ ... @@`
blocks in file order.

### 3. Group hunks into snapshots

Read the diff (and the PR body/description for intent) and propose an
ordered list of snapshots. Group by review idea, the same judgment used by
Codiff's stop-grouping: don't make one snapshot per file, don't make one
snapshot per hunk for repeated mechanical changes, order by review leverage
not file path. Every hunk from every file must land in exactly one snapshot
— there is no "leave it out" bucket.

### 4. Show the outline and get approval — hard checkpoint

Present the proposed snapshots as plain text, one line each:

```
1. <title> — <one-line summary> — files: <path>, <path>
2. <title> — <one-line summary> — files: <path>
...
```

Iterate with the user until they approve. **Do not render before this is
approved.**

### 5. Write the tour JSON

Write this exact shape to a temp file outside the repo (e.g.
`$TMPDIR/pr-tour-<id>.json`):

```json
{
  "title": "PR title",
  "prUrl": "https://github.com/owner/repo/pull/123",
  "snapshots": [
    {
      "id": "s1",
      "title": "short snapshot title",
      "prose": "2-6 sentences: what changed here and why",
      "hunks": [
        {
          "path": "src/file.ts",
          "status": "modified",
          "diffHeader": "<that file's header from step 2, verbatim>",
          "diffText": "<one hunk's text from step 2, verbatim, including its @@ line>"
        }
      ]
    }
  ]
}
```

`diffHeader` and `diffText` must be copied verbatim from the parser output in
step 2 — do not hand-edit diff content, only choose which hunks go in which
snapshot and write the prose around them.

### 6. Render

```bash
node skills/pr-tour/scripts/render-tour.mjs --data $TMPDIR/pr-tour-<id>.json --out .pr-tour/<slug>.html
```

Pick `<slug>` as a short kebab-case name from the PR title.

### 7. Report the result

Tell the user the file path. Do not attempt to publish or host it — that is
explicitly out of scope for this skill.

## Rules

- Never render before the user has approved the snapshot outline (step 4).
- Every hunk in the diff must appear in exactly one snapshot — verify the
  count of hunks in your authored JSON matches the count the parser reported
  in step 2 before writing the file.
- Copy `diffHeader`/`diffText` verbatim from the parser output. Never
  hand-write or edit diff content — only group and describe it.
- Local git refs without an associated PR are out of scope for v1 — if the
  user wants that, say so rather than improvising a workaround.
- Do not add a publishing/hosting step, even if the Artifact tool is
  available in the session — this skill's job ends at the local `.html` file.
```

- [ ] **Step 2: Verify the workflow commands actually run**

With a real PR (or the current repo's own branch if it has an open PR),
manually run steps 1 and 2's commands and confirm `gh pr view`/`gh pr diff`
work and the `parse-diff.mjs` invocation prints valid JSON.

- [ ] **Step 3: Commit**

```bash
git add skills/pr-tour/SKILL.md
git commit -m "Add SKILL.md workflow for pr-tour"
```

---

## Task 7: README + LICENSE

**Files:**
- Create: `skills/pr-tour/README.md`
- Create: `skills/pr-tour/LICENSE`

**Interfaces:** none — these are documentation/licensing files, matching the convention already used by `skills/plain-english/` and `skills/agentsmd-claudemd-generator/`.

- [ ] **Step 1: Create the LICENSE**

Create `skills/pr-tour/LICENSE` (copy exactly, this is the same MIT text used elsewhere in this repo):

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create the README**

Create `skills/pr-tour/README.md`:

```markdown
# PR Tour

Turn a GitHub pull request into a shareable, self-contained HTML "tour" —
hunks grouped into narrative snapshots with descriptions, difit-style diff
highlighting, and Prev/Next navigation.

Unlike GitHub's own comment-to-comment review flow, the output is a single
HTML file with zero network dependencies: open it straight from disk, or
share it as one attachment.

## How it works

1. Fetches the PR's diff with `gh pr diff`.
2. Groups the diff's hunks into narrative snapshots (by review idea, not
   file-by-file) and writes a short description for each.
3. Shows you the proposed outline and waits for your approval.
4. Renders the approved snapshots into one HTML file with
   `scripts/render-tour.mjs`.

See `SKILL.md` for the full workflow and `DESIGN.md` for the design
rationale (including why this differs from the `guided-pr` and Codiff
approaches already available).

## Scope (v1)

- GitHub PR input only — no local git ref/branch-only input.
- No publishing/hosting step — the skill writes a local `.html` file, no more.
- No save/resume progress across sessions.
```

- [ ] **Step 3: Commit**

```bash
git add skills/pr-tour/README.md skills/pr-tour/LICENSE
git commit -m "Add README and LICENSE for pr-tour skill"
```

---

## Task 8: End-to-end manual verification against a real PR

**Files:** none created — this is a verification pass over the finished skill.

**Interfaces:** exercises the full pipeline (`SKILL.md`'s workflow, Tasks 1-6) against a real PR instead of fixtures.

- [ ] **Step 1: Run all unit tests together**

```bash
cd skills/pr-tour && node --test scripts/lib/
```

Expected: PASS, all suites (parse-diff, build-snapshot-diff, render-tour), 0 failures.

- [ ] **Step 2: Pick a real, moderately-sized open PR you have `gh` access to**

Use the current repo's own history if nothing else is available, e.g.
find a merged PR: `gh pr list --repo <owner>/<repo> --state merged --limit 5`.

- [ ] **Step 3: Walk through the SKILL.md workflow by hand**

Follow steps 1-6 from `skills/pr-tour/SKILL.md` yourself: fetch the diff,
run the parser, group 3-6 hunks into 2-3 snapshots, write the JSON, render.

- [ ] **Step 4: Open the result and check the golden path**

```bash
open .pr-tour/<slug>.html
```

Confirm: sidebar lists all snapshots; clicking a snapshot title in the
sidebar navigates to it; Prev/Next buttons work and disable at the ends;
Unified/Split toggle re-renders the diff; syntax highlighting is visible;
keyboard arrow keys navigate.

- [ ] **Step 5: Confirm offline behavior**

Disconnect from the network and reload the file. Confirm it renders
identically — no broken images, no missing styles, no console errors about
failed network requests (check the browser console).

- [ ] **Step 6: Fix anything broken, re-test, then stop**

If any step in 4 or 5 fails, fix the relevant file from Tasks 1-6, re-run
the affected unit test, and repeat this task's verification from Step 3.
Do not consider the skill done until Steps 4 and 5 both pass clean.
