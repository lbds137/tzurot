---
id: TASK-63
title: Make the vision system-fallback daily cap a runtime admin-settings knob
status: To Do
assignee: []
created_date: '2026-06-14 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make the vision system-fallback daily cap a runtime admin-settings knob

**Why:** The per-user daily cap on system-key free-vision fallback (`VISION_SYSTEM_FALLBACK_DAILY_LIMIT`, a code constant = 100) should become a runtime admin-settings item so the owner can tune it without a code change + redeploy. Gemma is $0, so the cap purely protects the shared rate-limit pool; the right value depends on observed traffic, which argues for runtime tunability. `VisionFallbackQuota` already takes `dailyLimit` as a constructor param, so the wiring is "resolve the configured value and pass it in," not a logic change — thread it through the `adminSettings` layer (DB-backed `adminSettings` + gateway admin config + bot-client admin UI), falling back to the constant default. **Start**: `services/ai-worker/src/services/VisionFallbackQuota.ts`; the `adminSettings` resolution path in ai-worker. **Promote when**: the owner wants to tune the cap from observed traffic without a deploy. Surfaced 2026-06-14; triaged 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->
