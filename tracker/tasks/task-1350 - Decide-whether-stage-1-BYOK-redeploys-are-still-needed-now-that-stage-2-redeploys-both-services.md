---
id: TASK-1350
title: >-
  Decide whether stage 1 BYOK redeploys are still needed now that stage 2
  redeploys both services
status: To Do
assignee: []
created_date: '2026-11-04T18:28:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1333000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-directed filing 2026-11-04 (PR #2676 residue, previously declined there as an owner call): stage 2 already redeploys both services itself, so stage 1 redeploys may cost one extra restart per service per rotation. The counter-argument - rows written between the stages on the pre-rotation process land on PREVIOUS and are swept up by stage 2 - was plausible but never checked against every writer path. If dropped, verify each writer path first (03-database rule: trace WRITE then READ then external effect for each kept item).
<!-- SECTION:DESCRIPTION:END -->
