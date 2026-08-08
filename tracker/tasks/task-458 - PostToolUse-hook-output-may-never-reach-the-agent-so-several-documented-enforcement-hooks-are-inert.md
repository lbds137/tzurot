---
id: TASK-458
title: >-
  PostToolUse hook output may never reach the agent, so several documented
  enforcement hooks are inert
status: Done
assignee: []
created_date: '2026-08-07 03:39'
updated_date: '2026-08-08 00:32'
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

## CONFIRMED by probe — the discriminator ran

The answer is PostToolUse itself, NOT the matcher. Four steps, each closing an alternative:

1. Edited a .ts file, firing eslint-on-edit.sh (matcher Edit|Write|MultiEdit, not Bash) with a deliberate unused-binding error. NO output reached the agent.
2. Ran eslint on that exact file directly: 1 error, output present. So there WAS something to deliver.
3. Fed the hook the payload shape the harness sends: it printed that same eslint output and exited 0. So the hook itself works.
4. Reverted; git status clean.

Conclusion: non-blocking PostToolUse output never reaches the agent regardless of matcher. Six registered hooks affected: pr-monitor-reminder, release-finalize-reminder, empty-result-stderr-guard, fixup-rider-check, claim-shape-guard, eslint-on-edit.

Contrast confirming the boundary, both observed live rather than inferred: the pr-merge-review-check PreToolUse hook injected a full review into agent context during the PR #2000 merge, and husky output arrives on every commit because it is the Bash command own stdout. NOT verified: WHY the harness drops it. The pattern fits "only blocking-error text is injected", but that is a hypothesis, not a finding.

Second-order cost found while probing: eslint-on-edit spends ~4.8s per edited .ts file (its own comment measures this) producing output nobody has ever read.

## Remediation shape — deletion was considered and REJECTED

Every one of these hooks encodes a live concern and ships a probe harness; the fault is the delivery channel, so they get RE-HOMED, not deleted:

- claim-shape-guard: needs the post-commit diff, so it cannot be PreToolUse — but .husky/pre-commit output DOES reach the agent, and pre-commit is the better moment anyway (the claim has not entered history yet). Move there.
- fixup-rider-check: its own comment says detection is command-text only, so PreToolUse is behaviourally identical and fires before the commit. Move there.
- release-finalize-reminder: needs post-merge PR state. The pr-merge-review-check PreToolUse hook already fires on the exact command (gh pr merge) and demonstrably reaches the agent — fold the release-PR reminder into it.
- empty-result-stderr-guard: structurally cannot move; it needs the empty RESULT, which exists only post-hoc. Correct the false "structural backstop" claim in 10-working-posture.md and keep the rule text.
- pr-monitor-reminder: correct the false "the hook is the enforcement mechanism behind this rule" claim in 05-tooling.md and the git-workflow skill. The rule text is what has actually been working.
- eslint-on-edit: decide between dropping it and keeping a 4.8s-per-edit no-op. lint-staged and CI already enforce it.

REVISED destination for fixup-rider-check (the PreToolUse assumption above does NOT hold): every PreToolUse hook in this repo is block-or-silent, emitting output only on its exit-2 path, so nothing here shows that a PreToolUse hook exiting 0 delivers output either. Do not build on that. All three moves now target channels proven in-session — claim-shape-guard to .husky/pre-commit, fixup-rider-check to .husky/commit-msg (which sees the `fixup!` subject directly, killing the documented false positive where a commit whose MESSAGE mentions --fixup fires it), and release-finalize-reminder folded into pr-merge-review-check, which BLOCKS and demonstrably reached the agent during the PR #2000 merge.

OPEN QUESTION, no longer load-bearing: does a non-blocking PreToolUse hook's output reach the agent at all? Nothing in the repo answers it.

ABSORBED: TASK-433 (watch empty-result-stderr-guard reminder volume; tighten if noisy) was archived into this task. Its trigger was observed reminder volume — unobservable, since those reminders never arrive. Its real acceptance criterion ("or the hook is retired with the reason") is decided here instead.

## SHIPPED 2026-08-07 (#2002)

claim-shape-guard -> .husky/pre-commit (scans the STAGED diff).
fixup-rider-check -> .husky/commit-msg (keyed on git's fixup!/squash!/amend!
subject, which killed the documented --fixup-in-message false positive; all
three prefixes verified live to pass commitlint, so no arm is dead).
release-finalize reminder -> folded into the BLOCKING pr-merge-review-check,
firing before the merge rather than after, and reachable even when no review
comment exists (a review-round finding: the first cut nested it behind the
review-existence check, which would have silently dropped it in the documented
claude-review-posted-nothing case).

CORRECTION to the remediation recorded above: pr-monitor-reminder is NOT inert.
Its gh api assignee backfill is a real write that works without output
delivery, so it stays registered; only its banner was dead.

empty-result-stderr-guard was RETIRED (deleted with its probe), which is the
acceptance criterion the absorbed TASK-433 recorded: no channel can carry it,
because it needs the command's RESULT and that exists only post-hoc. The rule
text in 10-working-posture.md is the mechanism and says so. eslint-on-edit is
unregistered with an in-file UNREGISTERED header rather than deleted - it is
dormant-but-viable (a working script whose only fault is the channel), and
lint-staged plus CI already cover it.
release-finalize-reminder.sh deleted (superseded). False enforcement claims
removed from 05-tooling.md (x2), 10-working-posture.md, the git-workflow skill,
and check-monitor-command.ts.

Follow-ups filed rather than folded in: TASK-464 (claim-shape cannot-<verb>
false positive), TASK-302 gained pr-merge-review-check as a probe-parity member.
<!-- SECTION:DESCRIPTION:END -->
