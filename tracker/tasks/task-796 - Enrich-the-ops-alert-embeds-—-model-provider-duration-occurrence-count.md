---
id: TASK-796
title: 'Enrich the ops-alert embeds — model, provider, duration, occurrence count'
status: To Do
assignee: []
created_date: '2026-08-28 19:05'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 796000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner side-note 2026-08-28 on the Tzurot Log channel. The timeout (rescued) cards carry Source, Stack Hash, Outcome, Request ID and nothing else. Two cards seven hours apart shared stack hash 99b2172f and nothing on either card said so, so a recurring failure reads as two unrelated blips.

What: add to the alert embed — which personality, which model, which provider, how long the turn ran before the fallback caught it, and an occurrence count for the stack hash (at minimum "Nth occurrence", ideally within a window).

Acceptance: a rescued-timeout card answers "is this new or is this the same thing again" and "what was it talking to" without opening Railway logs.
<!-- SECTION:DESCRIPTION:END -->
