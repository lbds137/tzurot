---
id: TASK-1010
title: voiceArms eval harness renders neither characterBlurbs nor recentDaysDigest
status: To Do
assignee: []
created_date: '2026-09-18 03:17'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1006000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2446 review (round 3): services/ai-worker/src/services/eval/voiceArms.ts calls buildVolatilePrefix without wiring characterBlurbs (pre-existing) or recentDaysDigest (new), so an eval run for a personality that has roster blurbs or the digest enabled renders a prompt that diverges from real traffic — a voice/register comparison made with it would be measuring a prompt prod never sends. Not a prod defect; a measurement-validity gap in the harness.
Fix shape: give voiceArms an optional fetch of both enrichments through the same ContextDataSource path ContextStep uses (or accept them as inputs from the caller), so an arm can be run with or without them and the run records which; pin with one test that the prefix carries a supplied digest.
Acceptance: an eval arm for a digest-enabled pair renders the same <recent_days> block the pipeline would, or the run output states the enrichments were omitted.
<!-- SECTION:DESCRIPTION:END -->
