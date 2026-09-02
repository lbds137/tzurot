---
id: TASK-844
title: >-
  Channel dashboard Current Value shows the viewing moderator personal override,
  not channel-scoped state
status: To Do
assignee: []
created_date: '2026-08-31 18:24'
updated_date: '2026-09-02 13:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 844000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced during the TASK-839 four-path enumeration (PR 2277). The channel dashboard resolves the full 5-tier cascade, and user-default / user-personality tiers sit ABOVE channel — so when the VIEWING moderator has a personal override for a field, their own value wins and the channel-scoped dashboard renders it as Current Value with the override badge. Another moderator opening the same dashboard sees a different Current Value. PR 2277 made Parent Value honest in this case (it equals Current, correctly meaning clearing the channel override changes nothing for THIS viewer), but whether a channel-scoped surface should resolve through the viewer personal tiers at all is a product-semantics call.

Owner decision needed (fail-closed per 06-backlog: user-visible display semantics are never an agent rule-out): (a) keep as-is — the dashboard shows what THIS viewer would experience in the channel, viewer-relative by design; or (b) resolve the channel dashboard only through hardcoded->admin->channel so it shows channel-scoped state identically for every moderator.

Fix shape if (b): the channel settings command passes a tier-scope cap to the resolve call (resolveCascade already layers tiers explicitly, so capping is a parameter, not a redesign); parentValues continues to work unchanged since it is winner-relative. Verify against services/bot-client/src/commands/channel/settings.ts:276-305 (cite from the 2026-08-31 enumeration; re-verify, cites drift).

Acceptance: owner picks (a) or (b); if (b), two moderators with different personal overrides see identical channel-dashboard values, pinned by a test.

SCOPE ADDITION (PR 2277 round-3 review, folded in as the same channel-dashboard-resolution question): when NO personality is activated in the channel, channel/settings.ts resolves via resolveUserDefaults() — a 2-tier admin+user-default merge — so resolved.sources[field] can never be 'channel' on that path: the channel's OWN overrides never surface in effectiveValue there, and the source===localSource branch of the PR-2277 parentValue rule is structurally unreachable. Predates PR 2277; same code path, same decision. Whichever option the owner picks above should also say what the no-personality path resolves through (option (b)'s hardcoded->admin->channel cap would fix both at once).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-09-02: option (b) — the channel dashboard resolves through hardcoded -> admin -> channel only, so every moderator sees identical channel-scoped state; the no-personality path resolves through the same cap. Pin with a two-moderator test.
<!-- SECTION:NOTES:END -->
