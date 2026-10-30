---
id: TASK-1328
title: >-
  Multi-tag NSFW gate runs once per slot: N tags produce N identical
  verification prompts
status: To Do
assignee: []
created_date: '2026-10-29T22:21:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1311000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod incident evidence in TASK-770 (4x "Interaction blocked - user not NSFW verified" for one message tagging 4 characters). The nsfw gate runs per slot inside PersonalityChatManager.runGates, so one message with N tagged characters posts N identical verification prompts. TASK-770 suppression (separate unit) removes the generic denial but leaves the duplicates — the acceptance "exactly one response naming age verification" arguably needs a per-fan-out decision reuse (the coordinator knows all slots share the user context; first gate result could be memoized for the remaining slots).
What: decide the plumbing (memoize the gate decision per fan-out in the coordinator, or dedupe sends in nsfwVerification) and implement with tests.
Acceptance: one message with N tagged characters from an unverified user yields exactly one verification prompt.
<!-- SECTION:DESCRIPTION:END -->
