---
id: TASK-1460
title: Promote newest skipped trigger to survivor when the survivor submission fails
status: To Do
assignee: []
created_date: '2026-11-18T22:19:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1460000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 review finding #6 ideal half (PR 2769). When the released survivor is denied (newly denylisted or NSFW-gated author) or its generate call throws, releaseCycle tears the cycle down and the skipped triggers get no reply and no deferred-memory interaction; round 4 added a counts-only warn so the loss is at least observable. Improvement: promote the newest skipped message to survivor on that path so its author still gets the reply and the remaining skipped list carries forward (cap applies). This changes state-machine behavior, hence a task rather than an inline round fix. Acceptance: a denied survivor submission promotes the newest skipped trigger (tests: denial promotes; error promotes; empty skipped list releases idle as today).
<!-- SECTION:DESCRIPTION:END -->
