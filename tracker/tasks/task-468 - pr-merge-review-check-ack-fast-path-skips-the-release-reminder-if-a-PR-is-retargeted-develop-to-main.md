---
id: TASK-468
title: >-
  pr-merge-review-check ack fast path skips the release reminder if a PR is
  retargeted develop-to-main
status: Done
assignee: []
created_date: '2026-08-08 01:03'
updated_date: '2026-08-09 01:12'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 468000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the #2002 round-5 review, and it is a claim I had made wrongly in my own comment.

The fast path is:

    ACK_KEY="${PR_NUM}:${REVIEW_ID}"
    if grep -qxF "$ACK_KEY" "$ACK_FILE"; then exit 0; fi

placed before any base resolution, on the stated reasoning that the release reminder "was already delivered by the blocking call that wrote this ack". That holds only if the base has not changed since.

Repro:
1. PR opened against develop; a claude-review posts (id 555).
2. gh pr merge is attempted. Slow path runs, base resolves to develop, no release block, ACK 
"N:555" is written. The merge does not complete this round.
3. PR is retargeted to main.
4. gh pr merge retried. Review id is unchanged, so the ack matches and the hook exits 0 before release_reminder_due is consulted. The reminder never fires for that PR.

This is the same staleness class as the BASE cache removed in #2002 round 2, reached through a different door: that fix covered resolve_pr_base internal memoization, not the coarser "ack implies release handling already happened" assumption.

WHY IT WAS NOT FIXED IN #2002 (this is the interesting part, do not re-derive it): the two obvious fixes both cost a gh pr view on EVERY merge attempt, including the acked-retry path — and rounds 3 and 4 of that same PR, independently, asked for exactly that call to be REMOVED from these paths as a perf/reliability concern. The reviewers genuinely conflict. Any fix has to pick a side with an argument, not just apply the latest suggestion.

Options, none free:
- Key the ack on PR_NUM:REVIEW_ID:BASE. Requires resolving base to build the key, so it pays the call every time. Circular.
- Re-check release_reminder_due on the ack-hit path. Free ONLY when a RELEASE ack already exists; for an ordinary feature PR no RELEASE ack is ever written, so it resolves base on every retry — the cost rounds 3-4 objected to.
- Write a negative NOTRELEASE:<PR> marker. Cheap, but it is a base cache under another name and carries the identical retarget staleness.
- Accept the network call unconditionally and argue that a merge gate is not a hot path (a few calls a day, and the slow path already makes one). This is the honest frontrunner if correctness is weighted above the call.

Trigger is narrow: release PRs are opened against main directly, so retargeting an open PR to main is not the documented workflow. That is why it was documented at the site rather than patched late in a fifth review round.

Acceptance: either the gap is closed with the cost tradeoff argued explicitly against the rounds 3-4 objection, or it is ruled out on merits with that argument recorded. Do not close it by silently adding the call back.
<!-- SECTION:DESCRIPTION:END -->
