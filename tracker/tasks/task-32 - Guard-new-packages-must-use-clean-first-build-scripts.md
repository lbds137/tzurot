---
id: TASK-32
title: 'Guard: new packages must use clean-first build scripts'
status: Done
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-08-11 12:10'
labels:
  - 'area:tooling'
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Guard: new packages must use clean-first build scripts

**Why:** The turbo cache-poisoning fix depends on every package's build script being `rm -rf dist tsconfig.tsbuildinfo && tsc`; a new package added with bare `"build": "tsc"` silently reintroduces the class. **Fix shape**: a structural check (shape like `guard:duplicate-exports` — binary sync-check, not audit-class) failing CI when any `packages/*|services/*` package.json has a `build` script invoking tsc without the clean-first prefix. **Promote when**: the next new workspace package is added, or alongside R166's guard work. Surfaced 2026-07-02 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
