---
id: TASK-1033
title: >-
  Vision prompt: NSFW-gated context so adult artwork is described rather than
  refused
status: To Do
assignee: []
created_date: '2026-09-21 15:02'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1027000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner observation 2026-09-21 (a community thread showing Gemini describing hentai and recognizing characters and fandoms under a plain context prompt, while our chain increasingly gets refusals from the newer Qwen and GLM tiers). Our vision user prompt is neutral (services/ai-worker/src/services/multimodal/VisionProcessor.ts:321, the archival-purposes instruction) and the system message is the un-substituted isDefault system_prompts row (services/ai-worker/src/services/DescriptionPromptService.ts:26-27, chosen deliberately because descriptions are cached model-agnostically and shared across personalities). Neither says the platform is age-gated or that sexual artwork should be described factually, and nothing about the channel reaches the vision job: a grep for isNsfwChannel and nsfwVerifiedAt across services/ai-worker/src finds only the account-export files. A vision model given no intent guesses conservative, which is what safety tuning rewards.
Fix shape: (1) plumb the channel NSFW flag (bot-client already computes it, services/bot-client/src/utils/nsfwVerification.ts) onto the vision job payload; (2) when set, add a dedicated vision context block to the describe call stating the platform context plainly (age-verified adult community, fictional artwork, describe factually including sexual content, recognize characters and fandoms, no moralizing) - honest context, not a jailbreak; SFW channels keep the current prompt unchanged; (3) design constraint: VisionDescriptionCache is keyed by attachment id or URL hash with no framing dimension, so a description produced under the NSFW block would later be served in a SFW channel and vice versa - either fold the framing into the cache key or accept it on the argument that a factual description is factual in both, and record which; (4) check by live probe whether the provider request can carry Gemini safety thresholds (a grep for safetySettings, BLOCK_NONE and HarmBlockThreshold across services/ai-worker/src and packages/common-types/src finds nothing today) and whether OpenRouter forwards them. Out of scope: any model or framing that ignores the minors classifier; that wall stays.
Acceptance: an owner smoke on dev in an NSFW channel with an image the current chain refuses yields a description on tier 1 (no advance logged), the same image in a SFW channel keeps current behavior, and /inspect shows which prompt variant ran. Companion: TASK-899 (model choice for the chain tail) stays separate; this task is prompt context only.
<!-- SECTION:DESCRIPTION:END -->
