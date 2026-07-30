---
id: TASK-367
title: >-
  Reference image descriptions are keyed to the trigger row, so a re-ask never
  heals
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 367000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by TASK-364; owner screenshot is the runtime proof.** After the images failed to render, the owner asked the character "can you see them now?" and it still reported only URLs. The issue does NOT self-heal.

**Mechanism:** `persistReferenceDescriptions` writes descriptions into the TRIGGER row's `referencedMessages[].resolvedImageDescriptions`. A later reply to the SAME referenced message is a different trigger row, so the lookup finds nothing and the work is redone (or lost again). Descriptions are keyed to the asker, not to the thing described.

**Fix shape (Kimi K3 and Qwen 3.7 Max proposed this independently):** re-key description persistence to the REFERENCED message id (or the attachment content hash) rather than only the trigger row. One source of truth for all renderers, and cross-trigger caching falls out for free — a second reply to the same message should cost 0s, not another 47.8s.

Qwen adds a latency win on top: check dedup state EARLY, read the cache BEFORE running vision. First reference pays; every repeat is free.

**Related smell, same investigation:** the 4 vision calls appear to run serially (47.8s for 4 images). Parallelising them is an independent, straightforward win — file/verify separately if confirmed.
<!-- SECTION:DESCRIPTION:END -->
