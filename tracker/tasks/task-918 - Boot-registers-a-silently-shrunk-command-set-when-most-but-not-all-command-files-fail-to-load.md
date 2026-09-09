---
id: TASK-918
title: >-
  Boot registers a silently shrunk command set when most but not all command
  files fail to load
status: To Do
assignee: []
created_date: '2026-09-09 03:34'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 916000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-896 guard fires only when the loaded command set is empty, so a bad merge that invalidates 45 of 50 command files still PUTs the 5 survivors and deletes the other 45 registered commands, with no error log and up to an hour of propagation. Same failure shape as TASK-896, minus the total case. The change-detection hash does not help: a shrunk body hashes differently, so the PUT proceeds and the shrunk hash is recorded as the new truth. Surfaced by claude-review on PR 2377, which scoped it out because the TASK-896 acceptance says zero valid commands.

Fix shape: needs a comparison the code cannot currently make. The store holds the last registered hash but not the last registered COUNT, so nothing knows the set shrank. Either persist the count beside the hash and refuse a boot whose loaded count drops by more than a justified fraction, or log at error when the discovered-file count exceeds the loaded-command count, which needs no new stored state but cannot tell a deliberate command removal from a broken one. The refusing variant needs an escape hatch for a legitimate bulk removal. Pick one deliberately; the threshold is the design question, not the plumbing.

Acceptance: a boot that loads only a fraction of its discovered command files is either refused or logged at error, with the chosen threshold and its justification recorded here, or the decision to keep the current behaviour is recorded here with its technical reason.
<!-- SECTION:DESCRIPTION:END -->
