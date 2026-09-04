---
id: TASK-571
title: >-
  check-build-scripts guard: two workspace roots unscanned and fail-open on own
  read errors
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
updated_date: '2026-09-04 19:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 571000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: (1) ROOTS = [packages, services] but pnpm-workspace.yaml declares four globs incl. scripts and tests - turbo runs build across all workspace packages, so a future "build": "tsc" in scripts/ or tests/ is a real target the guard never sees (the exact new-package-reintroduces-the-class failure it exists for; verified latent - neither has a build script today). Same blind spot in 2064’s discoverServiceDirs (lower stakes). (2) checkPackageJson returns null on unreadable/invalid package.json and readdirSync failure skips the root - the guard is silent on its own errors (practical exposure: permission-error-shaped silent skip).

Fix shape: derive roots from pnpm-workspace.yaml; make guard-internal read errors a finding.

Source: 2026-08-12 review, tooling L2/L3 CONFIRMED.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:58
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-571 finds it.
---
<!-- COMMENTS:END -->
