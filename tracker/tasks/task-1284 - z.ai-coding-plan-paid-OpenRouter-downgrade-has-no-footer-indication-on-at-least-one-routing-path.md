---
id: TASK-1284
title: >-
  z.ai coding-plan -> paid OpenRouter downgrade has no footer indication on at
  least one routing path
status: To Do
assignee: []
created_date: '2026-10-25 03:01'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1272000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner report from prod 2026-10-25 (hedged, not log-verified): a z.ai-family turn served via PAID OpenRouter (user has their own OpenRouter key) after the coding plan was unavailable showed a model footer with NO fallback indication. Her framing: maybe keyed-user fallback is expected, but silent cost-bearing downgrades look odd.

Mapped architecture (code-read, 2026-10-25): ProviderRouter auto-promotes OpenRouter z-ai/<model> requests to z.ai-direct when a zai-coding key exists and the model is on the plan catalog; promotedRoute carries a fallback object so GenerationStep can swap back to OpenRouter if the promoted request fails. The sender (DiscordResponseSender) renders two signals into buildModelFooterText: fallbackProviderAttempted (promotion attempted AND failed) and fallbackFromProvider (a served fallback swap). Candidate gap: when plan unavailability is known at ROUTING time (free-tier quota gate / headroom), the request routes straight to OpenRouter - no promotion attempt, no served swap, neither flag sets, and the footer shows the model as configured even though the turn is now cost-bearing on the user key.

Acceptance: trace which routing paths set which flags for the coding-plan->OpenRouter case (promotion-failure swap, quota-gate upfront route, keyed vs free user); decide per path whether the footer should annotate (a paid downgrade is cost-bearing - the argument for yes is the same one that built the existing two signals); implement the missing flag(s)/footer copy; add the swap-mutation test. If silent-by-design wins for some path, document it in the footer-builder docstring.
<!-- SECTION:DESCRIPTION:END -->

## Trace findings (2026-10-25, owner-authorized prod-log pull)

Per-path verdict, from code (ProviderRouter.ts, AuthStep.ts, autoPromotionFallback.ts, discord.ts `buildModelFooterText`):

1. **Auto-fallthrough - THE GAP.** Configured `zai-coding`, user has NO z.ai key -> OpenRouter serves from the FIRST call (no swap ever happens). With a paid OpenRouter key (`source: 'user'`, `isGuestMode: false`) the footer renders `• via OpenRouter` only - indistinguishable from a deliberately-OpenRouter preset. `fallthroughTriggered` is consumed solely for the personality provider/model rewrite (AuthStep) + a debug log; it never reaches result metadata. Keyless users don't hit this: no OpenRouter key -> system key + guest mode -> guest footer explains free serving.
2. **Auto-promotion, served swap** - covered: `effectiveProviderUsed` -> `fallbackFromProvider` -> `• via Z.AI Coding Plan → OpenRouter (fallback)`.
3. **Auto-promotion, both routes failed** - covered: `fallbackProviderAttempted` -> `• via Z.AI Coding Plan → OpenRouter (both routes failed)` + appended technicalMessage summary.
4. **Quota-gate upfront demotion** - covered: `quotaFallback` passthrough renders the swap reason on the model line.

Runtime probe (prod ai-worker logs, 15h window 10-24T12:13Z -> 10-25T03:15Z; the logging IS deployed - bf0494d10 is on main): 3 auto-promotions (one user, `z-ai/glm-5.3-flash`, all served z.ai-direct), **0 fallthroughs**. The reported turn predates the window; not pinned (needs requestId or per-deployment reach-back). The gap verdict is code-level and does not depend on finding the turn: path 1 cannot render an annotation today.

Fix shape (recommended): thread `fallthroughTriggered` ProviderRouter -> AuthStep -> result metadata -> bot-client passthrough, set `fallbackFromProvider: 'zai-coding'` on the metadata when it fires; `buildProviderAttribution` then renders the chain with zero new footer vocabulary. Open wording call for the owner: `(fallback)` reads as a mid-request retry, but path 1 is upfront routing - `(coding plan unavailable)` may be the honest suffix; whether the bare `• via Z.AI Coding Plan → OpenRouter` chain (no parenthetical) suffices is the taste call.

## Owner routing matrix + ruling lean (2026-10-25)

Owner-supplied: the plan upgrade fires (1) for keyless free users on GLM 5.3 Flash (piggyback admission - has its own footer line) and (2) for users with a coding-plan key ("via Z.AI Coding Plan"). OpenRouter-keyed users without a plan key stay on OpenRouter by design (path 1 above). Their footer is accurate for THEIR credentials - the zai-coding provider that creates the apparent mismatch is usually the persona AUTHOR's config, invisible to the user, so a "no coding-plan key" annotation would explain a config the user never set. Owner lean: no change needed. Recommendation updated 10-25: leave the footer as-is; if this confusion pattern recurs, the lever is a one-time persona-selection/settings note ("serves via your OpenRouter key - per-token applies"), not a per-turn footer suffix. Pending final ruling: close as by-design (footer-builder docstring note recording why path 1 renders bare) vs annotate.

**Ruling state (2026-10-25, late):** the owner endorsed the `(no coding plan key)` suffix BEFORE seeing the updated recommendation (withdraw the annotation; close as by-design), and flagged the race. Both options are live pending an informed one-word pick (`annotate` / `by-design`). Orchestrator's current read after the race: annotate - the suffix describes the USER's credential set (theirs to know), not the author's config, and the per-turn-noise cost is bounded by the fallthrough population itself (0 turns in the 15h prod window), so the annotation renders almost never and clarifies exactly where it fires.
