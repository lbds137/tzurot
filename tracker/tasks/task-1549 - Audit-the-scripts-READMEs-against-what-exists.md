---
id: TASK-1549
title: Audit the scripts/ READMEs against what exists
status: To Do
assignee: []
created_date: '2026-11-25T18:07:00Z'
labels:
  - area:docs
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1545000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: scripts/README.md and scripts/data/README.md advertise things that do not exist. Found while removing the dead deploy stubs (TASK-1512): the Directory Structure table lists scripts/git/ and scripts/debug/ (absent; ls -d scripts/*/ shows analysis, data, deployment, migrations, testing, utils) and maps data/ to pnpm ops data:* (no data:* command in pnpm ops --help). scripts/data/README.md lists backup-personalities-data.js, rebuild-memories-from-history.ts and import-personality/ (only upload-avatar-stdin.mjs exists). The Changesets section and the legacy bump-version line (package.json bump-version now runs pnpm ops release:bump) need checking against the release flow.

What: rewrite both READMEs so every path and command they name exists; decide whether scripts/ READMEs should exist at all beyond a pointer to packages/tooling (05-tooling: No Standalone Scripts).

Acceptance: every path and pnpm/ops command in scripts/**/README.md resolves (git ls-files / pnpm ops --help), checked by a grep listed in the PR body.
<!-- SECTION:DESCRIPTION:END -->
