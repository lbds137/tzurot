---
id: TASK-1303
title: Deny fetch failures on swap, browse and view render classified copy
status: To Do
assignee: []
created_date: '2026-10-27T00:12:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1288000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2668 review rounds 2 (finding 3) and 3 (finding 1). Three deny surfaces still answer a failed denylist fetch with generic copy and drop the failure object, while PR 2668 moved the deny pagination and one-pick select to fetchEntriesResult plus classified copy (a transient 5xx gets the try-again variant):
- refreshDenyBrowseMode in services/bot-client/src/commands/deny/browseBatch.ts (the batch-browse swap) renders CATALOG.error.transient(PAGE_FETCH_FAILED_COPY) (git grep -n "Failed to fetch denylist entries for batch browse swap").
- handleBrowse in services/bot-client/src/commands/deny/browse.ts edits the reply to the raw literal "Failed to fetch denylist entries." (browse.ts:376-378 at 41d5a7e27).
- the view handler in services/bot-client/src/commands/deny/view.ts does the same (view.ts:35-37 at 41d5a7e27).

What: switch all three to fetchEntriesResult and render the classified copy of the real failure: followUpBrowsePageFailure where the reply shape is a followUp, renderSpec(classifyGatewayFailure(fetched.failure, <noun>, { operation: 'read' })) on the slash-command editReply paths. User-visible copy change, so the owner sees the before/after wording first. Three existing assertions pin the current literal (browse.test.ts x2, view.test.ts x1); changing them is part of the owner call. Dropping the two raw literals lowers the raw-content-allowlist budgets (packages/tooling/src/eslint/raw-content-allowlist.ts) and refreshes the Discord-surface snapshot (pnpm ops surface:inventory --write); run the tooling suite too. handleDenyBatchConfirm keeps its refuse-before-mutation copy on purpose (it refuses BEFORE any mutation, and that copy says so).

Acceptance: a failed fetch on each of the three surfaces renders the classified copy of the real failure, each pinned by a test with the exact rendered string; the batch-confirm refusal copy is unchanged.
<!-- SECTION:DESCRIPTION:END -->
