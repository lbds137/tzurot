---
id: TASK-1580
title: Demoted own-key requests charge the shared free-tier fair-share pool
status: To Do
assignee: []
created_date: '2026-11-28T00:12:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1570000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review cycle 7 on PR 2829 found the metering seam. GenerationStep derives isFreeTier from effectiveTier === free, and the demoted standard arm (system key unresolved, D10 skip, or the low-credit proactive retarget returning null) keeps effectiveTier free while route.apiKey is still the user own key. Those requests charge the shared free-tier fair-share pool, and a full pool renders the BYOK call-to-action to a user who has a key. Degraded and edge paths only; deliberate per the PR body site-4 note, now commented at the site in PR 2829 round 8.

Owner question: should enforceGuestFreeTierQuota gate on billing identity (keyProvenance !== user) instead of effectiveTier, so own-key demoted requests stop charging the shared pool?

Recommendation: keep the conservative metering for now - gate on billing identity only if dev or prod logs show BYOK users actually hitting FREE_TIER_QUOTA on demoted own-key traffic; measure before flipping.
<!-- SECTION:DESCRIPTION:END -->
