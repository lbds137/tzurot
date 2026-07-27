---
id: TASK-52
title: 'Collapse the double routing-context round-trip in the character-turn path'
status: To Do
assignee: []
created_date: '2026-06-21 00:00'
labels:
  - 'area:db'
  - 'origin:review'
dependencies: []
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Collapse the double `routing-context` round-trip in the character-turn path

**Why:** After PR #1289, every `/chat` / `/random` / `/character chime-in` turn makes TWO `routing-context` gateway calls per turn with identical args: `services/character/characterTurn.ts` `runCharacterTurn` step 3 (`resolveUserContext`, feeds `getAnchorMessage`) and `MessageContextBuilder.buildContext` (`resolveUserContext`, feeds `submitAndTrackJob`). They can't diverge (same user + personality) so one is redundant — the read-migration traded a Prisma read for a second gateway round-trip. **Fix shape**: thread the already-resolved `userContext` from `characterTurn.ts` into `buildChatContext` → `MessageContextBuilder.buildContext` so it skips the re-resolve (an optional pre-resolved-context param on the shared builder; keep @mention/reply paths unaffected). Deferred from #1289 to keep the read-migration diff minimal + because the builder-signature change is shared-service breadth. **Promote when**: Phase 4 teardown (#38) reworks the PersonaResolver wiring. Surfaced 2026-06-21 (PR #1289 claude-review).
<!-- SECTION:DESCRIPTION:END -->
