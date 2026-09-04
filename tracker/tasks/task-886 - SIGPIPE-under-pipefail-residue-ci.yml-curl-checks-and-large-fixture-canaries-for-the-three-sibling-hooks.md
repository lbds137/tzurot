---
id: TASK-886
title: >-
  SIGPIPE-under-pipefail residue: ci.yml curl checks and large-fixture canaries
  for the three sibling hooks
status: Done
assignee: []
created_date: '2026-09-04 11:20'
updated_date: '2026-09-04 14:12'
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

CLOSED 2026-09-04, both clauses by measurement, no code change. (2) Measured in PR 2326 against a -q-restored temp copy of develop-code-commit-guard.sh with PIPESTATUS printed, 20 runs on each of three fixtures (112 KB mixed list with an early-sorting .ts, 46 B all-manifest, 128 KB all-manifest): the SIGPIPE path IS entered on the mixed list (PIPESTATUS 141 0, the version-only loop runs wrongly), but that loop re-validates every file and sets VERSION_ONLY=0 on the first non-manifest, so the verdict never moves. A case there cannot redden; none added. (1) The premise is false for this workflow: ci.yml declares no shell anywhere, and the log of CI run 33871236853 shows every run: step executing as bash -e {0} with no pipefail (85 steps); the only pipefail steps (77) are the Codecov composite action. Without pipefail the curl checks are not in the SIGPIPE class. The watch clause above stays true in spirit: if a step ever gains shell: bash, the pipefail default returns and the four checks re-enter the class.
<!-- SECTION:DESCRIPTION:END -->
