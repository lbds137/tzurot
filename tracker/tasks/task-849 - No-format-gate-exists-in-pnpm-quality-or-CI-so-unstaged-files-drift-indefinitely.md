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
<!-- SECTION:DESCRIPTION:END -->
