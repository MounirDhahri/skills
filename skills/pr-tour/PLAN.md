# pr-tour UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the `pr-tour` skill's rendered HTML to match Codiff's walkthrough UI — chapters (themes) grouping snapshots, a top phase-progress bar, per-file/snapshot/chapter/total added-deleted line stats, per-file status badges and a session-only Viewed checkbox, and header branding (title linking to the PR, a small mark). This is the v1 skill (already shipped, `skills/pr-tour/` on `main`) getting a UI rework — no new input source, no publishing step, same offline-only render contract.

**Architecture:** The tour JSON's shape changes from a flat `snapshots[]` array to `chapters[].snapshots[]` (mirroring Codiff's own schema — see `DESIGN.md`'s "v2 revision" note). `render-tour.mjs` computes line stats server-side (new pure function, unit-tested) and groups each snapshot's hunks into per-file records (refactored pure function) before embedding everything as `window.__TOUR_DATA__`. The template and `app.js` are rewritten to render the new chrome: phase bar (hidden when there's only one chapter), grouped sidebar with stat badges, and one `Diff2HtmlUI` instance per file (not per snapshot) so each file gets its own header row with a status badge, stats, and a Viewed checkbox.

**Tech Stack:** Same as v1 — plain Node.js (`.mjs`), `node:test` + `node:assert/strict`, vendored `diff2html`/`highlight.js` (already vendored, untouched by this plan), `gh` CLI.

## Global Constraints

- Tour JSON schema changes from `{ title, prUrl, snapshots[] }` to `{ title, prUrl, chapters[].snapshots[] }` — this is a breaking change to the schema, not an additive one. No backward-compat shim: this skill has no external consumers besides its own docs/fixtures, which this plan updates. (Spec: "Data model", `DESIGN.md`)
- If the agent doesn't find natural themes, it emits exactly one chapter wrapping every snapshot. The renderer must detect `chapters.length === 1` and suppress the phase bar and chapter headers, falling back to the v1 flat look. (Spec: "Single-chapter fallback")
- Line stats (`added`/`deleted` counts) are computed in `render-tour.mjs` (Node), never in `app.js` (browser) — the browser must not re-parse diff text to derive a number it could get wrong. (Spec: "Line stats")
- No "Open in editor" control on file cards — there is no local editor to open into from a static, possibly-shared HTML file. (Spec: "Explicitly out of scope for v1")
- The "Viewed" checkbox is session-only: no persistence across reloads, consistent with the existing "no save/resume progress" scope call. (Spec: "Explicitly out of scope for v1")
- Header branding is a static, non-fetched mark (emoji or inline SVG) — never fetch the PR's repo/org avatar; that would reintroduce a network dependency at render time. (Spec: "Explicitly out of scope for v1")
- Every hunk in the PR's diff must still land in exactly one snapshot, and every snapshot in exactly one chapter — no "leave it out" bucket, unchanged from v1. (Spec: "Data model")

---

## File Structure

```
skills/pr-tour/
  scripts/
    lib/
      compute-line-stats.mjs          — NEW: pure function, counts +/- lines in a diff string
      compute-line-stats.test.mjs     — NEW
      build-snapshot-diff.mjs         — REWRITE: buildSnapshotDiffText -> groupHunksByFile (per-file, not per-snapshot-merged)
      build-snapshot-diff.test.mjs    — REWRITE
    render-tour.mjs                   — REWRITE: consumes chapters[], computes stats, builds enriched embed data
    lib/render-tour.test.mjs          — REWRITE
    fixtures/
      sample-tour.json                — REWRITE: wrap into 2 chapters (multi-chapter case)
      single-chapter-tour.json        — NEW: 1 chapter, no icon (fallback case)
  assets/
    tour.template.html                — REWRITE: phase bar, grouped sidebar, file-card markup, header branding
    app.js                            — REWRITE: chapter-aware sidebar/phase-bar, per-file Diff2HtmlUI instances, Viewed checkbox
  SKILL.md                            — REWRITE: chapters+icon in the authored JSON schema, workflow step 3 groups into chapters
  README.md                           — UPDATE: mention chapters/stats/branding in the feature list
```

`groupHunksByFile` (renamed from `buildSnapshotDiffText`'s old role) is now the *only* export of `build-snapshot-diff.mjs` — the old flat "one combined diff string per snapshot" output is no longer used anywhere: v2's `app.js` renders one `Diff2HtmlUI` instance per file, not one per snapshot, so nothing needs the old merged-string shape. Removing it outright (rather than keeping both) avoids dead code kept alive only by its own tests.

---

## Task 1: Line-stats pure function

**Files:**
- Create: `skills/pr-tour/scripts/lib/compute-line-stats.mjs`
- Create: `skills/pr-tour/scripts/lib/compute-line-stats.test.mjs`

**Interfaces:**
- Produces: `computeLineStats(diffText: string) -> { added: number, deleted: number }`. Counts lines starting with `+` or `-`, explicitly skipping the `+++`/`---` file-header lines (which also start with those characters but aren't content changes). Works on either a single hunk's text or a full per-file diff string (header + hunks) — the header's `diff --git`/`index`/`--- a/...`/`+++ b/...` lines never match `+`/`-` except the two explicitly-skipped ones. Consumed by Task 3's `render-tour.mjs`.

- [ ] **Step 1: Write the failing test**

Create `skills/pr-tour/scripts/lib/compute-line-stats.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd skills/pr-tour && node --test scripts/lib/compute-line-stats.test.mjs
```

Expected: FAIL — `compute-line-stats.mjs` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Write the implementation**

Create `skills/pr-tour/scripts/lib/compute-line-stats.mjs`:

```js
export function computeLineStats(diffText) {
  let added = 0;
  let deleted = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }

  return { added, deleted };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd skills/pr-tour && node --test scripts/lib/compute-line-stats.test.mjs
```

Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-tour/scripts/lib/compute-line-stats.mjs skills/pr-tour/scripts/lib/compute-line-stats.test.mjs
git commit -m "Add computeLineStats for pr-tour UI v2"
```

---

## Task 2: Rewrite build-snapshot-diff.mjs to group per-file (not per-snapshot-merged)

**Files:**
- Modify: `skills/pr-tour/scripts/lib/build-snapshot-diff.mjs`
- Modify: `skills/pr-tour/scripts/lib/build-snapshot-diff.test.mjs`

**Interfaces:**
- Produces: `groupHunksByFile(hunks: Array<{ path, status, diffHeader, diffText }>) -> Array<{ path: string, status: string, diffText: string }>`. One entry per distinct `path`, in order of first appearance; each entry's `diffText` is that file's header followed by all its hunks joined with newlines (same reconstruction logic v1's `buildSnapshotDiffText` used, now returning per-file entries instead of one big joined string). Consumed by Task 3's `render-tour.mjs`, which calls it once per snapshot (`groupHunksByFile(snapshot.hunks)`) to get the per-file breakdown it needs for status badges and per-file stats.
- This replaces `buildSnapshotDiffText` entirely — that export is removed, not kept alongside. Nothing else in the codebase (checked: only `render-tour.mjs` imported it, and that import is being rewritten by Task 3) references the old name.

- [ ] **Step 1: Write the failing test**

Overwrite `skills/pr-tour/scripts/lib/build-snapshot-diff.test.mjs` with:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd skills/pr-tour && node --test scripts/lib/build-snapshot-diff.test.mjs
```

Expected: FAIL — `groupHunksByFile` is not exported yet (the old file still exports `buildSnapshotDiffText`).

- [ ] **Step 3: Write the implementation**

Overwrite `skills/pr-tour/scripts/lib/build-snapshot-diff.mjs` with:

```js
export function groupHunksByFile(hunks) {
  const order = [];
  const byPath = new Map();

  for (const hunk of hunks) {
    if (!byPath.has(hunk.path)) {
      byPath.set(hunk.path, {
        path: hunk.path,
        status: hunk.status,
        header: hunk.diffHeader,
        texts: [],
      });
      order.push(hunk.path);
    }
    byPath.get(hunk.path).texts.push(hunk.diffText);
  }

  return order.map((path) => {
    const entry = byPath.get(path);
    return {
      path: entry.path,
      status: entry.status,
      diffText: [entry.header, ...entry.texts].join('\n'),
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd skills/pr-tour && node --test scripts/lib/build-snapshot-diff.test.mjs
```

Expected: PASS, 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-tour/scripts/lib/build-snapshot-diff.mjs skills/pr-tour/scripts/lib/build-snapshot-diff.test.mjs
git commit -m "Rewrite build-snapshot-diff.mjs to group per-file for pr-tour UI v2"
```

---

## Task 3: Rewrite render-tour.mjs for chapters + stats, update fixtures

**Files:**
- Modify: `skills/pr-tour/scripts/render-tour.mjs`
- Modify: `skills/pr-tour/scripts/lib/render-tour.test.mjs`
- Modify: `skills/pr-tour/scripts/fixtures/sample-tour.json`
- Create: `skills/pr-tour/scripts/fixtures/single-chapter-tour.json`

**Interfaces:**
- Consumes: `groupHunksByFile` from Task 2 (`./lib/build-snapshot-diff.mjs`), `computeLineStats` from Task 1 (`./lib/compute-line-stats.mjs`).
- Produces: `renderTour(tourData: { title, prUrl, chapters: Array<{ id, title, icon?, snapshots: Array<{ id, title, prose, hunks: Array<{path,status,diffHeader,diffText}> }> }> }) -> string`. The embedded `window.__TOUR_DATA__` object now has this shape (consumed by Task 5's `app.js`):
  ```
  {
    title, prUrl,
    chapters: [
      {
        id, title, icon: string|null, stats: { added, deleted },
        snapshots: [
          {
            id, title, prose, fileCount: number, stats: { added, deleted },
            files: [ { path, status, diffText, stats: { added, deleted } } ]
          }
        ]
      }
    ],
    total: { added, deleted }
  }
  ```
- Validation errors (thrown, not silently handled): `chapters` missing/not-an-array/empty → `'tour data must contain at least one chapter'`. A chapter with missing/not-an-array/empty `snapshots` → `` `chapter "${id}" must contain at least one snapshot` `` (using `(unknown)` if the chapter has no `id`).

- [ ] **Step 1: Update the fixtures**

Overwrite `skills/pr-tour/scripts/fixtures/sample-tour.json` with (wraps the existing two snapshots into two chapters, and makes the `App.tsx` hunk contain one unambiguous added line so stats assertions in Step 2 have a fixed, known answer):

```json
{
  "title": "Add scroll position tracking",
  "prUrl": "https://github.com/artsy/metaphysics/pull/7623",
  "chapters": [
    {
      "id": "c1",
      "title": "Scroll tracking",
      "icon": "🖱️",
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
              "diffText": "@@ -308,6 +308,7 @@\n   diffScrollContainerRef,\n   setDiffData,\n });\n \n+const toggleFileReviewed = useCallback(() => {}, [])"
            }
          ]
        }
      ]
    },
    {
      "id": "c2",
      "title": "Settings",
      "icon": "⚙️",
      "snapshots": [
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
  ]
}
```

Create `skills/pr-tour/scripts/fixtures/single-chapter-tour.json` (tests the single-chapter fallback — one chapter, `icon` omitted):

```json
{
  "title": "Fix typo",
  "prUrl": "https://github.com/example/repo/pull/1",
  "chapters": [
    {
      "id": "c1",
      "title": "Everything",
      "snapshots": [
        {
          "id": "s1",
          "title": "Fix typo in README",
          "prose": "Corrects a spelling mistake.",
          "hunks": [
            {
              "path": "README.md",
              "status": "modified",
              "diffHeader": "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md",
              "diffText": "@@ -1,1 +1,1 @@\n-Helllo\n+Hello"
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Overwrite `skills/pr-tour/scripts/lib/render-tour.test.mjs` with:

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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd skills/pr-tour && node --test scripts/lib/render-tour.test.mjs
```

Expected: FAIL — `render-tour.mjs` still expects `tourData.snapshots` (a flat array), not `tourData.chapters`; the new tests either throw the old "at least one snapshot" error or fail assertions against `embedded.chapters`.

- [ ] **Step 4: Write the implementation**

Overwrite `skills/pr-tour/scripts/render-tour.mjs` with:

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupHunksByFile } from './lib/build-snapshot-diff.mjs';
import { computeLineStats } from './lib/compute-line-stats.mjs';

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

function sumStats(statsList) {
  return statsList.reduce(
    (acc, s) => ({ added: acc.added + s.added, deleted: acc.deleted + s.deleted }),
    { added: 0, deleted: 0 },
  );
}

function buildFile(hunkFile) {
  return {
    path: hunkFile.path,
    status: hunkFile.status,
    diffText: hunkFile.diffText,
    stats: computeLineStats(hunkFile.diffText),
  };
}

function buildSnapshot(snapshot) {
  const files = groupHunksByFile(snapshot.hunks).map(buildFile);
  return {
    id: snapshot.id,
    title: snapshot.title,
    prose: snapshot.prose,
    fileCount: files.length,
    files,
    stats: sumStats(files.map((f) => f.stats)),
  };
}

function buildChapter(chapter) {
  const snapshots = chapter.snapshots.map(buildSnapshot);
  return {
    id: chapter.id,
    title: chapter.title,
    icon: chapter.icon ?? null,
    snapshots,
    stats: sumStats(snapshots.map((s) => s.stats)),
  };
}

export function renderTour(tourData) {
  if (!Array.isArray(tourData?.chapters) || tourData.chapters.length === 0) {
    throw new Error('tour data must contain at least one chapter');
  }
  for (const chapter of tourData.chapters) {
    if (!Array.isArray(chapter?.snapshots) || chapter.snapshots.length === 0) {
      throw new Error(`chapter "${chapter?.id ?? '(unknown)'}" must contain at least one snapshot`);
    }
  }

  const template = readAsset('tour.template.html');

  const chapters = tourData.chapters.map(buildChapter);
  const total = sumStats(chapters.map((c) => c.stats));

  const dataJson = escapeForInlineScript(
    JSON.stringify({ title: tourData.title, prUrl: tourData.prUrl, chapters, total }),
  );

  // NOTE: replacement values are passed via a function (`() => value`), not
  // as the second argument directly. Vendored, minified assets can contain
  // "$&", "$`", "$'" etc., which String.replace() treats as special
  // replacement patterns when given as a plain string, silently corrupting
  // the output. A replacer function disables that interpretation.
  //
  // NOTE: the __TITLE__/__PR_URL__ global replaces MUST run before the
  // asset/tour-data inlining steps below. Those later steps inline
  // arbitrary diff text (via dataJson) and vendored JS/CSS into the
  // document. If a PR's own diff happens to contain the literal substring
  // "__TITLE__" or "__PR_URL__" (e.g. a PR touching this skill's template),
  // running the global replace AFTER inlining would silently corrupt that
  // diff text. Replacing the placeholders first means they only ever match
  // the literal placeholder markers in the template itself.
  return template
    .replace(/__TITLE__/g, () => escapeHtml(tourData.title))
    .replace(/__PR_URL__/g, () => escapeHtml(tourData.prUrl))
    .replace('/*__DIFF2HTML_CSS__*/', () => readAsset('diff2html.min.css'))
    .replace('/*__HLJS_CSS__*/', () => readAsset('github-dark.min.css'))
    .replace('/*__DIFF2HTML_JS__*/', () => readAsset('diff2html-ui-slim.min.js'))
    .replace('/*__HLJS_JS__*/', () => readAsset('highlight.min.js'))
    .replace('/*__APP_JS__*/', () => readAsset('app.js'))
    .replace('/*__TOUR_DATA__*/', () => `window.__TOUR_DATA__ = ${dataJson};`);
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

Expected: PASS, 13 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add skills/pr-tour/scripts/render-tour.mjs skills/pr-tour/scripts/lib/render-tour.test.mjs skills/pr-tour/scripts/fixtures/sample-tour.json skills/pr-tour/scripts/fixtures/single-chapter-tour.json
git commit -m "Rewrite render-tour.mjs for chapters + line stats (pr-tour UI v2)"
```

---

## Task 4: HTML template rewrite (phase bar, grouped sidebar, file cards, branding)

**Files:**
- Modify: `skills/pr-tour/assets/tour.template.html`

**Interfaces:**
- Produces: the same six comment placeholder markers as v1 (`/*__DIFF2HTML_CSS__*/`, `/*__HLJS_CSS__*/`, `/*__DIFF2HTML_JS__*/`, `/*__HLJS_JS__*/`, `/*__APP_JS__*/`, `/*__TOUR_DATA__*/`, each exactly once) plus `__TITLE__`/`__PR_URL__` (may repeat) — unchanged contract with `render-tour.mjs` (Task 3 already emits these exact literals).
- **New DOM id contract for Task 5's `app.js`** (this is the interface Task 5 must match exactly): `phase-bar` (container div, hidden via a `.hidden` class when there's one chapter), `sidebar-body` (container div `app.js` fills with chapter-group divs), `sidebar-footer` (container div for the grand total), `snapshot-title`, `snapshot-prose`, `diff-container`, `progress`, `prev-btn`, `next-btn`, `view-line`, `view-side`. The old `snapshot-list` id (an `<ol>`) is gone — replaced by `sidebar-body`, which `app.js` populates with its own `<ol>` elements per chapter.

- [ ] **Step 1: Overwrite the template**

Overwrite `skills/pr-tour/assets/tour.template.html` with:

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
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0d1117; color: #e6edf3; }
  .layout { display: flex; flex-direction: column; height: 100vh; }
  .phase-bar { display: flex; align-items: center; justify-content: center; padding: 14px 20px; border-bottom: 1px solid #30363d; background: #161b22; overflow-x: auto; }
  .phase-bar.hidden { display: none; }
  .phase-step { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .phase-step .dot { width: 26px; height: 26px; border-radius: 50%; background: #21262d; border: 1px solid #30363d; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #8b949e; }
  .phase-step.done .dot { background: #238636; border-color: #238636; color: #fff; }
  .phase-step.current .dot { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  .phase-step .label { font-size: 12px; color: #8b949e; white-space: nowrap; }
  .phase-step.current .label { color: #e6edf3; font-weight: 600; }
  .phase-line { width: 32px; height: 1px; background: #30363d; flex-shrink: 0; margin: 0 4px; }
  .body-row { flex: 1; display: flex; min-height: 0; }
  .sidebar { width: 280px; overflow-y: auto; border-right: 1px solid #30363d; background: #161b22; flex-shrink: 0; display: flex; flex-direction: column; }
  .sidebar-header { padding: 14px 16px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 8px; }
  .sidebar-header .mark { font-size: 18px; line-height: 1; }
  .sidebar-header a { color: #58a6ff; text-decoration: none; font-size: 13px; font-weight: 600; }
  .sidebar-body { flex: 1; overflow-y: auto; padding: 8px; }
  .chapter-group { margin-bottom: 4px; }
  .chapter-heading { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #8b949e; }
  .sidebar ol { list-style: none; margin: 0; padding: 0; }
  .sidebar li { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
  .sidebar li:hover { background: #21262d; }
  .sidebar li.active { background: rgba(31, 111, 235, 0.2); color: #58a6ff; font-weight: 600; }
  .sidebar li .meta { font-size: 11px; color: #8b949e; display: flex; gap: 8px; }
  .sidebar li.active .meta { color: #8ab4f8; }
  .stat-added { color: #3fb950; }
  .stat-deleted { color: #f85149; }
  .sidebar-footer { padding: 10px 16px; border-top: 1px solid #30363d; font-size: 12px; color: #8b949e; }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .prose-card { padding: 16px 20px; border-bottom: 1px solid #30363d; }
  .prose-card h2 { margin: 0 0 8px; font-size: 16px; }
  .prose-card p { margin: 0; color: #c9d1d9; line-height: 1.5; white-space: pre-wrap; }
  .toolbar { display: flex; gap: 8px; padding: 8px 20px; border-bottom: 1px solid #30363d; }
  .toolbar button { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .toolbar button.active { background: #1f6feb; border-color: #1f6feb; }
  .diff-container { flex: 1; overflow: auto; padding: 12px 20px; }
  .file-card { border: 1px solid #30363d; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .file-card.viewed { opacity: 0.55; }
  .file-card-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #161b22; border-bottom: 1px solid #30363d; font-size: 13px; }
  .file-card-header .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, monospace; }
  .status-badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 1px solid; text-transform: uppercase; flex-shrink: 0; }
  .status-badge.modified { color: #d29922; border-color: #d29922; }
  .status-badge.added { color: #3fb950; border-color: #3fb950; }
  .status-badge.deleted { color: #f85149; border-color: #f85149; }
  .status-badge.renamed { color: #58a6ff; border-color: #58a6ff; }
  .file-stats { font-size: 12px; white-space: nowrap; flex-shrink: 0; }
  .file-card-header label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #8b949e; white-space: nowrap; flex-shrink: 0; }
  .file-card-body { padding: 8px 12px; }
  .nav-bar { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid #30363d; background: #161b22; }
  .nav-bar button { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
  .nav-bar button:disabled { opacity: 0.4; cursor: default; }
  .nav-bar .progress { font-size: 13px; color: #8b949e; }
</style>
</head>
<body>
  <div class="layout">
    <div class="phase-bar" id="phase-bar"></div>
    <div class="body-row">
      <nav class="sidebar">
        <div class="sidebar-header">
          <span class="mark">🧭</span>
          <a href="__PR_URL__" target="_blank" rel="noopener">__TITLE__</a>
        </div>
        <div class="sidebar-body" id="sidebar-body"></div>
        <div class="sidebar-footer" id="sidebar-footer"></div>
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

- [ ] **Step 2: Verify placeholder markers are each present exactly once (and __TITLE__/__PR_URL__ present)**

```bash
cd skills/pr-tour
for marker in '/\*__DIFF2HTML_CSS__\*/' '/\*__HLJS_CSS__\*/' '/\*__DIFF2HTML_JS__\*/' '/\*__HLJS_JS__\*/' '/\*__APP_JS__\*/' '/\*__TOUR_DATA__\*/'; do
  count=$(grep -c "$marker" assets/tour.template.html)
  echo "$marker: $count"
done
grep -c '__TITLE__' assets/tour.template.html
grep -c '__PR_URL__' assets/tour.template.html
```

Expected: every comment marker prints `1`; `__TITLE__` and `__PR_URL__` each print `2` (title tag + sidebar link) and `1` (sidebar link href) respectively.

- [ ] **Step 3: Verify the new DOM id set is present**

```bash
cd skills/pr-tour
for id in phase-bar sidebar-body sidebar-footer snapshot-title snapshot-prose diff-container progress prev-btn next-btn view-line view-side; do
  count=$(grep -c "id=\"$id\"" assets/tour.template.html)
  echo "$id: $count"
done
```

Expected: every id prints `1`. (Task 5's `app.js` must reference exactly this set of ids — no more, no less.)

- [ ] **Step 4: Commit**

```bash
git add skills/pr-tour/assets/tour.template.html
git commit -m "Rewrite tour.template.html: phase bar, grouped sidebar, file cards, branding (pr-tour UI v2)"
```

---

## Task 5: Rewrite app.js (chapter-aware nav, per-file Diff2HtmlUI, Viewed checkbox)

**Files:**
- Modify: `skills/pr-tour/assets/app.js`

**Interfaces:**
- Consumes: `window.__TOUR_DATA__` in the shape Task 3's `renderTour` embeds (`{ title, prUrl, chapters: [...], total }`, see Task 3's Interfaces block for the exact shape) and the exact DOM ids Task 4's template defines (`phase-bar`, `sidebar-body`, `sidebar-footer`, `snapshot-title`, `snapshot-prose`, `diff-container`, `progress`, `prev-btn`, `next-btn`, `view-line`, `view-side`).
- No automated test — this is browser-only DOM code, exercised by Task 8's manual/live-browser verification, consistent with how v1's `app.js` was verified (no `node:test` coverage for it either, since `document`/`window` don't exist under Node).

- [ ] **Step 1: Overwrite app.js**

Overwrite `skills/pr-tour/assets/app.js` with:

```js
(function () {
  var data = window.__TOUR_DATA__;
  var state = { index: 0, format: 'line-by-line', viewed: {} };

  var flat = [];
  data.chapters.forEach(function (chapter, chapterIndex) {
    chapter.snapshots.forEach(function (snapshot) {
      flat.push({ chapterIndex: chapterIndex, snapshot: snapshot });
    });
  });

  var multiChapter = data.chapters.length > 1;

  var phaseBarEl = document.getElementById('phase-bar');
  var sidebarBodyEl = document.getElementById('sidebar-body');
  var sidebarFooterEl = document.getElementById('sidebar-footer');
  var titleEl = document.getElementById('snapshot-title');
  var proseEl = document.getElementById('snapshot-prose');
  var diffEl = document.getElementById('diff-container');
  var progressEl = document.getElementById('progress');
  var prevBtn = document.getElementById('prev-btn');
  var nextBtn = document.getElementById('next-btn');
  var lineBtn = document.getElementById('view-line');
  var sideBtn = document.getElementById('view-side');

  function formatStats(stats) {
    var parts = [];
    if (stats.added) parts.push('<span class="stat-added">+' + stats.added + '</span>');
    if (stats.deleted) parts.push('<span class="stat-deleted">-' + stats.deleted + '</span>');
    return parts.join(' ');
  }

  function buildPhaseBar() {
    if (!multiChapter) {
      phaseBarEl.classList.add('hidden');
      return;
    }
    phaseBarEl.innerHTML = '';
    data.chapters.forEach(function (chapter, i) {
      if (i > 0) {
        var line = document.createElement('div');
        line.className = 'phase-line';
        phaseBarEl.appendChild(line);
      }
      var step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.chapterIndex = String(i);

      var dot = document.createElement('div');
      dot.className = 'dot';
      dot.textContent = chapter.icon || String(i + 1);

      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = chapter.title;

      step.appendChild(dot);
      step.appendChild(label);
      phaseBarEl.appendChild(step);
    });
  }

  function updatePhaseBar(currentChapterIndex) {
    if (!multiChapter) return;
    Array.prototype.forEach.call(phaseBarEl.querySelectorAll('.phase-step'), function (step) {
      var i = Number(step.dataset.chapterIndex);
      step.classList.toggle('done', i < currentChapterIndex);
      step.classList.toggle('current', i === currentChapterIndex);
      var dot = step.querySelector('.dot');
      dot.textContent = i < currentChapterIndex ? '✓' : (data.chapters[i].icon || String(i + 1));
    });
  }

  function buildSidebar() {
    sidebarBodyEl.innerHTML = '';
    var flatIndex = 0;
    data.chapters.forEach(function (chapter) {
      var group = document.createElement('div');
      group.className = 'chapter-group';

      if (multiChapter) {
        var heading = document.createElement('div');
        heading.className = 'chapter-heading';
        heading.textContent = (chapter.icon ? chapter.icon + ' ' : '') + chapter.title;
        group.appendChild(heading);
      }

      var list = document.createElement('ol');
      chapter.snapshots.forEach(function (snapshot) {
        var currentFlatIndex = flatIndex;
        var li = document.createElement('li');
        li.dataset.flatIndex = String(currentFlatIndex);

        var titleDiv = document.createElement('div');
        titleDiv.textContent = (currentFlatIndex + 1) + '. ' + snapshot.title;

        var metaDiv = document.createElement('div');
        metaDiv.className = 'meta';
        metaDiv.innerHTML =
          '<span>' + snapshot.fileCount + ' file' + (snapshot.fileCount === 1 ? '' : 's') + '</span>' +
          '<span>' + formatStats(snapshot.stats) + '</span>';

        li.appendChild(titleDiv);
        li.appendChild(metaDiv);
        li.addEventListener('click', function () {
          state.index = currentFlatIndex;
          render();
        });
        list.appendChild(li);
        flatIndex += 1;
      });

      group.appendChild(list);
      sidebarBodyEl.appendChild(group);
    });
  }

  function buildSidebarFooter() {
    sidebarFooterEl.innerHTML = 'Total: ' + formatStats(data.total);
  }

  function renderFileCard(file, snapshotKey) {
    var card = document.createElement('div');
    card.className = 'file-card';
    var fileKey = snapshotKey + '::' + file.path;
    if (state.viewed[fileKey]) card.classList.add('viewed');

    var header = document.createElement('div');
    header.className = 'file-card-header';

    var path = document.createElement('span');
    path.className = 'path';
    path.textContent = file.path;

    var badge = document.createElement('span');
    badge.className = 'status-badge ' + file.status;
    badge.textContent = file.status;

    var stats = document.createElement('span');
    stats.className = 'file-stats';
    stats.innerHTML = formatStats(file.stats);

    var label = document.createElement('label');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(state.viewed[fileKey]);
    checkbox.addEventListener('change', function () {
      state.viewed[fileKey] = checkbox.checked;
      card.classList.toggle('viewed', checkbox.checked);
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode('Viewed'));

    header.appendChild(path);
    header.appendChild(badge);
    header.appendChild(stats);
    header.appendChild(label);

    var body = document.createElement('div');
    body.className = 'file-card-body';

    card.appendChild(header);
    card.appendChild(body);

    var ui = new window.Diff2HtmlUI(body, file.diffText, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: state.format,
      colorScheme: 'dark',
      highlight: true,
    });
    ui.draw();
    ui.highlightCode();

    return card;
  }

  function render() {
    var current = flat[state.index];
    var snapshot = current.snapshot;

    Array.prototype.forEach.call(sidebarBodyEl.querySelectorAll('li'), function (li) {
      li.classList.toggle('active', Number(li.dataset.flatIndex) === state.index);
    });

    updatePhaseBar(current.chapterIndex);

    titleEl.textContent = snapshot.title;
    proseEl.textContent = snapshot.prose;
    progressEl.textContent = (state.index + 1) + ' / ' + flat.length;
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === flat.length - 1;

    diffEl.innerHTML = '';
    var snapshotKey = current.chapterIndex + '::' + snapshot.id;
    snapshot.files.forEach(function (file) {
      diffEl.appendChild(renderFileCard(file, snapshotKey));
    });
  }

  function go(delta) {
    var next = state.index + delta;
    if (next < 0 || next >= flat.length) return;
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

  buildPhaseBar();
  buildSidebar();
  buildSidebarFooter();
  render();
})();
```

- [ ] **Step 2: Verify every getElementById call in app.js matches a template id**

```bash
cd skills/pr-tour
grep -o "getElementById('[a-z-]*')" assets/app.js | sort -u
```

Expected output (11 ids, matching Task 4's Step 3 list exactly):
```
getElementById('diff-container')
getElementById('next-btn')
getElementById('phase-bar')
getElementById('prev-btn')
getElementById('progress')
getElementById('sidebar-body')
getElementById('sidebar-footer')
getElementById('snapshot-prose')
getElementById('snapshot-title')
getElementById('view-line')
getElementById('view-side')
```

- [ ] **Step 3: Render the multi-chapter fixture and confirm the CLI succeeds**

```bash
cd skills/pr-tour
node scripts/render-tour.mjs --data scripts/fixtures/sample-tour.json --out /tmp/pr-tour-v2-multi.html
node scripts/render-tour.mjs --data scripts/fixtures/single-chapter-tour.json --out /tmp/pr-tour-v2-single.html
```

Expected: both commands print `Wrote tour to ...` with no errors. (Visual/interactive confirmation of the phase bar, stats, and Viewed checkbox happens in Task 8 — this step only confirms the render pipeline doesn't crash.)

- [ ] **Step 4: Commit**

```bash
git add skills/pr-tour/assets/app.js
git commit -m "Rewrite app.js for chapters, phase bar, per-file cards, and Viewed checkbox (pr-tour UI v2)"
```

---

## Task 6: Update SKILL.md for the chapters schema

**Files:**
- Modify: `skills/pr-tour/SKILL.md`

**Interfaces:**
- Produces: the tour JSON schema documented inline must match exactly what Task 3's `renderTour` consumes (`chapters[].snapshots[].hunks[]`, optional `icon` per chapter). This is the contract the agent authors against.

- [ ] **Step 1: Rewrite the workflow steps 3 and 5, and the Rules section**

In `skills/pr-tour/SKILL.md`, replace the `### 3. Group hunks into snapshots` section with:

```markdown
### 3. Group hunks into chapters, then snapshots within each chapter

Read the diff (and the PR body/description for intent) and propose an
ordered list of **chapters** — broad themes (e.g. "Core plumbing", "Type
tightening", "Docs & tooling") — each containing an ordered list of
**snapshots** grouped by review idea, the same judgment used by Codiff's
stop-grouping: don't make one snapshot per file, don't make one snapshot
per hunk for repeated mechanical changes, order by review leverage not
file path. Every hunk from every file must land in exactly one snapshot,
in exactly one chapter — there is no "leave it out" bucket. This includes
files with zero hunks (pure renames, binary files, mode-only changes):
they still need a snapshot slot, even with empty `diffText` — see the
coverage rule under Rules below.

If the diff doesn't split into distinct themes (a small, focused PR),
propose a single chapter containing every snapshot. The rendered tour
detects this and skips the chapter/phase-bar chrome entirely, showing a
flat list — there's no need to invent artificial themes for a small PR.

Optionally give each chapter a single emoji `icon` that fits its theme
(e.g. 🔧 for core plumbing, 📄 for docs). Omit it if nothing fits — the
renderer falls back to a plain number.
```

Replace the `### 4. Show the outline and get approval — hard checkpoint` section's example outline with:

```markdown
### 4. Show the outline and get approval — hard checkpoint

Present the proposed chapters and snapshots as plain text:

```
Chapter 1: <chapter title>
  1. <snapshot title> — <one-line summary> — files: <path>, <path>
  2. <snapshot title> — <one-line summary> — files: <path>
Chapter 2: <chapter title>
  3. <snapshot title> — <one-line summary> — files: <path>
...
```

(For a single-chapter tour, just the numbered snapshot list — no chapter
headers needed.)

Iterate with the user until they approve. **Do not render before this is
approved.**
```

Replace the `### 5. Write the tour JSON` section's JSON example with:

```markdown
### 5. Write the tour JSON

Write this exact shape to a temp file outside the repo (e.g.
`$TMPDIR/pr-tour-<id>.json`):

```json
{
  "title": "PR title",
  "prUrl": "https://github.com/owner/repo/pull/123",
  "chapters": [
    {
      "id": "c1",
      "title": "short chapter/theme title",
      "icon": "🔧",
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
  ]
}
```

`icon` is optional — omit the key entirely if no emoji fits the chapter's
theme. `diffHeader` and `diffText` must be copied verbatim from the parser
output in step 2 — do not hand-edit diff content, only choose which hunks
go in which snapshot, which snapshots go in which chapter, and write the
prose around them. File status badges and added/removed line counts are
computed automatically by the render script from `status` and `diffText`
— do not compute or include them yourself.
```

- [ ] **Step 2: Update the Rules section**

Replace the first bullet of the `## Rules` section (currently "Never render before the user has approved the snapshot outline (step 4).") with:

```markdown
- Never render before the user has approved the chapter/snapshot outline (step 4).
- A single-chapter tour is expected and fine for small, focused PRs — don't force artificial themes onto a diff that doesn't have them.
```

Leave the remaining Rules bullets (coverage rule, verbatim-copy rule, local-git-refs-out-of-scope, no-publishing-step) unchanged — they still apply exactly as written.

- [ ] **Step 3: Verify the workflow still runs against a real PR**

Reuse the same verification approach as v1's original Task 6: pick a real PR you have `gh` access to (e.g. `MounirDhahri/skills#1`, or the `metaphysics#7623` example already used for v1's end-to-end check), run steps 1–2's commands, and confirm the parser output still matches what step 5's JSON schema expects. This step doesn't need to build a full tour — just confirm the documented commands still work verbatim after the edits above (nothing in steps 1–2 changed, but re-verify since the file was edited).

- [ ] **Step 4: Commit**

```bash
git add skills/pr-tour/SKILL.md
git commit -m "Update SKILL.md for the chapters schema (pr-tour UI v2)"
```

---

## Task 7: Update README.md

**Files:**
- Modify: `skills/pr-tour/README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the feature description and "How it works" list**

Replace the top of `skills/pr-tour/README.md` (from the title through the "How it works" list) with:

```markdown
# PR Tour

Turn a GitHub pull request into a shareable, self-contained HTML "tour" —
hunks grouped into narrative snapshots (optionally grouped further into
themed chapters), with descriptions, difit-style diff highlighting,
per-file/snapshot/chapter/total added-deleted line stats, and Prev/Next
navigation.

Unlike GitHub's own comment-to-comment review flow, the output is a single
HTML file with zero network dependencies: open it straight from disk, or
share it as one attachment.

## How it works

1. Fetches the PR's diff with `gh pr diff`.
2. Groups the diff's hunks into narrative snapshots (by review idea, not
   file-by-file), optionally grouped further into themed chapters, and
   writes a short description for each snapshot.
3. Shows you the proposed outline and waits for your approval.
4. Renders the approved chapters/snapshots into one HTML file with
   `scripts/render-tour.mjs` — computing per-file, per-snapshot,
   per-chapter, and total line stats along the way. A single chapter falls
   back to a flat list with no phase bar; more than one chapter shows a
   top progress bar and grouped sidebar sections.

See `SKILL.md` for the full workflow and `DESIGN.md` for the design
rationale (including why this differs from the `guided-pr` and Codiff
approaches already available, and why chapter grouping came back in v2
after v1 deliberately left it out).
```

Leave "Running the tests" and "Scope (v1)" sections as-is — both still accurate (the test-run command is unchanged; the v1 scope exclusions all still hold in v2, per this plan's Global Constraints).

- [ ] **Step 2: Commit**

```bash
git add skills/pr-tour/README.md
git commit -m "Update README for pr-tour UI v2 (chapters, stats, branding)"
```

---

## Task 8: End-to-end verification

**Files:** none created — this is a verification pass over the UI v2 rework.

**Interfaces:** exercises the full pipeline (Tasks 1-6) against both the multi-chapter and single-chapter fixtures, live in a browser.

- [ ] **Step 1: Run all unit tests together**

```bash
cd skills/pr-tour && node --test scripts/lib/*.test.mjs
```

Expected: PASS, all suites (compute-line-stats, build-snapshot-diff, render-tour), 0 failures.

- [ ] **Step 2: Open the multi-chapter fixture in a real browser**

```bash
cd skills/pr-tour
node scripts/render-tour.mjs --data scripts/fixtures/sample-tour.json --out /tmp/pr-tour-v2-multi.html
open /tmp/pr-tour-v2-multi.html
```

Confirm: a phase bar with 2 steps appears at the top ("Scroll tracking", "Settings"), each with its emoji; sidebar shows 2 chapter-heading groups, each listing its snapshot with a file count and `+1` stat badge; sidebar footer shows `Total: +2`; the header shows the 🧭 mark and a title that links to `https://github.com/artsy/metaphysics/pull/7623`; clicking Next/Prev moves between snapshots and updates the phase-bar's current/done states; each file card shows a status badge (`modified`), a `+1` stat, and a Viewed checkbox that dims the card and stays checked until you reload.

- [ ] **Step 3: Open the single-chapter fixture and confirm the fallback**

```bash
cd skills/pr-tour
node scripts/render-tour.mjs --data scripts/fixtures/single-chapter-tour.json --out /tmp/pr-tour-v2-single.html
open /tmp/pr-tour-v2-single.html
```

Confirm: no phase bar is visible at all; the sidebar shows the single snapshot with no chapter-heading group above it (flat list, matching v1's look); the file card shows `+1 -1` (the README.md hunk has one added and one removed line).

- [ ] **Step 4: Check the browser console on both pages**

Using whatever browser tooling is available (e.g. chrome-devtools MCP tools, or the browser's own devtools), confirm zero console errors on both pages, and confirm `list_network_requests` (or equivalent) shows exactly one request — the file itself — proving the offline claim still holds after this rework.

- [ ] **Step 5: Fix anything broken, re-test, then stop**

If any check in Steps 2-4 fails, fix the relevant file from Tasks 1-6, re-run its unit test if it has one, and repeat this task's verification from Step 2. Do not consider the rework done until Steps 2-4 all pass clean.
