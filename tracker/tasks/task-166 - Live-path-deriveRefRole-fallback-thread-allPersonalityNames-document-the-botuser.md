---
id: TASK-166
title: 'Live-path deriveRefRole fallback: thread allPersonalityNames + document the bot→user…'
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
labels:
  - 'area:bot-client'
dependencies: []
ordinal: 166000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Live-path `deriveRefRole` fallback: thread `allPersonalityNames` + document the bot→user transition gap

**Why:** Two transition-window gaps in the live `ReferencedMessageFormatter` fallback (fires only when `authorRole` is absent — pre-classifier stored history, or an old bot-client mid-rolling-deploy): (1) it passes only `personality.displayName` to `deriveRefRole`, not `allPersonalityNames`, so a SIBLING persona's reference renders `role="user"` on the live path but `role="assistant"` on the stored path (which threads the set) — an asymmetry during the deploy window in multi-persona conversations; (2) the fallback is a binary assistant/user ternary, so a third-party bot (MEE6, non-proxy webhook) with no `authorRole` reads as `role="user"` during the ~30-day aging window — which the instruction defines as "a person." **Fix shape**: add `allPersonalityNames?: Set<string>` to `formatReferencedMessages` and thread it to both `deriveRefRole` call sites (requires sourcing the participant set in `ConversationInputProcessor`); add a test asserting `deriveRefRole(undefined, 'MEE6', 'Lilith')` → `'user'` with a comment that this is accepted transition-window degradation, not a missed case. **Promote when**: ~30 days post-beta.136 (pre-classifier history aged out, only the deploy-window path remains), OR a sibling-persona/third-party-bot mislabel is observed. Surfaced 2026-06-24 by PR #1321 post-amend claude-review (round 5; bounded transition-window, merged-and-backlogged).
<!-- SECTION:DESCRIPTION:END -->
