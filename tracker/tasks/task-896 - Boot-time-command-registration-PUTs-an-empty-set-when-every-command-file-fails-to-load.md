---
id: TASK-896
title: >-
  Boot-time command registration PUTs an empty set when every command file fails
  to load
status: To Do
assignee: []
created_date: '2026-09-05 06:10'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 894000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: deployCommands skips any command file that fails validation (no default export, no data or execute). If every file fails, for example a bad merge leaving the command modules structurally invalid, the body is an empty array and the global PUT wipes every slash command with about an hour of propagation and no guard. Pre-existing before #2340, but the new hash path does not protect either: the empty-body hash differs from the stored one, so the PUT proceeds and the empty hash is recorded. Surfaced by claude-review on #2340.
Fix shape: in the store-backed boot path only (deployCommands called with a store), treat an empty command set as a stop: warn with the discovered-file count, skip the PUT, do not record the hash. The manual pnpm deploy-commands script (no store) keeps today's behaviour so an intentional wipe from a shell stays possible. The pinned test deploys nothing when every discovered file is invalid splits into the two arms (store: no PUT; no store: PUT of an empty body).
Acceptance: a boot whose command directory yields zero valid commands leaves the registered set untouched and logs why; the shell script is unchanged; both arms pinned.
<!-- SECTION:DESCRIPTION:END -->
