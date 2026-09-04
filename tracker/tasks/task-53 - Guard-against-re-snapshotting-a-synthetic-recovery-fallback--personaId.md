---
id: TASK-53
title: Guard against re-snapshotting a synthetic recovery-fallback-* personaId
status: To Do
assignee: []
created_date: '2026-06-21 00:00'
updated_date: '2026-09-04 19:37'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Guard against re-snapshotting a synthetic `recovery-fallback-*` personaId

**Why:** Double-crash edge case (PR #1288 review): if the bot crashes DURING multi-tag recovery (after `adoptRehydratedEntry`, before delivery cleanup), the live `RuntimeEntry` slot holds `personaId: 'recovery-fallback-<slug>'`. If `toSnapshot` runs on it before cleanup, the NEXT recovery reads that synthetic id as a real persona (non-empty, non-undefined) in `personaIdForSlot` and passes it through → FK violation → already swallowed by the `saveAssistantMessage` try/catch (user still gets their message; history doesn't persist). Degrades gracefully, same as the single-crash `''`/`undefined` paths. **Fix shape**: either `personaIdForSlot` treats a `recovery-fallback-` prefix as the fallback case (idempotent regenerate), OR `toSnapshot` skips synthetic ids (persists `undefined`). **Promote when**: `recovery-fallback-*` personaIds show up in logs and confuse, or opportunistically when next in `MultiTagRecovery`. Surfaced 2026-06-21 (PR #1288 review). Deferred 2026-06-21.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `personaIdForSlot` (`MultiTagRecovery.ts:654`) still returns `recovery-fallback-${slug}` on empty/undefined personaId with no downstream guard against re-snapshotting it. Real cost: FK violation on next recovery (currently swallowed, degrades gracefully but silently). Watch's observable (synthetic ids showing up in logs) hasn't fired but the code path is unchanged and reachable. Evidence: `sed -n '654,668p' MultiTagRecovery.ts` shows the synthetic-fallback return with no caller-side check for the `recovery-fallback-` prefix.
---
<!-- COMMENTS:END -->
