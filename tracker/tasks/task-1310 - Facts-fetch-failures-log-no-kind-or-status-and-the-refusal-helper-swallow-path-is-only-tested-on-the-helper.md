---
id: TASK-1310
title: >-
  Facts fetch failures log no kind or status, and the refusal helper swallow
  path is only tested on the helper
status: To Do
assignee: []
created_date: '2026-10-27T14:49:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1294000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2672 final review (all optional there, filed here so they are not lost). (1) fetchFacts in factsApi.ts drops result.kind and result.status before returning null, so the fetch-failed warn that followUpFactsRefusal now emits (ids only) cannot tell a 5xx from a timeout or a 4xx; its siblings in the same file log this through warnNonMiss. The gap predates the PR but the PR added the only log line for that failure. (2) The swallow-and-log test uses expect.any(String) for the message, so a future reason that logs before the try block could make it match the wrong call. (3) The swallow-on-rejected-followUp behaviour (a behaviour change at facts pagination, batch-select entry and the batch-confirm refusal) is tested only on the helper, not through a migrated caller.

What: (1) log kind and status inside fetchFacts on failure, like warnNonMiss, which also covers the facts browse entry path; (2) pin the message string or add toHaveBeenCalledTimes(1) to the swallow test; (3) one caller-level test, for example handleBatchConfirm with a rejecting followUp resolving cleanly.

Acceptance: a fetch failure leaves a log line with kind and status (ids only, no content); the two test items land with a mutation check each.
<!-- SECTION:DESCRIPTION:END -->
