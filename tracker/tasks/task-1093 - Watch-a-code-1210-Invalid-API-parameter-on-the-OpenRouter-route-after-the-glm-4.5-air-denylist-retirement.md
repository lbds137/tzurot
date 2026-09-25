---
id: TASK-1093
title: >-
  Watch: a code-1210 Invalid API parameter on the OpenRouter route after the
  glm-4.5-air denylist retirement
status: To Do
assignee: []
created_date: '2026-09-25 00:42'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1086000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2521 (TASK-702) retired RESTRICTED_PARAM_MODELS and the deny mode with it. The probe that justified it sent each of the eight formerly-denied params alone (27 calls, all 200); the review noted a combination of them was never sent together, and the per-model deny mechanism itself is gone, not just the entry.
Signal: an ai-worker error log carrying the z.ai code-1210 Invalid API parameter body on a request that went through OpenRouter (served-by Z.AI). The z.ai-DIRECT allowlist is unchanged, so a 1210 there is a different bug.
Fix shape if it fires: probe the failing param combination against z-ai/glm-4.7 via OpenRouter, then re-add a per-model deny keyed on the observed set (git has the deleted mechanism at the parent of 294dd1249).
<!-- SECTION:DESCRIPTION:END -->
