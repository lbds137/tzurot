---
id: TASK-1464
title: Sweep doc-66 hold-registry headers and comments to the shipped behavior
status: To Do
assignee: []
created_date: '2026-11-19T06:40:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1464000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 PR 2769 round-7 docs items, no behavior change. (1) The pendingReleases JSDoc still describes the pre-identity-check theft race that the survivorMessageId guard closed - state the current invariant instead. (2) The file header says attachment triggers leave any existing hold untouched, but on an idle pair an attachment trigger starts a cycle that later chatter holds behind - state the idle-pair case. (3) Mention and reply generations open no cycle at all (invisible to holds, not just bypassing them), which matches the ruling that mentions stay 1:1 - one header line to settle it. (4) The header invariants list the degraded path as the only release-overlap source - add the deadline release and drop the word short. Acceptance: header and comments describe the shipped behavior.
<!-- SECTION:DESCRIPTION:END -->
