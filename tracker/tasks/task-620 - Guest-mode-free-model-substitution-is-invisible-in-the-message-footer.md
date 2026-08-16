---
id: TASK-620
title: Guest-mode free-model substitution is invisible in the message footer
status: Done
assignee: []
created_date: '2026-08-15 16:24'
updated_date: '2026-08-16 23:09'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 620000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the model-fallback footer exists FOR transparency, and the guest/free path is the one case where it never fires. Owner-reported 2026-08-15 with a prod screenshot: one message footer read glm-4.5-air via Z.AI Coding Plan, the very next read openrouter/free via OpenRouter, both carrying the same generic free-model line and both marked auto. Nothing said a substitution happened or why.

Mechanism, grounded: QuotaFallbackInfo (ai-worker/src/services/quotaFallback.ts:68-73) carries fromModel, toModel, category, mode, and the footer renders it inline at common-types/src/constants/discord.ts:386-389 as from arrow to (reason). It is populated on exactly two paths, reactive at quotaFallbackRunner.ts:170-175 and proactive at AuthStep.ts:286-291. The guest path sets NEITHER: applyGuestModeOverrides (ai-worker/src/jobs/handlers/pipeline/steps/guestModeOverrides.ts:54-126) returns only the rewritten personality, there is no quotaFallback in its return shape, and AuthStep.ts:471-489 returns without one. The swap is recorded only to the internal logger, Guest mode overriding paid model with free model, which never reaches Discord.

TWO distinct silent events, and they mean different things to a user: (a) guest-mode admission-time override, the configured paid model replaced by the free floor; (b) the floor itself degrading, getFreeTextFloor (ai-worker/src/services/freeFloors.ts:22-25) reads admin setting fallbackTextModelFree and falls back to the hard-coded FREE_ROUTER_MODEL openrouter/free (common-types/src/constants/ai.ts:184) when that setting is unset or names a model that is not actually free.

Fix shape: wiring, not new machinery. Construct a QuotaFallbackInfo on the guest path with a new category (guest-mode, plus a second for the floor degradation) and thread it back through AuthStep return. mode is proactive, since this is an admission-time decision like the doomed-model case. The render side already handles everything downstream once the field is populated; QUOTA_FALLBACK_REASON needs the new category strings.

Acceptance: a guest-mode generation whose model was substituted shows the from arrow to (reason) segment in its footer exactly as a quota fallback does; the floor-degradation case is distinguishable from the ordinary guest-mode case; both are covered by a footer-builder test.
<!-- SECTION:DESCRIPTION:END -->
