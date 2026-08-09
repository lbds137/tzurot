---
id: TASK-496
title: 'Research: GitHub stacked PRs vs our rebase-only sequential-PR workflow'
status: To Do
assignee: []
created_date: '2026-08-09 19:38'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 496000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner flag 2026-08-09 - GitHub reportedly began rolling out stacked-PR support; unverified from memory (external-system claim - probe the shipped feature via GitHub docs/changelog first, not recall). Our doc-60-style chains (PR 1 -> 2 -> 3, each based on the last) are exactly the shape stacking targets.
Fix shape: read the actual shipped feature; assess fit against REBASE-ONLY merges, gh CLI support, the ci-gate monitor flow, and claude-review per-PR; note whether dependent-PR retargeting on merge removes our manual rebase step. Output: a short recommendation (adopt / ignore / partial) to the owner.
Acceptance: recommendation delivered with the probe evidence cited; adopt-path items filed separately if any.
<!-- SECTION:DESCRIPTION:END -->
