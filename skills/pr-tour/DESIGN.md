# pr-tour skill — design

## Problem

Reviewing a large, non-obvious GitHub PR (e.g. [artsy/metaphysics#7623](https://github.com/artsy/metaphysics/pull/7623)) file-by-file loses the narrative. GitHub's own comment-to-comment navigation (as in the `guided-pr` skill) works but is slow and confined to GitHub's UI. This skill instead produces a **standalone, shareable HTML file**: the PR's hunks grouped into narrative "snapshots," each with a description and a difit-style highlighted diff, navigable with Prev/Next.

## Precedent in this environment

- **Codiff** (`~/.claude/skills/codiff`) already solves the "group hunks into a narrative with prose" problem with a JSON schema (`chapters[].stops[].hunkIds[]`, `prose`, `importance`). It requires the native Codiff app to view, and recomputes hunk IDs against a live diff — not shareable as a static file.
- **guided-pr** (`~/work/guided-pr-skill`) solves "narrative order + Prev/Next" by chaining inline GitHub review comments. It's GitHub-native and requires posting comments to the PR.
- **difit** (github.com/yoshiko-pg/difit) is the visual reference for diff highlighting (dark theme, file tree, split/unified toggle, Prism.js highlighting) but is a local Express server with **no static-export mode** (confirmed via its docs) — it can't be reused directly.

`pr-tour` borrows the narrative-grouping idea from Codiff and the review-checkpoint habit from guided-pr, and produces output that neither can: a single self-contained HTML file.

## Architecture

```
gh pr view/diff  →  parse into hunks  →  agent groups into snapshots + writes prose
                                              ↓
                                    outline shown to user, iterate
                                              ↓
                              JSON written to temp file (Codiff-style handoff)
                                              ↓
                    scripts/render-tour.mjs (vendored diff2html + highlight.js)
                                              ↓
                              .pr-tour/<slug>.html  (single file, works offline)
```

Two cleanly separated pieces:

- **Authoring** (the agent's job): fetch the PR, parse it, group hunks into snapshots, write prose, get the user's approval on the outline.
- **Rendering** (a deterministic Node script): takes the approved JSON plus vendored assets, produces one HTML file. No LLM involved in rendering, so the output is reproducible and the script can be tested on its own, independent of any specific PR.

## Input

GitHub PR reference only for v1: full URL, `#N`, bare number, or "current branch" (default). Resolve to `owner/repo` + PR number with `gh`, matching the resolution style already used by `guided-pr`.

Local git refs (branch/commit range with no PR) are out of scope for v1 — can be added later without changing the rendering step, since the parser's output (`{path, status, hunks[]}`) doesn't care where the diff came from.

## Data model (JSON handoff)

**v2 revision:** v1 chose a flat snapshot list over Codiff's chapter/stop nesting as YAGNI. Real use against a 164-file PR (metaphysics#7623) plus a direct ask to match Codiff's own walkthrough UI (grouped-by-theme sidebar, phase progress bar, per-file stat badges) brought the chapter layer back. The schema now mirrors Codiff's shape directly:

```json
{
  "title": "string (PR title)",
  "prUrl": "string",
  "chapters": [
    {
      "id": "c1",
      "title": "short theme title, e.g. 'Stitching core'",
      "icon": "🔧",
      "snapshots": [
        {
          "id": "s1",
          "title": "short title, e.g. 'Scroll position tracking'",
          "prose": "2-6 sentences: what changed here and why",
          "hunks": [
            { "path": "src/client/App.tsx", "status": "modified", "diffText": "<unified diff hunk text, including its @@ header>" }
          ]
        }
      ]
    }
  ]
}
```

- `diffText` is the raw unified-diff snippet per hunk. The render script assembles a per-file diff string per snapshot and feeds it to `Diff2Html.html()`.
- No live hunk-ID recomputation (unlike Codiff) — this is a point-in-time snapshot of the PR's diff as fetched, not a view that stays in sync with further pushes.
- Every hunk in the PR's diff must appear in exactly one snapshot. No "support" bucket for v1 — if a hunk doesn't fit a narrative group, it still needs a snapshot (even a small "misc" one), since the tour must cover the whole diff.
- `chapters[].icon` is optional — the agent picks an emoji per theme or omits it; the UI falls back to a plain number.
- **Single-chapter fallback:** if the agent doesn't find natural themes, it emits one chapter wrapping every snapshot. The render script detects this (`chapters.length === 1`) and hides the phase bar and chapter header entirely, rendering the same flat look v1 had — no separate "ungrouped" schema variant needed.

## Workflow

1. Resolve the PR ref via `gh pr view --json number,title,body,url,headRefOid,baseRefName,headRefName,files,headRepository`.
2. `gh pr diff <ref>` → parse into `{path, status, hunks[]}` per file, splitting on `@@ ... @@` hunk headers.
3. Read the diff and the PR body/description for intent. Propose an ordered list of snapshots, grouping by review idea (not by file, not one-hunk-per-snapshot for repeated mechanical changes).
4. **Show the outline as plain text** — numbered list of `title — one-line summary — files touched` — and iterate with the user until approved. This is a hard checkpoint; do not render before approval.
5. Write the approved JSON to a temp file outside the repo (e.g. `$TMPDIR/pr-tour-<id>.json`).
6. Run `node scripts/render-tour.mjs --data <tmpfile> --out .pr-tour/<slug>.html`.
7. Report the file path to the user. No publishing/hosting step in v1.

## Rendering / UI

- `assets/diff2html.min.js`, `assets/diff2html.min.css`, `assets/highlight.min.js` are vendored into the skill directory once (not fetched per run) and inlined into the output HTML's `<script>`/`<style>` tags, so the generated file has zero network dependencies and works offline.
- difit-inspired chrome: dark theme, left sidebar listing all snapshots (click to jump directly), main pane showing the current snapshot's prose card above a diff2html split/unified view (toggle), bottom bar with Prev/Next buttons and a progress indicator (`3 / 9`).
- Keyboard navigation: `←`/`→` move between snapshots.
- No save-progress/state persistence in v1 — every page load starts at snapshot 1. (Flagged by the user as a later concern, explicitly out of scope here.)

### v2 additions: chapters, stats, branding

- **Phase bar** (top of page, header row): one numbered circle per chapter, connected by a line, checkmark once the user has paged past a chapter, current chapter highlighted. Rendered only when `chapters.length > 1` — a single chapter falls back to the v1 flat look with no phase bar.
- **Sidebar grouping:** each chapter renders as a section header (icon + title) above its snapshots. Each snapshot line shows file count and a `+N -M` stat badge (e.g. `7 files  +181`), matching Codiff's `8 files  +244` style. A sidebar footer shows the grand total (`Total: +4,096 -32`).
- **Line stats:** a new pure function, `computeLineStats(diffText) -> { added, deleted }`, counts lines starting with `+`/`-` while skipping the `+++`/`---` file-header lines. Computed in `render-tour.mjs` (Node, unit-testable), not in `app.js` — the browser never re-parses diff text to get a number it could get wrong. Rolled up four ways: per file card, per snapshot (sidebar), per chapter (phase bar tooltip/label), and the sidebar's grand total.
- **File cards:** each file within a snapshot gets a header row — path, a status badge (`Modified` / `Added` / `Deleted` / `Renamed`, from the parser's existing `status` field), the `+N -M` badge, and a **Viewed** checkbox. Viewed is session-only (dims the card, unchecks on reload) — no persistence, consistent with the "no save/resume" scope call. No "Open in editor" control: there's no local editor to open into from a static, possibly-shared HTML file.
- **Header branding:** the page header shows the tour title (linking out to `prUrl`) and a small inline SVG/emoji pr-tour mark — generated once, not fetched, so it doesn't reintroduce a network dependency.

## Error handling

- PR ref doesn't resolve → surface `gh`'s error verbatim, don't guess at owner/repo.
- Empty diff → tell the user, don't generate an empty tour.
- `gh` not authenticated, or PR not found → surface the CLI error directly, don't retry silently.

## Testing

- `render-tour.mjs` is tested standalone against a small fixture JSON (2-3 snapshots, real diff text): verify the output HTML opens and diff2html renders correctly with no network connection (airplane-mode check — self-contained is the point of the whole design).
- Manual end-to-end check against a real PR (e.g. the metaphysics#7623 example) before considering the skill done.

## Explicitly out of scope for v1

- Local git ref input (branch/commit range without a PR).
- Publishing/hosting the generated HTML (e.g. via the Artifact tool) — deliberately deferred; the user will handle hosting separately.
- Save/resume progress across sessions (including the v2 "Viewed" checkbox — session-only, no persistence).
- Fetching the PR's repo/org avatar for branding — the header mark is a static, non-fetched asset instead.
- An "Open in editor" control on file cards — no local editor to open into from a static HTML file.
