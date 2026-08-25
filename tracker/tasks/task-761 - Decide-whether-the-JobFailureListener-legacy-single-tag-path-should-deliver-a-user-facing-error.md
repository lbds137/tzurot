---
id: TASK-761
title: >-
  Decide whether the JobFailureListener legacy single-tag path should deliver a
  user-facing error
status: Done
assignee: []
created_date: '2026-08-24 12:06'
updated_date: '2026-08-25 18:39'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 761000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2207 round-2 review awareness item - JobFailureListener handles BullMQ failed/removed events; its multi-tag branch funnels into MultiTagCoordinator (user sees an in-character error, owner channel gets a report via deliverSlot), but the legacy single-tag branch (a failed job the coordinator does NOT own) delivers no error message to the user at all, so there is also nothing to attach a reporter call to. Multi-tag is now the default fan-out path, so first VERIFY whether the legacy branch is still reachable (which job shapes are coordinator-unowned - DM sessions? slash chat?) before designing.

Fix shape: if reachable, mirror the multi-tag behavior - synthesize an in-character error result and route through SlotDeliveryService, with the reporter call that comes with that path; if unreachable, delete the branch and document why.

Acceptance: either the legacy path delivers a user-visible error plus an owner-channel report (with a seam test), or the branch is removed with a reachability argument cited in the commit.
<!-- SECTION:DESCRIPTION:END -->
