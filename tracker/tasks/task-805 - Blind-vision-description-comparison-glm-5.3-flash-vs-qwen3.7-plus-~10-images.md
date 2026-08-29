---
id: TASK-805
title: >-
  Blind vision-description comparison: glm-5.3-flash vs qwen3.7-plus (~10
  images)
status: To Do
assignee: []
created_date: '2026-08-29 00:04'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 805000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner asked (2026-08-27) whether 5.3 Flash beats Qwen 3.7 Plus for image description quality; answered honestly as "no head-to-head exists" and a ~10-image blind comparison was promised as a post-beta.209 follow-up. Never filed — mining run 2026-08-28 caught the leak.

What: run ~10 real prod-representative images (varied: art, screenshots, photos, text-heavy) through both models via the vision path, blind the outputs, owner judges pairs. Per the standing LLM-judging preference, default to the hybrid shape: LLM judge screens all pairs, owner blind-reviews flagged + a calibration sample.

Acceptance: a per-pair verdict table and a recommendation (keep flash / switch back / mixed) recorded where the free-default decision can cite it.
<!-- SECTION:DESCRIPTION:END -->
