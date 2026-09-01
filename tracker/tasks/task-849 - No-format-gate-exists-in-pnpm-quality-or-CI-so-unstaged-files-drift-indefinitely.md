---
id: TASK-849
title: >-
  No format gate exists in pnpm quality or CI, so unstaged files drift
  indefinitely
status: To Do
assignee: []
created_date: '2026-09-01 02:30'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 849000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prettier is enforced ONLY by lint-staged on STAGED files. Verified 2026-08-31: the 30-gate pnpm quality chain contains no format check (jq .scripts.quality), .github/workflows/ci.yml contains no prettier invocation (the single format match is a git log --format= false positive), and all 15 per-package lint scripts are bare eslint with no prettier. Consequence: any file not touched by a commit can drift out of format forever, and nothing reports it. Found via packages/identity/stryker.config.mjs, which sat unformatted on develop until PR 2285 happened to touch it.

Fix shape: add a format:check script (prettier --check .) and wire it into the quality chain, mirroring how the other 30 gates are composed. Run it once first to size the existing drift - if the backlog is large, land the drift fix as its own commit before adding the gate, so the gate lands green. guard:gate-parity keeps the CI lint job in sync, so check whether CI needs the same addition explicitly.

Acceptance: a file that drifts out of prettier format fails pnpm quality and CI, not only the staged-file hook. Related: TASK-237 (lint-staged vs quality ordering artifact), TASK-812 (orchestration spec template omits a format gate).

MEASURED 2026-08-31, same session: drift is 9 TRACKED files, so this is genuinely size:S.
  packages/{cache-invalidation,clients,config-resolver,conversation-history,identity}/stryker.config.mjs
  packages/common-types/src/types/discord-types.ts
  services/bot-client/src/commands/memory/{autocomplete,browseSession}.ts
  services/bot-client/src/commands/character/characterDashboardShared.test.ts
(identity/stryker.config.mjs was fixed in PR 2285, so expect 8 by the time this is picked up.)

A bare prettier --check . reports 1585 files, which is NOT the drift figure - prettier does not read .gitignore, so it scans services/voice-engine/.mypy_cache. Any gate added here MUST ship a .prettierignore covering the gitignored trees, or it will fail on cache artifacts forever. That is the actual work in this task; the 9 real fixes are trivial.
<!-- SECTION:DESCRIPTION:END -->
