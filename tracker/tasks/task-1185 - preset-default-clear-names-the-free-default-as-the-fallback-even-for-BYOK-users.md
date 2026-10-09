---
id: TASK-1185
title: >-
  preset default clear names the free default as the fallback even for BYOK
  users
status: Done
assignee: []
created_date: '2026-10-05 19:57'
updated_date: '2026-10-09 02:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1175000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the clear route reports the AdminSettings FREE default (freeDefaultLlmConfigId / freeDefaultVisionConfigId) as the fallback for every user (services/api-gateway/src/routes/user/model-override.ts:343-372). At runtime a keyed user with no user default falls to the character default, then the GLOBAL default pointer (packages/identity/src/personality/PersonalityLoader.ts:425-444); the free default only applies in guest mode (services/ai-worker/src/jobs/handlers/pipeline/steps/guestModeOverrides.ts:178) and quota fallback (services/ai-worker/src/services/quotaFallback.ts:335). Owner hit it 2026-10-05: cleared chat + vision defaults, embed said Gemma 4 31B (Free) while the global default is GLM 5.3 Flash.

What: pick the fallback by the user tier (keyed -> global pointer, guest -> free pointer), and word it as the default for characters without their own preset, since the character default sits above the global one in the cascade. The bot-client render in services/bot-client/src/commands/preset/default/clear.ts and its comments follow. Check sibling surfaces that describe the effective default (preset default view/set) for the same mistake.

Acceptance: a keyed user clearing sees the global default name; a guest sees the free default; tests pin both branches at the route and assert the forwarded name in the bot-client embed.
<!-- SECTION:DESCRIPTION:END -->
