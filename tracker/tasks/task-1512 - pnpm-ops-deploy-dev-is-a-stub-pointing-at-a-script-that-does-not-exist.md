---
id: TASK-1512
title: pnpm ops deploy:dev is a stub pointing at a script that does not exist
status: Done
assignee: []
created_date: '2026-11-23T01:09:00Z'
updated_date: '2026-11-25T20:02:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1512000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/deployment/deploy-dev.ts (registered in packages/tooling/src/commands/deploy.ts:232) is a deprecated stub that prints "use ./scripts/deployment/deploy-railway-dev.sh"; that script does not exist (ls scripts/deployment/deploy-railway-dev.sh: no such file). OPS_CLI_REFERENCE.md lists deploy:dev as "Deploy to the Railway development environment", so an operator following the reference gets a dead end. Found while choosing how to put PR #2788 (TASK-1356) on dev for its end-to-end rotation.

What: either remove the command and its reference row (dev deploys come from develop auto-deploy), or implement it (for example a branch deploy to dev), deciding which first.

Acceptance: deploy:dev either works end to end on dev or is gone from the CLI and OPS_CLI_REFERENCE.md.
<!-- SECTION:DESCRIPTION:END -->
