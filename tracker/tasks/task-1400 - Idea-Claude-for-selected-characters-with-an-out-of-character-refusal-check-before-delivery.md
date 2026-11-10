---
id: TASK-1400
title: >-
  Idea: Claude for selected characters, with an out-of-character refusal check
  before delivery
status: To Do
assignee: []
created_date: '2026-11-10T22:29:00Z'
labels:
  - area:ai-worker
  - size:L
  - state:owner
dependencies: []
priority: medium
ordinal: 1383000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner mostly stopped chatting with her characters. The default model (GLM 5.3 Flash) reads samey (see TASK-1346 for one tic), and she rates Claude models highest. Idea relayed by the Chats session on 2026-11-10 at her request; held, not a start order (her 11-04 ruling: loose ends first, no new epics until she says).

What: let Claude serve selected characters (or her own user default) while GLM stays the global default. Two parts:
1. Out-of-character refusal check before delivery. A completion where the model steps out of the character to decline or moralize is a normal 200, so the existing fallback never fires: quotaFallback.ts only reroutes on error categories such as PROVIDER_CONTENT_REFUSED (quotaFallback.ts ~66, ~161-169), and LLMInvoker.ts ~739 reads only a structured `refusal` field. Add a judge (cheap model or phrase match) between generation and send; on an out-of-character refusal, drop the reply and rerun on the fallback model. Her bar: one more in-voice moralizing refusal and the experiment is over.
2. Funding and route. Idea: the monthly Anthropic API credit instead of OpenRouter per-token. UNVERIFIED: whether a plain Console API key draws from that credit, and whether Tzurot reaches Anthropic directly or via OpenRouter with her own key. The credit lane belongs to the Deck session; any spend change goes through Deck and her.

Not caught by the check: a reply that stays in voice but plays the character timid. Only she can judge that, per character. A fair test uses the characters she liked talking to most, on current models (the one character she remembers being refused has a premise likely to be declined anyway, so it is weak evidence).

Owner question: Pick up the Claude-for-selected-characters experiment (refusal check first), and when?
Recommendation: after the provenance loose ends close — build the out-of-character refusal check first and measure it on GLM traffic before any Claude spend, so the guard exists before the first Claude reply reaches her.

Acceptance: an out-of-character refusal from the primary model is never delivered; the fallback model answers instead; she has run her chosen characters on Claude and ruled on the result.
<!-- SECTION:DESCRIPTION:END -->
