---
id: TASK-760
title: Fall back through the model cascade on invalid-model errors
status: To Do
assignee: []
created_date: '2026-08-24 11:40'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 760000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.207 smoke test surfaced that a persona whose LLM config names a model OpenRouter rejects (400 model-not-found) errors at the user with no recovery. The UI validates at save time, so the realistic prod trigger is a model being DELISTED from OpenRouter after being configured — every persona on that config then hard-errors until the owner notices. Owner suggested the fallback during the smoke session.

Fix shape: treat provider 400 invalid-model responses as a retarget trigger in ai-worker, reusing the quota-fallback machinery (services/ai-worker/src/services/quotaFallback.ts — classifyQuotaFailure and the retarget path in GenerationStep/AuthStep), which already announces swaps in the reply footer so the substitution is never silent. Needs a classifier addition for the model-not-found shape plus a decision on cascade target (same as quota fallback vs global default).

Acceptance: a persona pointed at a nonexistent model produces a normal reply via the fallback model with the footer announcing the swap; the error channel still receives a report of the misconfiguration.
<!-- SECTION:DESCRIPTION:END -->
