---
id: TASK-5
title: 'dmUndeliverableSince is stamped ONLY on release-blast DM failures…'
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
labels: []
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (retention Phase 1) — `dmUndeliverableSince` is stamped ONLY on release-blast DM failures (`handleReleaseBroadcastDeliveries`, the sole site that classifies DM failures today); persona DM replies (`DiscordResponseSender.sendViaDM`) have no try/catch and classify nothing, so a per-user unreachable code (50278/50007) on a persona reply never stamps. **Fix shape**: add `classifyDmError` at `sendViaDM` + a new service-auth `POST /api/internal/users/:discordId/dm-undeliverable` endpoint (route manifest + codegen). **Promote when**: retention Phase 2/3 needs fresher unreachability than the per-release blast provides (the blast refreshes it each release — sufficient for the 180-day window until then).

**Why:** Blast-only stamp suffices for Phase 1's window; persona-DM stamping is a bigger build deferred to when the purge branch needs the freshness.
<!-- SECTION:DESCRIPTION:END -->
