---
id: TASK-570
title: >-
  Inverted-window warn-once flag never re-arms - standing misconfig goes silent
  after log rotation
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 570000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: FreeTierRequestQuota.ts:63-90 warnedInvertedWindowBounds is set on first inverted decision and never resets: a long-lived worker under standing misconfiguration warns once per process lifetime, so after Railway log retention rolls there is zero remaining signal; the flag also never re-arms when the config is corrected and later re-inverted with different values. Per-call flood-avoidance rationale is sound.

Fix shape: per-config-snapshot re-arm (reset the flag when the pair becomes valid).

Source: 2026-08-12 review, ai-worker LOW-5 CONFIRMED (deliberate tradeoff, triage cost noted).
<!-- SECTION:DESCRIPTION:END -->
