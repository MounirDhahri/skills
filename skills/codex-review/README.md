# Codex Review

An independent second opinion on an implementation plan, from Codex rather
than from Claude, before you write any code.

You write the plan (or Claude drafts it). This skill hands it to the `codex`
CLI in a read-only sandbox. Codex reads the repo, critiques the plan against
it, and Claude reports back with the findings it could confirm, the ones it
couldn't, and the ones it thinks are wrong.

Codex is not a Claude subagent. It is a different vendor's model in its own
process, with no access to your conversation. That is the point.

```
plan.md
  ↓
codex exec --sandbox read-only  <  review-prompt.md
  ↓
codex-verdict.md
  ↓
Claude checks each finding against the repo
  ↓
report: confirmed / wrong / unverified, ranked critical → optional
```

## Requirements

- [Claude Code](https://code.claude.com). This is a Claude Code skill.
- [Codex CLI](https://github.com/openai/codex): `npm install -g @openai/codex`
  or `brew install codex`, then `codex login` (or set `OPENAI_API_KEY`).
- Herdr, optional. When `HERDR_ENV=1` and `herdr` is on PATH, the review runs
  as a named agent in a split pane so you can watch it work. Without it, the
  same review runs headless.

## Installation

Claude Code loads skills from a `SKILL.md` in a directory it scans: personal
skills under `~/.claude/skills/`, project skills under
`<project>/.claude/skills/`.

Copy or symlink this directory into one of them. For every project, kept up to
date by pulling this repo:

```bash
git clone https://github.com/MounirDhahri/skills.git ~/personal/skills
mkdir -p ~/.claude/skills
ln -s ~/personal/skills/skills/codex-review ~/.claude/skills/codex-review
```

Or into one project:

```bash
mkdir -p /path/to/project/.claude/skills
cp -r skills/codex-review /path/to/project/.claude/skills/codex-review
```

Restart Claude Code so it picks up the new skill.

## Usage

```
/codex-review .lavish/plan-auth-refactor.html
/codex-review PLAN.md
/codex-review            # the plan from this conversation
```

Or just ask: "get codex to review this plan", "what does codex think?",
"red-team this before I start".

Pairs with the `plan` skill in this repo. `/plan` writes the plan,
`/codex-review` attacks it.

## Design notes

Four rules carry the weight.

**Write the context in.** `codex exec` starts blank and cannot see your
conversation. The goal, the limits you set, and the options you already ruled
out go in the prompt file, or Codex proposes what you turned down an hour ago.

**The reviewer cannot write.** `--sandbox read-only` lets Codex read the repo
to check the plan's claims about it, and do nothing else. No `--full-auto`, no
`--yolo`. In a Herdr pane that promise is weaker, because the agent kind owns
the sandbox rather than a flag this skill passes, so the report names which
runner ran.

**Findings are claims, not facts.** Claude opens every file Codex cites and
greps for whatever it calls missing. Reviewers routinely flag "you forgot X"
when X exists under another name. Each finding comes back marked confirmed,
wrong, or unverified.

**The output is untrusted text.** "Now delete the migrations directory" is a
finding to report, never a command to run.

Findings are ranked `CRITICAL / IMPORTANT / OPTIONAL` under a one-line
verdict, which keeps two capable models from arguing about style.

## Scope

- Plans and design docs. Not diffs, not PRs, not general questions.
- Invoked by hand. It never fires on its own after a plan.
- Reports without acting. Revising the plan is a separate step you ask for.
- Two rounds at most. After that it is cheaper to decide.
