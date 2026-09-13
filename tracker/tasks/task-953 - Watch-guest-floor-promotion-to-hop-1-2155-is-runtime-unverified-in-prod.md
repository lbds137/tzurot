---
id: TASK-953
title: 'Watch: guest floor promotion to hop 1 (#2155) is runtime-unverified in prod'
status: To Do
assignee: []
created_date: '2026-09-13 15:53'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 950000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moved off backlog/now.md 🚨 (2026-09-13 context-budget trim); fix merged 2026-08-20 as #2155 (TASK-694 Done); dev cannot force an upstream 429 so only prod can verify.
Watch signal: the ai-worker log line No hop-1 retarget available — promoting the floor to the hop-1 target rescuing a real guest turn during a rate-limit window. Close on that observation. Edge-hardening follow-up: TASK-697. Mitigation available: point the free-default preset at openrouter/free directly.
<!-- SECTION:DESCRIPTION:END -->
