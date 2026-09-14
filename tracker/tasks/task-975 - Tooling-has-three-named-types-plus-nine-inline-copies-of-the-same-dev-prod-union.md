---
id: TASK-975
title: >-
  Tooling has three named types plus nine inline copies of the same dev/prod
  union
status: To Do
assignee: []
created_date: '2026-09-14 02:46'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 971000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `git grep -n "dev. | .prod." -- packages/tooling/src` (excluding tests) returns twelve sites for one two-member union, spelled three different ways. Three are NAMED types that mean the same thing: `Environment` in utils/env-runner.ts (the canonical one, `local | dev | prod`, and the type `getRailwayEnvName` actually takes), `SecretsEnv` in secrets/rotation.ts, and `RailwayEnv` in deployment/railway-api.ts. The other nine are bare inline unions in commands/deploy.ts, db/migration-status.ts, db/run-migration.ts, deployment/logs.ts, deployment/railway-status.ts, deployment/var-delete.ts, and two more in env-runner.ts itself.

The cost is realized, not hypothetical: `RailwayEnv` was added in PR 2421 by a spec that did not know `Environment` already owned this vocabulary, so the count went from eleven to twelve in a PR whose author was looking directly at the file. A reviewer on that PR asked for two of the twelve sites to converge; that was declined because two-of-twelve leaves a worse middle state than either pole, and the whole set is this task.

Fix shape: pick ONE canonical named type and use it everywhere. The likely shape is narrowing from the existing `Environment` rather than inventing a fourth name, since `local` is meaningless for Railway-targeting commands but meaningful for the migration ones, so the canonical set is probably `Environment` plus one derived deploy-target type. Decide which sites legitimately admit `local` before collapsing anything: that distinction is real and must survive the sweep rather than be flattened by it.

Acceptance: one named type per distinct meaning, every inline copy replaced by a named type, and the `local`-admitting sites still typed so they admit it. No behaviour change; the whole diff should be types and imports.
<!-- SECTION:DESCRIPTION:END -->
