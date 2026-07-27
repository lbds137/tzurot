---
id: TASK-233
title: 'Watch retry volume/latency after maxRetries: 0 ships'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 233000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Watch retry volume/latency after `maxRetries: 0` ships — The 429-storm fix (#1556) set `maxRetries: 0` on both ChatOpenAI builds, moving ALL retry responsibility onto LLMInvoker's outer ladder. Net effect for transient 5xx blips: the SDK's in-attempt retries (which could absorb a brief blip inside one 3-min window) are gone, so a 5xx now consumes a full outer-ladder attempt instead. Intended for 429s (kills the ~9-min burn) but changes retry timing/volume against upstream for the 5xx class too. **Promote when**: post-#1556 prod metrics show attempt-count or latency regression on transient-5xx bursts (or a user reports slower recovery from a provider blip). Surfaced 2026-07-08 (PR #1556 round-2 review).

**Why:** Confirm the blast radius is benign, not just intended.
<!-- SECTION:DESCRIPTION:END -->
