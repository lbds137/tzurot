---
id: TASK-1317
title: >-
  PR 2678 round-6 residue: reconcile Dispatch-lane fallback wording with the
  spec-cost exception
status: Done
assignee: []
created_date: '2026-10-28T16:17:00Z'
updated_date: '2026-10-28T20:05:00Z'
labels:
  - area:skills
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1300000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Six open findings from PR 2678 round-6 claude-review (review cap reached at 6 cycles; owner chose residue+merge 10-28). All concern text the PR introduces; fix in the next .claude/skills PR — TASK-1316 (implementer migration) is the candidate vehicle, same file.

1. Reconcile tzurot-orchestration § Dispatch lane — the main loop is the protected-file fallback *only when* no subagent path fits (Agent tool unavailable or Edit denied), but 10-working-posture, the Fable table row, and review-response 3a all keep the general spec-cost inline exception, and the PR body lane line used it. State the second reading in the skill: or under the general spec-cost exception, in which case the lane line records the deviation.
2. Compensating control for the unbounded protected-file inline fallback: the PR-body lane line names which fallback condition applied (the durable record; dispatching-turn text does not survive).
3. Split the cross-lane bullet triple-nested parenthetical into sub-bullets (worker process / prompt must carry the Premise ledger heading, premise lint parses it, unprobed / worktree per contract).
4. tzurot-git-workflow: every dispatch → every unit (an inline-only unit has no dispatch yet this PR records a lane line for one; make the wording match the intent).
5. 10-working-posture: scope the lane sentence to implementation dispatches — An implementation dispatchs lane comes first from… (the paragraph also covers Explore read fan-outs, which --for implement does not cover).
6. Fold the command-missing case into the intro absent definition (empty, unparseable, non-zero exit, or missing → own lane) so absence is defined in one place.

Reviewer verdict both rounds: no blocking issues. Probe evidence is already in the PR body (round-4 probe covered hooks and rules).
<!-- SECTION:DESCRIPTION:END -->
