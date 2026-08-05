---
id: TASK-324
title: skill-eval review-response branch regex is unanchored
status: To Do
assignee: []
created_date: '2026-07-24 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 324000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-24 (#1783 review r4, non-blocking) — `skill-eval.sh`'s new review-response branch `address.*(review|finding)` is unanchored, so a multi-clause prompt containing "address" and "review"/"finding" far apart false-matches (verified: `"update the address field and review the schema"` fires). Nudge-only, so the cost is one advisory line, not a behavior change. (The reviewer's OTHER claimed false positive — `claude.?review` matching `"hey claude, review the auth flow"` — was **disproved**: `.?` allows one char and `", "` is two, so it does not match.) **Fix shape**: bound the gap (`address[^.]{0,20}(review|finding)`) or anchor to adjacency (`address (the |these )?(review|finding)`), then re-probe the positive set. **Promote when**: the nudge proves noisy in practice (the reviewer's own trigger), or the next edit to `skill-eval.sh`.

**Why:** Correct-as-is for now on merits, not origin: a false nudge costs one line of hook output and cannot change behavior, so tuning it did not justify another CI round on an LGTM PR.
<!-- SECTION:DESCRIPTION:END -->
