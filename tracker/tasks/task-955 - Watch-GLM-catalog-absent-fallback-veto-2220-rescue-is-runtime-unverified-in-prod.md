---
id: TASK-955
title: >-
  Watch: GLM catalog-absent fallback veto (#2220) rescue is runtime-unverified
  in prod
status: To Do
assignee: []
created_date: '2026-09-13 15:53'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 952000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moved off backlog/now.md 🚨 (2026-09-13 context-budget trim); all fix shapes shipped (#2128 inherited category, #2220 catalog veto + MODEL_NOT_FOUND classification of the not a valid model ID wording).
Watch signal: a prod retarget succeeding where the Turn-B shape previously dead-ended — the footer announcing a swap on a staggered-release model, or a model_not_found (rescued) embed in the error channel. Close on that observation. Same dead-end one hop down is TASK-645. Original incident mechanism is in git history of backlog/now.md (2026-08-16/17 analysis).
<!-- SECTION:DESCRIPTION:END -->
