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
