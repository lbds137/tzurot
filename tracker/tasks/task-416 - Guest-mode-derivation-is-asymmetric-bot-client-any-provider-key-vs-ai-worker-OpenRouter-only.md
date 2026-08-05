---
id: TASK-416
title: >-
  Guest-mode derivation is asymmetric: bot-client any-provider key vs ai-worker
  OpenRouter-only
status: Done
assignee: []
created_date: '2026-08-03 21:09'
updated_date: '2026-08-05 03:57'
labels:
  - 'size:M'
  - 'area:bot-client'
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 416000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a user whose only active BYOK key is ElevenLabs/Mistral/z.ai sees the full-access UI (no Guest Mode preamble in /preset browse, no strikethrough, paid presets selectable) but generation still substitutes the free model and shows the free-model footer — the two services answer "is this user a guest" differently.
Evidence (re-verified on develop): bot-client derives from ANY active key — preset/browse.ts:336,377 and preset/override/guestModeValidation.ts:93 use walletResult.data.keys.some(k => k.isActive); ai-worker derives from the OpenRouter key alone — ApiKeyResolver.ts:106 defaults provider to AIProvider.OpenRouter, :139-142 sets isGuestMode on the system-key branch, AuthStep.ts:332.
Nuance (claude-review on the doc PR, verified): ai-worker is not strictly OpenRouter-only — ProviderRouter.tryAutoPromoteToZai (:244-281) exits guest mode for a zai-coding-key holder when the resolved preset targets a z-ai/<model> on the coding-plan catalog. So the honest current semantic is "OpenRouter key, OR zai-coding key for z.ai-catalog presets" — which strengthens the case that chat guest-mode should key on chat-capable providers generally.
Fix shape: owner call on which semantic wins (chat guest-mode should probably key on chat-capable providers), then align the other side + the upsell/strikethrough surfaces.
Acceptance: both services agree on guest-mode for a user holding only a non-OpenRouter key; the BYOK manual pass (Pass E known-asymmetry note in BYOK_MANUAL_TESTING.md) is updated to assert the chosen behavior.
Surfaced by the TASK-408 doc rewrite.

OWNER CALL 2026-08-04: the CHAT-CAPABLE-KEYS semantic wins — guest mode = no chat-capable key (OpenRouter, or z.ai-coding for z.ai-catalog presets). Align bot-client (preset/browse.ts, guestModeValidation.ts) to ai-worker's actual behavior so ElevenLabs/Mistral-only users see the Guest Mode preamble/strikethroughs honestly. Update the BYOK_MANUAL_TESTING.md Pass E known-asymmetry note to assert the chosen behavior. Now agent-runnable.
<!-- SECTION:DESCRIPTION:END -->
