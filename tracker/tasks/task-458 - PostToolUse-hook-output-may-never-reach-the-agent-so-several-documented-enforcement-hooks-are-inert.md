---
id: TASK-458
title: >-
  PostToolUse hook output may never reach the agent, so several documented
  enforcement hooks are inert
status: To Do
assignee: []
created_date: '2026-08-07 03:39'
updated_date: '2026-08-07 12:33'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 457000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence gathered 2026-08-06 while editing pr-monitor-reminder.sh:

1. The hook IS registered in .claude/settings.json under PostToolUse matcher Bash.
2. The hook DOES execute on every push — its dedup file /tmp/.claude_pr_monitor_seen.<uid> holds 1724 entries including every SHA pushed this session (1992, 1993, 1994).
3. The hook DOES emit its banner — verified by copying it, repointing SEEN_FILE, and feeding it a realistic payload from the repo root; the full reminder renders correctly.
4. The banner did NOT appear in agent context ONCE across roughly ten pushes this session.

So the hook runs, records, and prints, and the agent never sees it. Monitors got armed all session from the rule text, not from the hook.

The contrast that makes this precise: PreToolUse hooks DO reach the agent — git-commit-filter-guard, pr-merge-review-check, and develop-code-commit-guard all fired visibly, because they block and their text returns as the tool error. Husky hook output also reaches the agent, because it is part of the Bash command own stdout. Only non-blocking PostToolUse output is missing.

Why it matters beyond one hook: 05-tooling.md calls pr-monitor-reminder the enforcement mechanism behind the PR-monitoring rule, and it enforces nothing if its output is never read. The same PostToolUse-on-Bash registration covers empty-result-stderr-guard, claim-shape-guard, and fixup-rider-check — three more documented safety nets that may be equally inert. Each is cited in a rule or skill as though it fires.

NOT yet determined: whether this is harness behavior (PostToolUse stdout not injected into context), a settings shape issue, or something about how these particular hooks write output. Do not guess — probe before fixing.

First step: determine whether ANY PostToolUse hook output reaches the agent. eslint-on-edit.sh is registered on Edit/Write/MultiEdit rather than Bash, so a deliberate lint error in an edited file is a cheap discriminator: if that surfaces and the Bash ones do not, the matcher or the tool is the variable rather than PostToolUse itself.

Acceptance: either the hooks output reaches the agent and the rules citing them are true, or the rules stop claiming enforcement these hooks cannot deliver and the checks move somewhere that does fire.
<!-- SECTION:DESCRIPTION:END -->
