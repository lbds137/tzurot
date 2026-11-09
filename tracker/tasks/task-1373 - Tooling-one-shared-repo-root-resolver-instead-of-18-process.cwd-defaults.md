---
id: TASK-1373
title: 'Tooling: one shared repo-root resolver instead of 18 process.cwd() defaults'
status: To Do
assignee: []
created_date: '2026-11-09T14:54:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1356000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 18 tooling modules default their root to process.cwd() (`git grep -c "?? process.cwd()" -- packages/tooling/src` lists 18 non-test files, e.g. dev/commandsAudit.ts loadManifest, audits/lines-check.ts, dev/backlogLint.ts), and two private defaultRootDir() copies in codegen/command-types.ts and codegen/routes.ts already resolve the root from import.meta.url. Root `pnpm ops` runs from the repo root, but `pnpm ops` inside packages/tooling runs that package's own ops script with cwd packages/tooling, so cwd-defaulted tools read the wrong tree. telemetry:report then prints Roster unavailable; other tools may silently scan nothing. Surfaced by claude-review on PR 2731 (finding 3).

Fix shape: export one repoRoot() helper (import.meta.url-based, like the codegen copies), replace both private copies, and switch every cwd default to it, keeping each rootDir/repoRoot override option. Positive-control the sweep against loadManifest.

Acceptance: no `?? process.cwd()` root default left in packages/tooling/src non-test files; one test proves a tool resolves the root from a subdirectory cwd.
<!-- SECTION:DESCRIPTION:END -->
