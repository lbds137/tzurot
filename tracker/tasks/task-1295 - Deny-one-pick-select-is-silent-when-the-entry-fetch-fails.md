---
id: TASK-1295
title: Deny one-pick select is silent when the entry fetch fails
status: To Do
assignee: []
created_date: '2026-10-26T09:56:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1281000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2661 round-3 claude-review. handleBrowseSelect in services/bot-client/src/commands/deny/browse.ts returns with no user feedback after its ack when fetchEntries returns null, while handleBrowsePagination in the same file answers through followUpBrowsePageFailure and the new batch paths answer with PAGE_FETCH_FAILED_COPY.

What: call followUpBrowsePageFailure(interaction, null) on that null branch, matching handleBrowsePagination.

Acceptance: a test where listDenylistEntries fails on a one-pick select sends the page-load failure followUp.
<!-- SECTION:DESCRIPTION:END -->
