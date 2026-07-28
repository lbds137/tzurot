---
id: doc-43
title: >-
  Idea: BYOK-first extraction billing — offload extraction cost to the persona
  owner's own keys (owner directive 2026-07-10)
type: other
created_date: '2026-07-28 11:11'
---

## BYOK-first extraction billing — offload extraction cost to the persona owner's own keys (owner directive 2026-07-10)

Owner: "I want to offload the cost onto users as much as possible... only the free users are gonna be freeloading." Resolution chain per extraction batch (attribution is already clean — each batch belongs to one persona, usage rows already attribute to `persona.ownerId`): user's own z.ai coding plan → user's OpenRouter credits → system z.ai plan (free users land here, bounded by the existing tripwire). `z-ai/glm-5.2` is reachable via both providers, so one model serves every hop. **Design wrinkles to solve**: (1) busy-handling scope splits by FAILURE CLASS (owner nuance 2026-07-10): a z.ai **upstream outage/peak** hits every coding-plan key at once — queue-wide pause stays CORRECT there, and the useful escape hop is OpenRouter (third-party hosts serve GLM-5.2 on independent infra — "that's the whole point of OpenRouter") for users with OR credits; only **per-key window exhaustion** (5h/weekly personal limits) is key-scoped and warrants per-job delay so one user's exhausted plan doesn't stall others. The z.ai 429 business-code classifier (`docs/proposals/backlog/free-tier-zai-piggyback.md` § error-code research) distinguishes exactly these classes — busy codes (1302/1305/1313) → queue-wide, window-exhausted (1308+) → per-key; (2) consent surface — DECIDED (owner 2026-07-10): disclosed in the first-use onboarding DM (`doc-6` Phase 3), not silent; (3) budget scope becomes per-payer (owner-protective cap shouldn't block a user spending their own money). **Consolidation candidate**: this + the GLM-4.5-Air piggyback (slice 2) + fair-share quota + admin-settings runtime config are facets of ONE cost-attribution/quota architecture — consider a single design boulder instead of piecemeal slices.

