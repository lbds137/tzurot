---
id: TASK-1013
title: >-
  Recent-days digest: a stale row is never swept, so unused digest text outlives
  its 7-day window
status: To Do
assignee: []
created_date: '2026-09-18 13:20'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1009000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `selectRenderableDigestText` (services/ai-worker/src/services/recentDaysDigest/recentDaysDigestRenderGate.ts) rejects a digest older than `RECENT_DAYS_DIGEST.WINDOW_DAYS`, and the sweep never selects a pair with no rows in window, so a pair that goes quiet keeps its last `digest_text` in `persona_personality_digests` unused until `/history clear` or the persona/character cascade. The only delete site is `history.ts` (`tx.personaPersonalityDigest.deleteMany`). The privacy policy retention row (beta.226) states the text is unused after 7 days; it should also be erased.
Fix shape: a nightly ai-worker scheduled job (the retention/summarize-sweep shape) that nulls `digest_text` (or deletes the row) where `generated_at` is older than the window plus a grace day and no source rows exist in window; one PGLite test per branch.
Acceptance: a row generated 9 days ago with no rows in window has null text after the sweep; a row with rows in window is untouched.
<!-- SECTION:DESCRIPTION:END -->
