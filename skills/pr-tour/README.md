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
