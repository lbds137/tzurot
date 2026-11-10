---
id: TASK-1382
title: Investigate NanoGPT as an alternative to OpenRouter
status: To Do
assignee: []
created_date: '2026-11-10T05:27:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1365000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: OpenRouter is the per-token route for model families the flat-rate plans do not carry (character chat, vision fallback, BYOK users). Lila (2026-11-10) asked to evaluate NanoGPT as an alternative provider.

What: a research spike, no code. Compare NanoGPT against OpenRouter on: model catalogue coverage for the families Tzurot routes today; pricing per token and any subscription option; OpenAI-compatible API shape (streaming, tool calls, reasoning params, vision input, the 200-with-error body handling OpenRouter needed); provider routing or ignore-list controls (see TASK-1261); data-retention and training policy; rate limits and BYOK fit. Note any xAI/Grok-only routes as excluded.

Acceptance: a short findings note in docs/local/ with a recommendation (adopt as a provider, adopt for specific families, or rule out with the reason), and follow-up tasks filed if adopting.
<!-- SECTION:DESCRIPTION:END -->
