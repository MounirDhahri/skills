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

This skill is invoked from whatever project the PR under review lives in —
its own scripts do **not** live relative to that project's `cwd`. Before
running anything below, find this skill's own directory: it is the
directory that contains this `SKILL.md` file (typically something like
`~/.claude/skills/pr-tour`, but don't hard-code that — resolve it from
wherever this file actually is). Call that `$SKILL_DIR` in the commands
below (substitute the real absolute path — don't leave the literal string
`$SKILL_DIR` in the command you run).

```bash
gh pr diff <ref> > "$TMPDIR/pr-tour-<id>.diff"
```

Parse it into structured per-file/per-hunk records with the bundled parser,
using `$SKILL_DIR`'s absolute path (not a path relative to the current
project's `cwd`):

```bash
node --input-type=module -e "
import { parseUnifiedDiff } from '$SKILL_DIR/scripts/lib/parse-diff.mjs';
import { readFileSync } from 'node:fs';
const diff = readFileSync('$TMPDIR/pr-tour-<id>.diff', 'utf8');
console.log(JSON.stringify(parseUnifiedDiff(diff), null, 2));
"
```

Read the result. Each entry is `{ path, oldPath, status, header, hunks: string[] }`
— `header` is that file's diff preamble, `hunks` are the individual `@@ ... @@`
blocks in file order.

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

### 6. Render

Use the same `$SKILL_DIR` absolute path resolved in step 2, and write the
output somewhere that is guaranteed to be writable and not accidentally
committed to whatever project's repo you're touring a PR from — `$TMPDIR`
is the default; use a path the user explicitly asked for instead if they
gave one:

```bash
node "$SKILL_DIR/scripts/render-tour.mjs" --data "$TMPDIR/pr-tour-<id>.json" --out "$TMPDIR/pr-tour-<slug>.html"
```

Pick `<slug>` as a short kebab-case name from the PR title.

### 7. Report the result

Tell the user the file path. Do not attempt to publish or host it — that is
explicitly out of scope for this skill.

## Rules

- Never render before the user has approved the chapter/snapshot outline (step 4).
- A single-chapter tour is expected and fine for small, focused PRs — don't force artificial themes onto a diff that doesn't have them.
- Every **file** in the diff must be accounted for somewhere in the tour,
  not just every hunk. Most files have one or more hunks and are covered by
  checking that the count of hunks in your authored JSON matches the count
  the parser reported in step 2 — but a pure rename, a binary file, or a
  mode-only change can have `hunks: []` in the parser output, and a
  hunk-count check alone will not catch a file like that going missing.
  Before writing the file, walk the parser's output list and confirm every
  `path` appears in at least one snapshot's `hunks`. For a file with zero
  hunks, still add one entry for it to some snapshot with `diffText: ""`
  and `diffHeader` set to that file's `header` from the parser output —
  diff2html will still render the header/rename notice with no hunk body,
  so the file shows up in the tour instead of silently vanishing.
- Copy `diffHeader`/`diffText` verbatim from the parser output. Never
  hand-write or edit diff content — only group and describe it.
- Local git refs without an associated PR are out of scope for v1 — if the
  user wants that, say so rather than improvising a workaround.
- Do not add a publishing/hosting step, even if the Artifact tool is
  available in the session — this skill's job ends at the local `.html` file.
