---
id: TASK-1274
title: >-
  egress-probe polish from the PR 2646 round-3 review: threshold derivation,
  seam URL asserts, listener-module extraction + redaction test
status: To Do
assignee: []
created_date: '2026-10-24 04:53'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1262000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the round-3 claude-review on PR 2646 (its verdict: no blocking issues; filed per the declared-last-fix-round rule instead of a round 4). Items, most severe first: (1) derive EGRESS_BAN_THRESHOLD_MS from the exported BOOT_DEADLINE_MS instead of duplicating the literal (the bootWatchdog comment currently overstates the coupling); (2) the runBootEgressProbe seam test asserts POST count and body but not the webhook URL/method/Content-Type — assert what crosses the seam; (3) move attachBootPhaseLogListeners out of index.ts into its own module and unit-test the /token/i redaction (load-bearing: discord.js masking leaves the first two token segments cleartext) and the detach symmetry with a fake EventEmitter — the reviewer would do this rather than carry it as residue, given the security angle; (4) one doc line noting resume URL and session ID now appear in INFO boot logs (considered acceptable). Nits, take-or-decline at build time: humanize boundary rounding (59,600ms renders 60s), computeBanAlertMarkerExpiry could be nowMs + Math.max(...), a distinct rate-limited verdict (already declined once in the body Residue).
<!-- SECTION:DESCRIPTION:END -->
