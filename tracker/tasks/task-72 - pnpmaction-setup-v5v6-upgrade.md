---
id: TASK-72
title: pnpm/action-setup v5→v6 upgrade
status: Done
assignee: []
created_date: '2026-04-17 00:00'
updated_date: '2026-08-03 17:38'
labels:
  - 'area:ci'
  - 'size:S'
dependencies: []
priority: low
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`pnpm/action-setup` v5→v6 upgrade

**Why:** Investigation 2026-04-17: v6 only adds pnpm 11 support; we use pnpm 10.30.3 (`packageManager` in package.json). v6 replaces the bundled pnpm with a bootstrap installer (see compare v5...v6: `dist/pnpm.cjs` removed, new `src/install-pnpm/bootstrap/`), which caused `ERR_PNPM_BROKEN_LOCKFILE` in our CI. Zero benefit for us on pnpm 10.x. Revisit if: (a) we adopt pnpm 11, (b) v5 is deprecated, (c) a v6.x patch fixes the bootstrap's pnpm version resolution.
<!-- SECTION:DESCRIPTION:END -->
