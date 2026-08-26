---
id: TASK-653
title: Merge-time hook should demand re-derivation of numeric claims in a PR body
status: To Do
assignee: []
created_date: '2026-08-18 03:02'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 653000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three stale self-reported numbers landed in one day, each caught by a reviewer rather than the author -- beta.204 release PR body said 72 files when the diff was 91; PR 2134 commit message said the interval was half the cache TTL after the code moved to a third; PR 2135 body said 12 colocated tests when there were 38. Each was correct when written and became false when the underlying thing moved. Nothing in the workflow prompts a re-read, so care alone does not fix it.

Why a hook and not a rule: .claude/rules is at 154272 of 154502 bytes, roughly 230 bytes of headroom, so a rule addition would blow the always-loaded budget. The trigger is also deterministic and the correction mechanical, which is the hook criterion in 00-critical Fix Recurring Failures Structurally.

Fix shape: extend .claude/hooks/pr-merge-review-check.sh, which already fires on gh pr merge and already injects the review body. Have it additionally scan the PR body and the head commit message for numeric claims -- integers next to words like file, files, test, tests, PR, PRs, site, sites, percent, or a fraction phrase like half/third of -- and print them back as a re-derive checklist before allowing the merge retry. It does NOT need to verify the numbers, only to force the author to look at them at the one moment they otherwise never do.

Note the commit-message half is the sharpest case: git commit --fixup never touches the base message, so N rounds of fixups leave it describing a design that no longer exists, and it becomes permanent history.

Acceptance: attempting to merge a PR whose body contains a numeric claim prints that claim in a re-derive list; a body with no numeric claims passes silently. Probe added per the guard hook-probes registry.

PARTIAL LANDED — acceptance NOT met, task stays open (verified 2026-08-26, reading the hook rather than assuming). pr-merge-review-check.sh does now print a RE-DERIVE THE NUMBERS paragraph before allowing the merge retry, and it demonstrably works: it caught a stale test count on PR 2228 (body said 6651, suite was 6652) and a stale one on PR 2229's own predecessor. The probe file exists (.claude/hooks/pr-merge-review-check.probe.sh), so that clause is covered.

What is NOT built is the half the acceptance is actually about. The shipped paragraph is FIXED TEXT printed unconditionally whenever the review gate fires — it neither scans the PR body nor echoes the specific claims back, and it never passes silently on a body with no numbers. That leaves it attention-dependent, which is the exact property the task was filed to remove: a constant banner is the thing readers learn to skip, and this task exists because three stale numbers landed in one day despite the authors caring.

REMAINING WORK: extract the claims (integers adjacent to file/files/test/tests/PR/PRs/site/sites/percent, plus fraction phrases like half/third of) from the PR body AND the head commit message, print them as a checklist, and emit nothing when there are none. The commit-message half stays the sharpest case for the reason in the original note — git commit --fixup never touches the base message.

SIBLING LIST IS STALE — check status before treating the family as five. TASK-547 and TASK-520 have been Done since 2026-08-12 (shipped in #2075 and #2071 respectively); the sibling lists in TASK-669 and TASK-673 were written on 08-19 and still name them, so they read as open. Verified 2026-08-26 by reading the committed status field, after first confirming their implementations landed: the git-workflow skill carries the closing-reference/acceptance-quote procedure, review-response carries the correction-edits-the-original line, and 02-code-standards names the dependency-comment case.

The live family is therefore TASK-653 (this one), TASK-669 and TASK-673 — three consumers for a shared staged-diff inspection step, not five. Re-check that a shared extraction still earns its keep at three before designing one; each of the three inspects a different thing (PR-body text, removed-identifier declarations, added assertions) and only the trigger moment is common.
<!-- SECTION:DESCRIPTION:END -->
