---
id: TASK-269
title: 'BYOK extraction billing'
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
labels: []
dependencies: []
ordinal: 269000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

BYOK extraction billing — quota-burn trigger — Fact extraction bills the SYSTEM key only (z.ai coding plan when extractionProvider='zai-coding'; OpenRouter fallback) — verified in resolveExtractionProvider; no per-user key lookup exists. Owner call: fine unless organic extraction meaningfully burns the coding-plan quota (this week's 62% was backfill-dominated — an anomaly). **Fix shape**: per-user key attribution needs a design pass (batches span multiple users per personality-channel) + the consent disclosure the onboarding-DM theme already notes (billing a user's key for background work they didn't invoke must not be silent). **Promote when**: a normal (non-backfill) week shows extraction consuming a significant share of the weekly coding-plan quota. Surfaced 2026-07-14 (z.ai usage-uptick investigation).

**Why:** The dashboard IS the tripwire — owner checks it anyway; next normal week is the baseline read.
<!-- SECTION:DESCRIPTION:END -->
