---
id: TASK-882
title: 'board-gate: the (?i)-prefix assert is compiled out under python -O'
status: To Do
assignee: []
created_date: '2026-09-03 21:56'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 880000
---



## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by the round-7 review on PR 2319. The assert COMMIT_RE.pattern.startswith("(?i)") guard added in that PR's round 4 exists to make a future change to COMMIT_RE's inline flags fail loudly at its source, rather than silently mis-embedding the sliced pattern into BYPASS_RE or throwing inside the SCAN command substitution whose || exit 0 swallows every python failure — which would degrade to the whole gate failing open on every invocation.

Python strips assert statements entirely under -O or with PYTHONOPTIMIZE set in the environment. In that case the guard vanishes and the exact silent-fail-open mode it was written to prevent returns, with no signal at all: the assert that would have named the problem is gone.

Not currently reachable in this repo — nothing here invokes the hook with -O and PYTHONOPTIMIZE is not set — so this is latent rather than live. It is filed because the mechanism chosen to close a fail-open is itself conditionally absent, which is the kind of thing that is invisible until the day it matters.

Fix shape: replace the assert with an explicit conditional raise, which -O does not strip. Roughly, if the pattern does not start with the literal prefix, raise SystemExit with the same message the assert carries. Keep the message identical — it was verified in 2319 to appear on stderr with the flags mutated to (?im), and that verification should stay true.

Acceptance: mutating COMMIT_RE's inline flags still surfaces the same named error on stderr, AND does so when the hook's python is invoked with -O. The probe stays green at its then-current count.
<!-- SECTION:DESCRIPTION:END -->
