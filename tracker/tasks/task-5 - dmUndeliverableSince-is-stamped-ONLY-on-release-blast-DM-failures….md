---
id: TASK-5
title: 'Stamp dmUndeliverableSince on persona-DM failures, not just blasts'
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (retention Phase 1) — `dmUndeliverableSince` is stamped ONLY on release-blast DM failures (`handleReleaseBroadcastDeliveries`, the sole site that classifies DM failures today); persona DM replies (`DiscordResponseSender.sendViaDM`) have no try/catch and classify nothing, so a per-user unreachable code (50278/50007) on a persona reply never stamps. **Fix shape**: add `classifyDmError` at `sendViaDM` + a new service-auth `POST /api/internal/users/:discordId/dm-undeliverable` endpoint (route manifest + codegen). **Promote when**: retention Phase 2/3 needs fresher unreachability than the per-release blast provides (the blast refreshes it each release — sufficient for the 180-day window until then).

**Why:** Blast-only stamp suffices for Phase 1's window; persona-DM stamping is a bigger build deferred to when the purge branch needs the freshness.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `DiscordResponseSender.sendViaDM` still has no try/catch or `classifyDmError` call; the field is stamped only from `handleReleaseBroadcastDeliveries`. Real cost prevented: retention-window staleness for per-user DM failures. Dependent trigger (retention Phase 2/3 needing fresher unreachability) hasn't fired. Evidence: `git grep -n sendViaDM` → `DiscordResponseSender.ts:251` defines it with no classifier import in that file; `classifyDmError` calls are confined to the release/retention-notice workers.
---
<!-- COMMENTS:END -->
