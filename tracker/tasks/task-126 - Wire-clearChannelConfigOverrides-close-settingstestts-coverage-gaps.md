---
id: TASK-126
title: Wire clearChannelConfigOverrides + close settings.test.ts coverage gaps
status: To Do
assignee: []
created_date: '2026-05-28 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Wire `clearChannelConfigOverrides` + close `settings.test.ts` coverage gaps

**Why:** PR-2g registered `clearChannelConfigOverrides` in the manifest (DELETE `/user/channel/:channelId/config-overrides`) and generated the corresponding `userClient` method, but `services/bot-client/src/commands/channel/settings.ts` doesn't yet call it — the dashboard has no "Reset to defaults" UX path. Stub deliberately omits the method to keep the test contract honest. Three related coverage gaps in `settings.test.ts` were flagged by claude-bot across multiple review rounds and all naturally land alongside the DELETE wiring: (1) `handleChannelSettingsButton` describe block only covers failure path (~lines 406–441) — happy-path test confirming `createUpdateHandler`'s channelId binding end-to-end is missing; (2) `updateChannelConfigOverrides` failure branch at `settings.ts:231-234` is not exercised — the user-visible error message goes untested; (3) the "should display settings dashboard embed with permission" test (~line 200) doesn't assert `stub.resolveCascade.toHaveBeenCalledWith('personality-123', { channelId: 'channel-123' })` — the channel-scoping contract is the load-bearing argument and goes unverified. **Fix shape**: add a "Reset to defaults" button to the channel settings dashboard wired to `userClient.clearChannelConfigOverrides(channelId)`; extend `UserClientStub` with the method; add the three test fixtures while the file is open. **Promote when**: dashboard UX work adds a "Reset to defaults" surface for channel config overrides, OR a user requests one-click clearing. Surfaced 2026-05-28 by PR #1110 post-autosquash + post-merge claude-bot reviews. Deferred 2026-05-28.
<!-- SECTION:DESCRIPTION:END -->
