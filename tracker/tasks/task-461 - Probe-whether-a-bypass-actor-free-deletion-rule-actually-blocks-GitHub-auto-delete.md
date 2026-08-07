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
<!-- SECTION:DESCRIPTION:END -->
