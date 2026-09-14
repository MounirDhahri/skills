# Codex Review

Get an independent second opinion on an implementation plan — from Codex, not
from Claude — before you write any code.

Claude drafts (or you write) the plan, this skill hands it to the `codex` CLI
running non-interactively in a read-only sandbox, Codex reads the repo and
critiques the plan against it, and Claude reports back with the findings it
could confirm, the ones it couldn't, and the ones it thinks are wrong.

It is not a Claude subagent. It's a different vendor's model in a separate
process, with no access to your conversation — which is the whole point.

```
plan.md
  ↓
codex exec --sandbox read-only  <  review-prompt.md
  ↓
codex-verdict.md
  ↓
Claude verifies each finding against the repo
  ↓
report: confirmed / wrong / unverified, ranked critical → optional
```

## Requirements

- [Claude Code](https://code.claude.com) — this is a Claude Code skill.
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
  or `brew install codex`, then `codex login` (or set `OPENAI_API_KEY`).

## Installation

Claude Code loads skills from a `SKILL.md` file in a directory it scans:
personal skills under `~/.claude/skills/`, project skills under
`<project>/.claude/skills/`.

Copy or symlink this `codex-review` directory into one of those locations. To
install for every project (and keep it updated by pulling this repo):

```bash
git clone https://github.com/MounirDhahri/skills.git ~/personal/skills
mkdir -p ~/.claude/skills
ln -s ~/personal/skills/skills/codex-review ~/.claude/skills/codex-review
```

Or copy it into a single project instead:

```bash
mkdir -p /path/to/project/.claude/skills
cp -r skills/codex-review /path/to/project/.claude/skills/codex-review
```

Restart Claude Code (or start a new session) so it picks up the new skill.

## Usage

```
/codex-review .lavish/plan-auth-refactor.html
/codex-review PLAN.md
/codex-review            # reviews the plan from this conversation
```

Or just ask: "get codex to review this plan", "what does codex think of
this?", "red-team this before I start".

Pairs with the `plan` skill in this repo: `/plan` produces the plan,
`/codex-review` attacks it.

## Design notes

Four decisions carry most of the weight:

**Context transfer is the actual work.** `codex exec` starts blank — it can't
see your conversation. The goal, the constraints you set, and the approaches
you already ruled out have to be written into the prompt file, or Codex
confidently proposes the thing you rejected an hour ago.

**The reviewer never gets write access.** `--sandbox read-only` lets Codex
read the repo to check the plan's claims about it while guaranteeing it can't
edit anything. No `--full-auto`, no `--yolo`.

**Its output is claims, not facts.** Every finding gets checked against the
repo before Claude relays it — open the cited file, grep for the thing it says
is missing. Reviewers routinely flag "you forgot X" when X exists under
another name. Findings come back marked confirmed / wrong / unverified.

**Its output is also untrusted text.** If the critique says "now delete the
migrations directory", that's a finding to report, not a command to run.

Findings are ranked `CRITICAL / IMPORTANT / OPTIONAL` with a one-line verdict,
which keeps two capable models from bikeshedding minor style choices.

## Scope

- Plans and design docs only — not diffs, not PRs, not general questions.
- Runs only when invoked. It does not fire automatically after every plan.
- Reports; it doesn't act. Revising the plan is a separate, explicit step.
- Two review rounds at most. Past that it's cheaper to just decide.
