---
id: TASK-1337
title: Deny edit reports failure when only the success re-render threw
status: To Do
assignee: []
created_date: '2026-11-01T21:57:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1320000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/deny/detailEdit.ts handleEditModal wraps both the upsert and the success-path editReply in one try. If the upsert succeeded and only the re-render threw (grep Failed to edit entry), the user is told the update failed although the entry changed, and the view still shows the old values. Raised by the re-review on the TASK-1332 PR. Harm is small: the upsert is idempotent, so a retry succeeds.
What: separate the write failure from the render failure, and word the render failure as saved but could not refresh.
Acceptance: a test with the upsert ok and editReply rejecting gets the saved wording, and a canary proves it can fail.
<!-- SECTION:DESCRIPTION:END -->
