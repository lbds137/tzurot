---
id: TASK-1162
title: >-
  Channel-scoped model/preset override: let a moderator set one preset for
  everyone in a channel
status: To Do
assignee: []
created_date: '2026-10-04 16:46'
labels:
  - 'area:bot-client'
  - 'area:config-resolver'
  - 'size:L'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: user question 2026-10-04: "Is it currently possible to set an edited model for everyone on the channel? I want to test different configurations. I previously saw that it could only be used for myself with my own API." Answer from the code: no. The channel tier of the config cascade (ChannelSettings.configOverrides, packages/config-resolver/src/ConfigCascadeResolver.ts, schema packages/common-types/src/schemas/api/configOverrides.ts) carries only behaviour knobs (maxMessages, maxAge, memoryLimit, history render modes, voice modes, showModelFooter ...) and NO model or preset key; model selection resolves through LlmConfigResolver (user override per character, then personality). So a preset can be set only per user (/preset override set, /preset default set). Related records: TASK-529 (owner ruled 2026-08-14: channel tier is a DEFAULT, never policy; user tiers beat it), doc-9 Phase 2 (UserChannelConfig tier, gated on doc-15), doc-75 (Guild / Server Management), TASK-110 (channel layer of prompts, a different axis). Open design points: a channel preset would bill each INVOKER own key or the guest floor, not the moderator (the asker BYOK key cannot pay for others); per TASK-529 a user own override would still win, which defeats the stated testing use unless they clear theirs.
Owner question: Should a moderator-set channel preset be a pure default (below each user own override, per TASK-529), or does this request reopen enforcement for the model field only?
Recommendation: Build it as a channel-tier default gated on Manage Messages and keep TASK-529 ruling (user override wins) - it stays consistent with the ruling, and the testing use case is served by showing in /channel settings which members have a personal override. Scope as a doc-9 Phase 2 / doc-75 Phase 2 member, not a standalone feature.
<!-- SECTION:DESCRIPTION:END -->
