---
name: plan
description: Plan any technical or product task and render the result as a Lavish HTML artifact for visual review and annotation. Use when the user types /plan or wants an implementation plan presented visually.
argument-hint: <what to plan>
allowed-tools: Read Write Edit Bash(npx:*) Bash(find:*) Bash(grep:*) Bash(ls:*)
---

# Plan via Lavish

When the user invokes `/plan`, produce a thorough implementation plan and render it as a Lavish HTML artifact instead of responding with prose. The artifact is the response.

## Request

$ARGUMENTS

## Workflow

1. **Read the playbooks first** — always run both before writing HTML:
   ```
   npx -y lavish-axi playbook plan
   npx -y lavish-axi playbook diagram
   ```
   If the plan involves comparisons or code, also run `npx -y lavish-axi playbook comparison` and/or `npx -y lavish-axi playbook code`.

2. **Think through the plan** — before writing HTML, reason about:
   - Goal and current state
   - Proposed approach and key decisions
   - Files/modules that will change
   - Risks, open questions, and alternatives ruled out

3. **Create the artifact** at `.lavish/plan-<slug>.html` where `<slug>` is a short kebab-case name for the task. Follow the plan playbook structure:
   - Start with the goal, current state, and desired outcome
   - Show the proposed approach with key decisions called out visually
   - Include a Mermaid diagram if architecture or flow is involved
   - List risks, failure modes, and open questions
   - End with a concrete step-by-step implementation checklist

4. **Design direction** — check the project for its design system first (Tailwind config, CSS tokens, component library). If none, run `npx -y lavish-axi design` for the CDN defaults.

5. **Open in Lavish**:
   ```
   npx -y lavish-axi .lavish/plan-<slug>.html
   ```

6. **Poll for feedback** (run in background):
   ```
   npx -y lavish-axi poll .lavish/plan-<slug>.html
   ```
   When feedback arrives, apply changes and reply with:
   ```
   npx -y lavish-axi poll .lavish/plan-<slug>.html --agent-reply "<message>"
   ```

7. When the user approves the plan, end the session:
   ```
   npx -y lavish-axi end .lavish/plan-<slug>.html
   ```
   Then proceed with implementation.

## Plan artifact structure

A good plan artifact has these sections, in order:

- **Header** — task name, branch/PR context if available, one-line goal
- **Current state** — what exists today, what's broken or missing
- **Proposed approach** — the solution in plain language, major decisions highlighted
- **Architecture / flow diagram** — Mermaid diagram when there are moving parts
- **File-level changes** — which files change and why (table or annotated list)
- **Risks & open questions** — failure modes, backwards-compat concerns, unknowns
- **Implementation checklist** — ordered steps the developer will follow

## Rules

- Never respond with prose when `/plan` is invoked — the artifact IS the answer
- Keep claims grounded: verify file paths exist before citing them; use `grep` or `find` if unsure
- Do not leave unresolved open questions in the artifact — either answer them or mark them explicitly as "needs decision from user"
- The checklist at the end must be concrete enough that another developer could implement without re-reading the conversation
