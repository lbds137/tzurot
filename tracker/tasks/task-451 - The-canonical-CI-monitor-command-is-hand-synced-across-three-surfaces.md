---
id: TASK-451
title: The canonical CI-monitor command is hand-synced across three surfaces
status: Done
assignee: []
created_date: '2026-08-07 00:32'
updated_date: '2026-08-07 02:33'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 451000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The same bash one-liner (the until-gate + gh pr checks --watch monitor command) is embedded verbatim in THREE places:

- .claude/hooks/pr-monitor-reminder.sh (inside a heredoc) — the only surface that is actually EXECUTED, so it is ground truth
- .claude/rules/05-tooling.md (canonical block)
- .claude/skills/tzurot-git-workflow/SKILL.md (fallback template)

Every logic change therefore needs three coordinated edits. Surfaced by the #1989 round-3 review, which noted this cuts against 07-documentation.md three-layer rule that layers do not duplicate content.

Evidence it is a real cost, not theoretical: PR #1989 paid it THREE times in one evening — the sleep-to-run-gate change, then the startup_failure predicate fix, then the full-SHA and persistent-false notes. Each round touched all three files, and each round required a separate byte-identical verification step (bash -n on each copy plus a diff) to prove they had not drifted. One round DID briefly drift when an edit landed on the wrong branch.

Fix shape: make the rule and skill REFERENCE the hooks command rather than re-embed the literal string — for example a short pointer plus a guard that extracts the command from the hook and asserts the docs do not contain a competing literal. The hook is the natural source of truth because it is the executed copy.

Alternative if a pointer reads badly: keep the literal in 05-tooling.md as canonical, and add a guard that greps the hook and SKILL.md and fails if their copies diverge from it. That preserves readability while making drift impossible to merge.

Pre-existing pattern (the old sleep-60 command was equally triplicated) — this is not a regression introduced by #1989.

Acceptance: a logic change to the monitor command requires editing ONE place, or a CI guard fails when the copies diverge.
<!-- SECTION:DESCRIPTION:END -->
