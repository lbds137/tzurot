---
id: TASK-687
title: Confirm which model z.ai actually serves for glm-4.5-air requests
status: Done
assignee: []
created_date: '2026-08-19 22:46'
updated_date: '2026-08-20 01:22'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 687000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the free-tier carve-out (ZAI_FREE_TIER_MODEL, constants/ai.ts:688) rests on GLM-4.5-Air billing at the coding plan cheapest 1x multiplier. Two facts put that in doubt. (a) The owner z.ai web usage chart attributes our air traffic to GLM-4.7. Our own usage_logs show we have never sent a 4.7 model string -- a 30d /admin usage read on 2026-08-19 covered 4,893 of 4,902 requests across the top five models and none was 4.7 -- so the label is theirs, not our routing. (b) z.ai own docs (docs.z.ai/devpack/overview, Usage Instruction) no longer list GLM-4.5-Air at all, list supported models as GLM-5.3 / GLM-5-Turbo / GLM-4.7, and document an automatic reroute for retired models: "Requests for previous models (GLM-5.2/GLM-5.1) will be automatically routed to GLM-5.3." If air is retired and rerouted the same way, the chart is CORRECT and we are already paying GLM-4.7 rates.

Those docs give GLM-4.7 as Input 4.6 / Cached Input 1.2 / Output 16, billed as credits = (in x inMult + cachedIn x cachedMult + out x outMult) / 10000. So this is not a flat 1x model, and a third-party blog claiming both are 1x contradicts the primary source -- do not trust the blog.

Why we cannot see it today: __includeRawResponse is deliberately OFF on the z.ai path (services/ai-worker/src/services/ModelFactory.ts:544) because extractAndPopulateOpenRouterReasoning runs unconditionally (LLMInvoker.ts:477) and is written for OpenRouter response shape. So the raw response, including its model echo, is discarded, and diagnostics modelUsed is the name we REQUESTED (LLMInvoker modelName is an input), never what was served.

What to do: run the probe at scratchpad zai-served-model-probe.ts (or re-create it -- two 1-token completions against ZAI_CODING_BASE_URL/chat/completions, one per candidate model, printing the response model field). Needs ZAI_CODING_API_KEY from the prod env.

Acceptance: the served model for a glm-4.5-air request is observed and recorded here. If it differs from what we requested, decide whether to (a) move the carve-out to the model actually being served, and/or (b) capture the served model in production -- which needs the reasoning-extractor boundary sorted first, since enabling __includeRawResponse on the z.ai path feeds z.ai responses to an OpenRouter-shaped extractor.

## ANSWERED 2026-08-19 — z.ai REROUTES air to 4.7. The chart was right.

Probe run against prod (two 1-token completions to ZAI_CODING_BASE_URL, key
from the ai-worker Railway service):

    requested=glm-4.5-air    served=glm-4.7    *** DIFFERS ***
    requested=glm-4.7        served=glm-4.7    MATCH

So the owner's z.ai usage chart was CORRECT, not mislabelling: every
`glm-4.5-air` request is served — and billed — as GLM-4.7. Two consequences,
both live in prod today:

1. BILLING. The carve-out's premise ("bills at the plan's cheapest 1x
   multiplier", constants/ai.ts:684-687) is FALSE. Guests run at GLM-4.7's
   published rates: Input 4.6 / Cached Input 1.2 / Output 16. The plan meter
   still bounds real consumption (ZaiFreeTierAdmission gate 4 reads actual
   window percentage), so nothing ran away — but the comment states a fact
   that is not true, and anyone reasoning from it reasons wrong.

2. CONTEXT, and this one costs capability. ZAI_MODEL_CATALOG gives
   `glm-4.5-air` contextLength 128_000 and `glm-4.7` 200_000
   (constants/ai.ts:418-429). getZaiCodingPlanContextLength resolves from the
   REQUESTED name, so guest turns are clamped to 128K while being served a
   200K model. 72K of context discarded per guest turn, silently.

FIX SHAPE (owner's call — it is a user-visible capability change):
point ZAI_FREE_TIER_MODEL at `glm-4.7`. It is cost-neutral by construction
because it is the same served model, and it makes the catalog metadata
(context length, docs URL, capabilities) match reality. The alternative —
leaving it — keeps a knowingly-false premise in a load-bearing constant.

STILL UNVERIFIED: whether GLM-4.5-Air had DIFFERENT multipliers before the
reroute began, i.e. whether this is a recent change or has always been so.
Nothing on our side records historical served-model, so that is unanswerable
from here and not worth chasing — what matters is the current state.
<!-- SECTION:DESCRIPTION:END -->
