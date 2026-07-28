---
id: TASK-330
title: Character reclamation flow + orphan-sentinel admin commands
status: To Do
assignee: []
created_date: '2026-07-26 00:00'
updated_date: '2026-07-28 10:53'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'size:L'
dependencies: []
priority: low
ordinal: 330000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-26 (retention Phase 3 planning, owner call) — **character reclamation flow + orphan-sentinel admin commands** (list orphaned characters, reassign, reclaim-to-original-owner via `personalities.original_owner_discord_id`). Phase-2 design (D11) deferred these to "the Phase-3 reclamation flow"; the owner deferred them out of Phase 3's notify PR because no character has ever been re-homed, so there is nothing to reclaim and no admin surface is missing yet. Reclamation semantics are already locked in the Phase-2 doc: full restore to prior state (`owner_id` back, sentinel holds nothing, provenance cleared). **Fix shape**: admin command group (or ops CLI) driving list/reassign/reclaim against the sentinel's holdings. **Promote when**: the first real purge re-homes a character (audit ledger row with `charactersReHomed > 0`) — at that moment an orphan exists and the reclamation path stops being hypothetical.

**Why:** Building admin surfaces for an empty bucket is speculative; the provenance column already captures everything reclamation needs, so deferral loses nothing.
<!-- SECTION:DESCRIPTION:END -->
