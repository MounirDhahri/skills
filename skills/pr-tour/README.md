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

## Running the tests

```bash
node --test scripts/lib/*.test.mjs
```

(`node --test scripts/lib/` fails — Node tries to resolve the directory
itself as a CJS module — so glob the `.test.mjs` files explicitly.)

## Scope

- GitHub PR input only — no local git ref/branch-only input.
- No publishing/hosting step — the skill writes a local `.html` file, no more.
- No save/resume progress across sessions.
