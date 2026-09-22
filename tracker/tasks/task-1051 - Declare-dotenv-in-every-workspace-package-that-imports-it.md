---
id: TASK-1051
title: Declare dotenv in every workspace package that imports it
status: To Do
assignee: []
created_date: '2026-09-22 23:40'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1045000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 2 on PR #2482. packages/tooling/src/loadEnv.ts and the test setups of ai-worker and api-gateway import dotenv, but only the root package.json and services/bot-client/package.json declare it (verified 2026-09-22 with grep of the dotenv key across package.json files). The imports resolve only because the root devDependency is hoisted; a change to hoisting (node-linker, public-hoist-pattern) or a package extracted to its own install would break module resolution with no code change.

Fix shape: add dotenv (same range as root, ^18.0.0) to packages/tooling and services/ai-worker and services/api-gateway, as devDependencies where only tests use it (the service setups) and as a dependency where the runtime CLI uses it (tooling). Refresh the lockfile. Then sweep for other hoisted-only imports while there: knip reports unlisted dependencies (pnpm knip), so check its unlisted section first rather than grepping by hand.

Acceptance: each package that imports dotenv declares it; knip reports no unlisted dotenv; pnpm install --frozen-lockfile passes in CI.
<!-- SECTION:DESCRIPTION:END -->
