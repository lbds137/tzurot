---
id: TASK-984
title: >-
  packages/tooling declares no typecheck script, so pnpm typecheck silently
  skips the whole package
status: To Do
assignee: []
created_date: '2026-09-14 23:06'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 980000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling is the only workspace package of 17 with no typecheck or typecheck:spec script. Verified: npx turbo run typecheck --dry=json lists @tzurot/tooling as the sole entry with command=<NONEXISTENT>, so pnpm quality and CI both omit the package from the typecheck gate entirely.

Same defect class as TASK-792 (tests/ workspace had no typecheck script, Done) and TASK-944 (test-utils had no test script, Done) - tooling is the surviving instance those sweeps missed. git log -S against packages/tooling/package.json for the typecheck key returns empty, so the script was never declared: drift from creation, not a removal.

Second half, found in the same read: packages/tooling/tsconfig.json has include src/**/* and exclude node_modules+dist, missing the **/*.test.ts and **/*.spec.ts exclusion that every sibling carries. Consequence: its build (plain tsc) compiles test files and emits them - the current dist holds 212 .test.js files. So tooling types ARE checked today, but only as a side effect of build, never by the gate that claims to check them, and the emitted tests ride along into dist.

Fix shape: add typecheck (tsc --noEmit) and typecheck:spec (tsc --noEmit --project tsconfig.spec.json) to packages/tooling/package.json; add packages/tooling/tsconfig.spec.json mirroring the sibling shape (composite false, declaration false, noEmit true, include src/**/*.ts); add the test exclusion to packages/tooling/tsconfig.json.

Verify before shipping the exclusion: TASK-598 records that the eslint plugin entry is resolved out of tooling dist, so confirm nothing imports a compiled test file before dropping 212 files from dist.

Acceptance: npx turbo run typecheck --dry=json lists no package with command=<NONEXISTENT>, and a deliberate type error planted in a tooling test file turns pnpm typecheck:spec red.

Partially shipped with the session-mining operationalizations: typecheck + typecheck:spec scripts and tsconfig.spec.json are in place; the tsconfig.json test-file exclusion is deliberately NOT shipped, because TASK-598 records the eslint plugin resolving out of tooling dist and dropping the emitted test files needs that verified first.
<!-- SECTION:DESCRIPTION:END -->
