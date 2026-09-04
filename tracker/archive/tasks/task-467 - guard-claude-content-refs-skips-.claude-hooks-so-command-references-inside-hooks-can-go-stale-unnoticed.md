---
id: TASK-467
title: >-
  guard:claude-content-refs skips .claude/hooks, so command references inside
  hooks can go stale unnoticed
status: To Do
assignee: []
created_date: '2026-08-08 00:50'
updated_date: '2026-09-04 19:57'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 467000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-08-07 by two independent #2002 reviewers, who flagged that the release-sequence text in pr-merge-review-check.sh duplicates guidance also living in the git-workflow skill and 05-tooling.md, with no drift guard analogous to guard:monitor-command.

Disposition on the DUPLICATION itself: correct as-is, no guard needed. The hook block is a REMINDER pointing at a procedure, not a verbatim string anyone copy-pastes. guard:monitor-command exists because the CI-monitor one-liner is pasted byte-for-byte into a Monitor invocation, so a one-character drift silently watches the wrong thing. Prose guidance that says the same thing in different words on two surfaces is not that failure mode.

The REAL gap the reviewers pointed at sideways: the block embeds an actual command, `pnpm ops release:finalize --yes`. guard:claude-content-refs already validates that command references in .claude content resolve to registered ops commands - but its output says "Checking 24 rule/skill files", i.e. it covers .claude/rules and .claude/skills only. Hook scripts are not scanned. So if a command referenced inside a hook is renamed, the hook keeps printing the dead invocation and nothing fails.

This is not hypothetical for hooks specifically: pr-merge-review-check.sh prints release:finalize and release:premigrate, pr-monitor-reminder.sh embeds the whole gh:ci-gate invocation, and the husky hooks call several pnpm ops commands directly.

Fix shape: extend the guard file set to include .claude/hooks/*.sh (and probably .husky/*), reusing the existing extraction. Shell files will need the extractor to tolerate commands inside heredocs and printf strings. Confirm the staleness-threshold half of that guard either applies or is skipped for hooks - hooks carry no lastUpdated frontmatter.

Acceptance: renaming a registered ops command that a hook references fails guard:claude-content-refs, pinned by a canary.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:57
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-467 finds it.
---
<!-- COMMENTS:END -->
