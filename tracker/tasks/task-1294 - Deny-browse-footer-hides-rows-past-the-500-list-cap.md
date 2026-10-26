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

PR 2661 round-5 addition (same cap theme): when the batch confirm re-fetch is at the cap and a pick is missing, the result line says FAILED_TO_REMOVE_NOTE (Please try again), but a retry hits the same window until the list shrinks; the one-pick detail path still works because its session carries the 4-tuple. Distinct copy for that case would say what to do, e.g. could not verify this entry - remove it from its detail view (runSingleDenyRemoval in services/bot-client/src/commands/deny/browseBatch.ts, the listTruncated branch).

Owner question: At the 500 cap, should /deny browse say it shows only the newest 500, and should a missing batch pick point to the detail view instead of saying please try again?
Recommendation: yes to both - a full-looking list that silently drops the oldest rows misleads, and a retry that cannot succeed wastes the owner a round trip; each is one string.

Acceptance: a footer test at exactly the cap shows the segment, below the cap it is absent; the at-cap missing-pick test asserts the new note.
<!-- SECTION:DESCRIPTION:END -->
