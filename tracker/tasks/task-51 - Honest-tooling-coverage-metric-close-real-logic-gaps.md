---
id: TASK-51
title: Honest tooling coverage metric + close real-logic gaps
status: To Do
assignee: []
created_date: '2026-06-22 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Honest tooling coverage metric + close real-logic gaps

**Why:** `@tzurot/tooling` reports ~71.7% line coverage, but it's dragged down by ~16 commander-wrapper files at 0% (`src/commands/*.ts` + `deployment/`/`cache/`/`inspect/`/`xray/formatters/`) — the SAME paths `structure.test.ts` `EXCLUDE_PATTERNS` already exempts as "thin CLI wrappers." The real `dev/*` logic is well-covered (1096 tests). **Fix shape (two parts, one PR): (1) honest metric** — mirror the 5 structure-test wrapper-exemption paths into tooling's `coverage.exclude` so the number reflects testable logic, not glue (same "measure real debt" philosophy as the CPD post-filter); **(2) real gaps** — add error-path/branch tests for the genuine under-covered dev tools: `voice/audit-references.ts` (8%), `db/fix-migration-drift.ts` (16%), `memory/backfill-ltm.ts` (39%), `utils/env-runner.ts` (40%), `gh/github-api.ts` (44%), + the untested `connection-exhaustion`/`duplicate-exports`. User-chosen approach 2026-06-22 ("honest metric + real gaps"). **Promote when**: after the epic Cluster B/C sweep, before the dependency PRs (its own PR). Surfaced 2026-06-22 (user noticed tooling <80% during #1305).
<!-- SECTION:DESCRIPTION:END -->
