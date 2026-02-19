# AGENTS.md & CLAUDE.md Generator

A Claude Code skill that generates both `AGENTS.md` and `CLAUDE.md` files for a repository.

- **AGENTS.md** — Cross-tool agent instructions following the [open standard](https://agents.md). Works with Claude Code, Cursor, Windsurf, Zed, GitHub Copilot, Codex, and others.
- **CLAUDE.md** — Thin Claude Code-specific config that references AGENTS.md via `@import`.

## Usage

Install as a Claude Code skill, then invoke it on any repository that needs agent onboarding.

## References

- [AGENTS.md spec](https://agents.md)
- [CLAUDE.md memory docs](https://code.claude.com/docs/en/memory)
- [CLAUDE.md guide (Builder.io)](https://www.builder.io/blog/claude-md-guide)

## License

MIT
