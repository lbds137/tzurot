---
id: TASK-53
title: 'Guard against re-snapshotting a synthetic recovery-fallback-* personaId'
status: To Do
assignee: []
created_date: '2026-06-21 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Guard against re-snapshotting a synthetic `recovery-fallback-*` personaId

**Why:** Double-crash edge case (PR #1288 review): if the bot crashes DURING multi-tag recovery (after `adoptRehydratedEntry`, before delivery cleanup), the live `RuntimeEntry` slot holds `personaId: 'recovery-fallback-<slug>'`. If `toSnapshot` runs on it before cleanup, the NEXT recovery reads that synthetic id as a real persona (non-empty, non-undefined) in `personaIdForSlot` and passes it through → FK violation → already swallowed by the `saveAssistantMessage` try/catch (user still gets their message; history doesn't persist). Degrades gracefully, same as the single-crash `''`/`undefined` paths. **Fix shape**: either `personaIdForSlot` treats a `recovery-fallback-` prefix as the fallback case (idempotent regenerate), OR `toSnapshot` skips synthetic ids (persists `undefined`). **Promote when**: `recovery-fallback-*` personaIds show up in logs and confuse, or opportunistically when next in `MultiTagRecovery`. Surfaced 2026-06-21 (PR #1288 review). Deferred 2026-06-21.
<!-- SECTION:DESCRIPTION:END -->
