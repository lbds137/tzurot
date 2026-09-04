---
id: TASK-886
title: >-
  SIGPIPE-under-pipefail residue: ci.yml curl checks and large-fixture canaries
  for the three sibling hooks
status: To Do
assignee: []
created_date: '2026-09-04 11:20'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 884000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2324 drained every pipe-fed grep -q in the hooks that set pipefail after the ref-gate resolver lost a resolvable id to a SIGPIPE race (producer past the 64 KB pipe buffer, grep -q exiting on an early match, pipefail reporting the producer death as failure). Its review named two members the sweep did not reach. (1) GitHub Actions steps run under bash -eo pipefail by default, and .github/workflows/ci.yml carries four curl -s <url> | grep -q checks over robots.txt and the terms pages; the responses are tiny today, far under the buffer, so this is not a live bug, but the shape is the class. (2) The three sibling hooks (bare-token-binding-reminder, develop-code-commit-guard, cwd-drift-guard) were drained by pattern with no probe that can reach the race; develop-code-commit-guard scans GATED_FILES and a diff that a large commit can plausibly push past the buffer, so a regression there would be silent.

Fix shape: (1) in ci.yml, replace each curl | grep -q with a drained grep (stdout to /dev/null) or a curl to a file plus grep on the file, in one workflow PR (ci.yml rides develop like code). (2) add one large-fixture case to develop-code-commit-guard.probe.sh: a staged change list past 64 KB with the package.json entry sorting early, asserting the version-only path still resolves; canary by restoring -q. The other two hooks producers are a single prompt and a command head; a case is optional there.

Promote when: any grep -q returns to those files, or a CI step over a grown response starts flaking.
<!-- SECTION:DESCRIPTION:END -->
