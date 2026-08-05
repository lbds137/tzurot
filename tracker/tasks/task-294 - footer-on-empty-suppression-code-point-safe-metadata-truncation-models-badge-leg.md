---
id: TASK-294
title: 'Browse polish: footer-on-empty, code-point truncation, badge legend'
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 294000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (#1709 r3/r4 observations; items a–c SHIPPED in PR-4b-2b — footer-on-empty suppression, code-point-safe metadata truncation, models badge-legend completion) — remaining item: **browse pagination failure is silent** — deferUpdate then keep-current-view on fetch failure is the deliberate cross-surface pattern (character-browse-documented), but an ephemeral error followUp is the D-family answer; decide ONCE at the builder/catalog level, not per surface. **Promote when**: the epic's error-state/catalog pass, or the next browse-pagination touch.

**Why:** The pattern is consistent today, just silently so — the decision deserves one deliberate call, not six drifting ones.
<!-- SECTION:DESCRIPTION:END -->
