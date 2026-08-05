---
id: TASK-149
title: ResolvedLlmConfig carries no provider
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`ResolvedLlmConfig` carries no `provider` — cross-provider model overrides could mis-route

**Why:** The LLM cascade (`LlmConfigResolver.resolveConfig`) returns `model`/`visionModel` but no `provider`, so the gateway's job-chain stamp (#1239) and ai-worker's `AuthStep` keep the personality SEED provider. Harmless today: every `LlmConfig` is `provider='openrouter'` and `ProviderRouter` auto-promotes by model-name prefix (`z-ai/`), so routing keys off the model name, not this field. **Fix shape**: add `provider` to `LlmConfigMapper`/`ResolvedLlmConfig` and stamp the configured (pre-promotion) provider so AuthStep auto-promote still fires. **Promote when**: a user LLM config selects a model whose provider differs from the seed AND isn't derivable from the model-name prefix (a real cross-provider override exists in prod). Surfaced 2026-06-17 by PR #1239 (Bug X consolidation). Deferred 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->
