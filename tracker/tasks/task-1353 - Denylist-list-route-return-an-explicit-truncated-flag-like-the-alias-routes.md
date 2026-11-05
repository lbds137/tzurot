---
id: TASK-1353
title: 'Denylist list route: return an explicit truncated flag like the alias routes'
status: Done
assignee: []
created_date: '2026-11-05T00:25:00Z'
updated_date: '2026-11-05T12:35:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1336000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review round 3 on PR 2717, finding 3. The denylist list route fetches exactly DENYLIST_LIST_MAX_ENTRIES rows (api-gateway/src/routes/admin/denylist.ts:106), so a list of exactly 500 is indistinguishable from an over-cap list and the client uses the >= heuristic — now user-visible copy (the browse cap footer shows at exactly-500 with nothing hidden, and a batch pick on a complete list gets COULD_NOT_VERIFY_NOTE). The alias routes already return an explicit truncated flag (aliasData.ts maps result.data.truncated). Fix: take CAP + 1 in the route, return truncated, swap the client-side heuristic for the flag. Gateway + schema change, reviewer-sanctioned follow-up.
<!-- SECTION:DESCRIPTION:END -->
