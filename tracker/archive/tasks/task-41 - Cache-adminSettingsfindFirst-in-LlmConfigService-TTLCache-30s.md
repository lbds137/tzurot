---
id: TASK-41
title: Cache adminSettings.findFirst in LlmConfigService (TTLCache ~30s)
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-07-29 01:49'
labels:
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cache `adminSettings.findFirst` in `LlmConfigService` (TTLCache ~30s)

**Why:** S4a's `getDefaultPointerSets` adds a singleton `adminSettings.findFirst` to every `list()` call (admin: 2 queries; user: 3). The `AdminSettings` row only changes when an admin reassigns a default — the 30s `TTLCache` pattern in `bot-client/src/utils/gatewayServiceCalls.ts` (`channelSettingsCache`; its sibling `adminSettingsCache` runs 60s) is the established fix. **Fix shape**: wrap the pointer read in a TTLCache (~30s), invalidating on `setAsDefault`/`setAsFreeDefault`/delete-guard writes. **Why not now**: list isn't a hot path + an indexed singleton read is cheap; caching adds invalidation wiring. **Promote when**: list latency matters, or opportunistically when next touching `LlmConfigService.list` (e.g. Phase B). Surfaced 2026-06-29 (PR #1394 / S4a review).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RULED OUT 2026-07-28 (owner-invited council pass: GLM 5.2, Kimi K2.7-code, Qwen 3.7 Max — unanimous, agreeing with the agent assessment). Grounds: saves one sub-ms indexed singleton read on a cold human-UI path already shielded by the bot-side 60s autocomplete cache; the project cache decision tree fails all three gates; and a cached pointer read is a latent trap — the same pointer columns back the consistency-critical delete-guard and VisionConfigResolver, where a stale read would let an admin delete a just-promoted default. Reopen condition (Qwen): the list path becomes genuinely hot or a high-frequency consumer bypasses the client-side cache — the fix shape as filed remains sound then.
<!-- SECTION:NOTES:END -->
