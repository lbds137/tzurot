---
id: TASK-665
title: >-
  Admission bar requires a duplicate search only for batches, not for individual
  tasks
status: To Do
assignee: []
created_date: '2026-08-18 21:32'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 665000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-663 was filed 2026-08-18 as a duplicate of TASK-651 — same channel, same prefix-diff offsets 30,862 / 30,894, same fix shape, filed roughly 18 hours apart by the same agent.

The gap, verified in the rule text: 06-backlog.md carries "Search before creating the batch" with the concrete commands, but it sits inside the sentence beginning "Which one, for a batch" (line 88). It is scoped to the batch case. The three rows of the admission-bar table that route an ordinary item to "File it as a task. No trigger needed." have no search step at all, so filing a single task is unguarded by the rule as written.

The failure shape worth naming, because it is what defeats "just search first": the duplicate was filed off a finding the agent had just produced itself, from a fresh prod read. Self-discovery FEELS like proof of novelty — you are not recalling something that might already exist, you are watching it appear. That is precisely when the search gets skipped, and precisely when it is most needed, because a recurring symptom gets rediscovered by whoever looks next.

Contributing cause, worth a clause of its own: backlog/now.md said the beta.204 post-deploy read was STILL OWED while TASK-651 already held half its results. The agent acted on the board rather than the tracker. 10-working-posture already says boards are snapshots — the addition here is that the tracker is the thing to check BEFORE re-doing work a board calls outstanding.

Fix shape: move the search requirement out of the batch sentence and into the admission bar itself, so it covers every filing. Name the decision-point trigger explicitly — the moment before `pnpm tracker task create` runs — and call out the self-discovery case, since a rule that reads as "search if you think it might exist" does not fire when you are certain it does not.

Requires a PR: .claude/rules/*.md is review-gated per 00-critical. Small enough to ride any rules-touching PR.

Acceptance: filing an individual task requires the same two-command search the batch case does; the rule names the self-discovery case as the one where the search is most likely skipped and most needed.
<!-- SECTION:DESCRIPTION:END -->
