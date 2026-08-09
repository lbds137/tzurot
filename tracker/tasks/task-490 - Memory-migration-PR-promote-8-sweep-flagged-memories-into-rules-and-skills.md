---
id: TASK-490
title: 'Memory-migration PR: promote 8 sweep-flagged memories into rules and skills'
status: To Do
assignee: []
created_date: '2026-08-09 16:44'
updated_date: '2026-08-09 17:03'
labels:
  - 'area:process'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 490000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-09 Section 0 memory sweep flagged 8 memories as MIGRATE - their nuance is missing from the destination rule or skill, and per the atomic promote-and-delete rule they stay in memory until the destination captures it. Sequenced AFTER PR 2028 merges (same destination files).
What, per file (destination -> nuance): autonomy_default -> 09-interaction (no plan-mode for purely-technical ratification; autonomy = not asking, never not telling). pin_typed_client_fields -> 02-code-standards rule 7 (Zod strip-mode deletes undeclared response fields; pin survival at Schema.safeParse; null-sentinel round-trip case). rebase_open_prs_after_tooling_bump -> git-workflow skill Dependabot section (green PR CI reflects its base; gh pr merge --rebase does NOT re-run CI; rebase+focus:lint+push after tooling bumps). skill_check_load_dont_skim -> 00-critical or 10-working-posture (SKILL CHECK reminders binding; the that-is-what-I-would-do-anyway feeling is the strongest signal to load; cycle-rare ops). verify_keep_list_in_removals -> 00-critical speculation section (KEEP lists are claims; present-and-wired is not live; trace write->read->effect). verify_reviewer_claims -> 00-critical external-feedback section (reviewer trigger phrases typically/usually/default-is; cite the verification either way; applies to council output). hotfix_release_off_main -> git-workflow skill Release section (branch prefix allowlist has no release type; merge switches local checkout; finalize force-push semantic-divergence + per-instance approval). vitest_root_vs_package_config -> testing skill (root-invoked vitest skips setupFiles -> mock pollution masquerading as pre-existing flake).
Acceptance: one review-gated PR lands the 8 destinations (each addition <=4 lines, economy-pass bar); the 8 memory files + their MEMORY.md lines deleted in the same change (atomic promote-and-delete).
Rider (owner ask 2026-08-09): add "AskUserQuestion" to the tracked .claude/settings.json permissions allow array - mobile shows a phantom permission prompt after the question is already answered; the user-level allowlist copy is already applied, this rider covers contributors/fresh clones.
Rider 2 (missed during the pass - honest-ledger item): weigh TASK-470's one-line candidate ("mutate the code the assertion covers and confirm it goes red") for always-loaded inclusion, per doc-61's owner ruling that it be weighed INSIDE the economy pass; the pass ran without weighing it. Decide include-or-decline in this PR and update TASK-470 either way.
<!-- SECTION:DESCRIPTION:END -->
