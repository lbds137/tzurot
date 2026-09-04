---
id: TASK-696
title: Best-effort cleanup or notice for orphaned echo chunks on a mid-send failure
status: To Do
assignee: []
created_date: '2026-08-20 03:51'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 696000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2154 round-3 review, design note. The chunked /chat echo sends all chunks before persisting; a chunk-2+ send failure (rate limit, blip) leaves earlier chunks POSTED in the channel, attributed to the user via the **Name:** prefix, with no history rows and no reply - bystanders see a stray partial message and a silent bot. Deliberate trade-off (visible-but-unrecorded beats partially-recorded, pinned by test), but the UX of the orphan is unaddressed.

Fix shape: on a later-chunk send failure, best-effort delete the already-posted chunks (or edit a truncation notice onto the last one) before rethrowing; failure of the cleanup itself stays fail-soft.

Acceptance: a mid-send failure leaves the channel either clean or carrying an explained artifact, pinned by a test on the cleanup path.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER RULING (C10): edit a truncation notice onto the last posted chunk on a mid-send failure; never delete already-posted chunks. state:ready.
---
<!-- COMMENTS:END -->
