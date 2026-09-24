---
id: TASK-1073
title: >-
  Husky hooks use bash syntax but run under sh, so they fail where /bin/sh is
  dash
status: To Do
assignee: []
created_date: '2026-09-24 03:10'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1066000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: husky runs every hook as `sh -e <hook>` (.husky/_/h), ignoring the shebang. .husky/pre-commit line 271 uses a bash-only here-string (`done <<< "$STAGED_CLAUDE_DOCS"`). On the Steam Deck /bin/sh is a symlink to bash, so it works there; in the cloud-pilot VM (Ubuntu, /bin/sh = dash) the pre-commit hook died with a syntax error at line 271 and the run had to put a PATH-scoped sh-to-bash shim in front of git (routine run for TASK-1055, 2026-09-23). Every cloud-dispatched commit hits this, so it blocks the cloud mode of /tzurot-orchestration (doc-108). dash stops parsing at the first error, so line 271 may not be the only bashism; the host has no POSIX shell (no dash, busybox or shellcheck), so the full list must be taken on a dash machine (CI runner or cloud VM).
Fix shape: enumerate with `shellcheck -s sh .husky/pre-commit .husky/pre-push .husky/commit-msg` (or `dash -n` per hook), then either rewrite each bashism as POSIX (the here-string becomes a heredoc or a pipe) or re-exec each hook under bash at its top. Add a CI step that parses every .husky hook with dash (`sh -n` on the ubuntu runner, where /bin/sh is dash) so a new bashism fails CI instead of the next cloud run.
Acceptance: `dash -n` passes on every .husky hook; a cloud routine commit runs the hooks with no shim; the CI parse step goes red on a reintroduced `<<<` (canary).
<!-- SECTION:DESCRIPTION:END -->
