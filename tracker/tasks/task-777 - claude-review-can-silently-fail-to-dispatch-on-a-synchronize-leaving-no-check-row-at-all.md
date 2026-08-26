---
id: TASK-777
title: >-
  claude-review can silently fail to dispatch on a synchronize, leaving no check
  row at all
status: To Do
assignee: []
created_date: '2026-08-26 22:43'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 777000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on PR 2232 a force-push produced a synchronize event that dispatched NO Claude Code Review run. The immediately preceding force-push on the same PR did dispatch one, so this is not a per-PR config issue. Cause NOT established; do not record one.

Why it is dangerous: an absent run creates no check-run, so gh pr checks printed 21 green rows and simply had no claude-review row. That is visually identical to all-green. The existing guidance in 05-tooling.md covers a DIFFERENT shape: a green claude-review check that completed without posting a body, whose remedy is gh run rerun. Here there is nothing to rerun, because nothing ran. Only the SHA-pinned actions/runs?head_sha= query surfaced it, and only because the run list was compared against a prior SHA that had two runs where this one had one.

Also established while working around it: closing and reopening the PR does NOT re-trigger. The workflow listens for pull_request types [opened, synchronize]; reopening fires reopened, which is not in that list.

CORRECTION, same session: an earlier version of this paragraph claimed amending to a new sha and force-pushing was a lever that worked. That is FALSE and was written after a single success. Full sequence on PR 2232, from the workflow run list:

  555def6b7  review ran (initial push, opened)
  b4a41b273  review ran (force-push, synchronize) 22:32Z
  85288a4df  NO review run (force-push, synchronize)
  [PR closed and reopened here]
  6d9b54bb9  NO review run (force-push, synchronize, content identical to 85288a4df)

So force-push fired synchronize three times and produced a review twice. NO reliable re-dispatch lever is currently known. Note the ordering rules OUT one plausible cause: the first miss precedes the close/reopen, so close/reopen did not induce it. The workflow was `state=active` throughout and had dispatched normally ten minutes before the first miss.

Two consecutive misses on the same PR also means this is not a one-off flake worth shrugging at — once it starts missing on a PR it may keep missing, which is the shape that strands a PR with no path to a compliant merge. That is the strongest argument for detection (a) below: without it, the condition is invisible AND has no remedy.

Fix shape, two candidates:
(a) Cheapest and most useful: have gh:ci-gate assert that a Claude Code Review run EXISTS for the head sha, and print a distinct sentinel when it does not. The gate already queries runs for the sha, so this is an added predicate rather than a new mechanism, and it converts an invisible omission into a named outcome the monitor reports.
(b) Add reopened to the workflow trigger list so close/reopen becomes a working manual re-dispatch lever. Note this touches .github/workflows/claude-code-review.yml, which guard:workflow-sync requires to land via a main-cut branch, not develop.

(a) and (b) are complementary rather than alternatives; (a) is the detection and (b) is the remedy.

Acceptance: a head sha whose Claude Code Review run never dispatched is reported by the CI gate as a named condition rather than passing silently, and the recovery lever is documented where the gate output points.
<!-- SECTION:DESCRIPTION:END -->
