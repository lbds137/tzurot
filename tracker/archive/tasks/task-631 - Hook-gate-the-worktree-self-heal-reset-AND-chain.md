---
id: TASK-631
title: Hook-gate the worktree self-heal reset AND-chain
status: To Do
assignee: []
created_date: '2026-08-16 19:25'
updated_date: '2026-09-04 19:59'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 631000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of the orchestration-skill self-heal PR noted the scoped git reset --hard exception is enforced by prose only — a dispatched worker evaluates four AND conditions from natural language, with no PreToolUse hook verifying them the way develop-code-commit-guard gates commits. Risk is bounded (the empty git log required..HEAD range check makes the reset forward-only, so committed work cannot become unreachable), which is why this is a hardening nicety rather than a gap.

Fix shape: a .claude/hooks PreToolUse bash hook that fires on git reset --hard inside .claude/worktrees paths and refuses unless: clean status, branch matches worktree-agent-*, and the target..HEAD range is empty. Needs a probe per guard:hook-probes.

Acceptance: hook + probe ship together; a reset violating any condition is blocked with the failing condition named; the sanctioned self-heal path passes.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:59
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-90 (Idea Hook and skill hardening residue — fail open branches and unprobed arms); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-631 finds it.
---
<!-- COMMENTS:END -->
