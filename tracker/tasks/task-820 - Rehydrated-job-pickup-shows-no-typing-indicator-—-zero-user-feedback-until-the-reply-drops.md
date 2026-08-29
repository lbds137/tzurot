---
id: TASK-820
title: >-
  Rehydrated job pickup shows no typing indicator — zero user feedback until the
  reply drops
status: Done
assignee: []
created_date: '2026-08-29 16:48'
updated_date: '2026-08-29 20:10'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 820000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner UX report 2026-08-29 (post-beta.210). A pending character request that survives a restart via job rehydration resumes and completes correctly — rehydration itself is proven working in prod — but the pickup does not restart the Discord typing indicator. The user therefore gets no feedback at all between the restart and the final message landing, and cannot tell whether anything is still happening. The fresh-request path shows typing while generation runs; the rehydrated path works silently.

Fix shape: NEEDS GROUNDING before build — locate where the fresh path starts/refreshes the typing indicator (bot-client side) and what signal exists at rehydrated-job pickup (ai-worker/queue side) that could re-trigger it. The mechanism is deliberately not asserted here: no file:line was verified at filing time, and guessing the seam is how wrong-premise tasks get planted.

Acceptance: a request whose job is rehydrated after a restart shows the typing indicator again from pickup until delivery, matching the fresh-request experience.

Scope: owner call 2026-08-29 — target beta.211.
<!-- SECTION:DESCRIPTION:END -->
