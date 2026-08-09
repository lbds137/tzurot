---
id: TASK-461
title: >-
  Probe whether a bypass-actor-free deletion rule actually blocks GitHub
  auto-delete
status: To Do
assignee: []
created_date: '2026-08-07 22:30'
updated_date: '2026-08-07 22:30'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 460000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: guard:repo-settings reports a branch safe when it has a deletion rule with zero bypass_actors, but that success case has NEVER been observed. The beta.195 incident demonstrated only the FAILURE case (develop, bypassable rule, deleted). main survived because main is never the head branch of any merge here, NOT because its rule was exercised and held. If GitHub admin-privileged auto-delete ignores rulesets entirely, the guard prints a clean report for a still-deletable branch — the silent direction it exists to prevent.

Probe (cheap, falsifying): a disposable repo with a deletion rule carrying zero bypass actors AND delete_branch_on_merge true. Merge a PR whose HEAD is that protected branch. See whether it survives.

Outcome either way: if it survives, drop the unverified-premise caveat from isDeletionReachable and the clean-report footer. If it does not, the ruleset half of the guard is worthless and delete_branch_on_merge false is the only real protection — say so loudly in the report.

Note the primary protection today does NOT depend on this: delete_branch_on_merge is false, which needs no assumption about rulesets.

## PROBE RUN 2026-08-08 — the premise HOLDS

Ran the falsifying probe on a disposable public repo
(lbds137/tzurot-deletion-probe), owner-approved.

Setup: delete_branch_on_merge = true; branch `protected-head` carrying an ACTIVE
ruleset with a `deletion` rule and ZERO bypass actors, confirmed in effect via
repos/.../rules/branches/protected-head.

Two results, both measured:

1. A direct DELETE of the ref, issued as the repository OWNER, was refused —
   422 "Repository rule violations found / Cannot delete this branch".
2. A PR whose HEAD was that branch was merged (state MERGED, merge commit
   0b743470, merged by lbds137) with delete_branch_on_merge still true. The
   branch SURVIVED — repos/.../branches lists main and protected-head after.

So a bypass-actor-free deletion rule DOES stop the admin-privileged auto-delete.
The success case isDeletionReachable reports has now been exercised, not merely
assumed.

Consequence for the guard, per this task's own acceptance: the
unverified-premise caveat in isDeletionReachable's doc comment and the clean
report footer can be dropped — that is a separate small PR against
check-repo-settings.ts, not part of this record.

What this does NOT show: that the ruleset half is sufficient on its own. The
probe used one branch, one ruleset, one merge, on a repo whose settings nobody
else touches. delete_branch_on_merge = false remains the primary protection
because it needs no assumption about rulesets at all.

<!-- SECTION:DESCRIPTION:END -->
