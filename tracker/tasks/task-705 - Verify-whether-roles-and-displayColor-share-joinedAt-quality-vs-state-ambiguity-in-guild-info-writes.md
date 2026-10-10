---
id: TASK-705
title: >-
  Verify whether roles and displayColor share joinedAt quality-vs-state
  ambiguity in guild-info writes
status: To Do
assignee: []
created_date: '2026-08-20 17:55'
updated_date: '2026-10-10 20:31'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 705000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2160 review (Medium), building on the #2152 second-look. The producer extractGuildInfoFromMember (services/bot-client/src/services/channelFetcher/ParticipantContextCollector.ts:39-57) derives roles and joinedAt INDEPENDENTLY from the GuildMember - roles from .roles.cache (with an undefined guard proving partial members exist), joinedAt from .joinedAt. A partially-hydrated member could plausibly emit { roles: [], joinedAt: <date> }, which passes isEmptyGuildInfo (joinedAt non-empty) and then the always-write update clobbers a stored real role list with [] - the identical quality-vs-state failure #2160 fixed for joinedAt. displayColor is similarly roles-cache-derived (displayHexColor defaults #000000 -> undefined when the cache is empty). Code-read only; the write-site comment in guildMemberInfoStore.ts carries the hedge.

Fix shape, two halves: (1) runtime capture first - log or capture whether the degraded shape ({roles absent-from-cache, joinedAt present}) actually occurs (00-critical: code-reading is not runtime verification); (2) if it does, the producer already HAS the degradation signal (member.roles === undefined) - emit roles: undefined instead of [] there, make roles optional through the schema/GuildMemberInfo type, and give the store the same omit-when-uncarried treatment joinedAt got. A genuinely role-less member (cache resolved, empty) keeps emitting [] and keeps always-write semantics.

Acceptance: the runtime question is answered with a capture or a deliberate decision not to instrument; if the shape is real, roles/displayColor get per-field write-back pinned by tests mirroring the joinedAt pair.

Phase 1 SHIPPED in #2601 (2026-10-10): the `guildInfoAmbiguousRoles` capture (info level) logs the ambiguous shape only when the reading is genuinely ambiguous - roles-cache size 0 or the roles manager absent (`rolesCacheSize: -1` marker); the resolved-but-role-less size-1 case is deliberately unlogged (expected majority, no diagnostic value; the phase-2 fix keys on the roles manager being absent, not cache emptiness, so the size-1 rate is not needed). Phase 2 (the per-field write-back) and the `debug:` cleanup PR both PROMOTE-WHEN: prod logs show `guildInfoAmbiguousRoles` at a non-trivial rate (grep the tag after the next release deploys; the cleanup removes the capture and its tests once the evidence is in).
<!-- SECTION:DESCRIPTION:END -->
