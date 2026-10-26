---
id: TASK-1294
title: Deny browse footer hides rows past the 500 list cap
status: To Do
assignee: []
created_date: '2026-10-26T09:56:00Z'
labels:
  - area:bot-client
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1280000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2661 round-3 claude-review. The admin denylist list route returns at most DENYLIST_LIST_MAX_ENTRIES (500) rows, newest first (services/api-gateway/src/routes/admin/denylist.ts take:), so at the cap /deny browse shows 500 entries in its footer with no sign that older entries exist and cannot be reached from browse.

What: when fetchEntries returns DENYLIST_LIST_MAX_ENTRIES or more rows, add a footer segment such as showing newest 500 in buildBrowsePage (services/bot-client/src/commands/deny/browse.ts).

Owner question: Should /deny browse say it is showing only the newest 500 entries when the list hits the cap?
Recommendation: yes - a full-looking list that silently drops the oldest rows misleads the owner, and the copy is one footer segment.

Acceptance: a footer test at exactly the cap shows the segment; below the cap it is absent.
<!-- SECTION:DESCRIPTION:END -->
