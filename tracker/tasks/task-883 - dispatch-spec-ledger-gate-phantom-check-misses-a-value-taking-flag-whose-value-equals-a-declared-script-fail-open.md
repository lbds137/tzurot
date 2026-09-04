---
id: TASK-883
title: >-
  dispatch-spec-ledger-gate: phantom check misses a value-taking flag whose
  value equals a declared script (fail-open)
status: Done
assignee: []
created_date: '2026-09-04 02:13'
updated_date: '2026-09-04 14:11'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 881000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: round-7 review finding on PR #2320, past the review-round cap; the owner chose merge-now-and-track. The phantom-script walk classifies tokens by SHAPE (any bare word matching the union of the selected packages scripts passes the hit). A value-taking pnpm flag whose VALUE happens to equal a declared script name rescues the hit before the walk reaches the real script: `pnpm --filter @tzurot/probe --reporter test typecheck` passes although `typecheck` is undeclared; a value equal to one of the nine subcommand keywords (`--reporter list typecheck`) aborts the check as if the command were `pnpm list`. Both are fail-OPEN (a missed phantom), never a false block. The real-world phantom shape that motivated the check (`pnpm --filter @tzurot/tooling typecheck`, plain form, twice in one window) has blocked correctly since the first push; every finding after round 2 was a hypothetical corner of pnpm grammar parsed in bash.

Fix shape, two options recorded so the next session chooses deliberately rather than re-deriving: (1) NARROW the contract — check only invocations with no flags between the selector(s) and the script; on anything more complex print the stderr note and skip (fail-open). Simplest; kills the class; discards the run/-F/flag/multi-filter coverage rounds 2-6 added. (2) A flag-arity table — recognise known separate-value pnpm flags (`--filter`, `-F`, `--reporter`, `-C`, `--workspace-concurrency`, ...) and skip their values structurally. Fixes the repro; every unlisted flag reopens the class. Do NOT pick "last bare word is the script": pnpm forwards trailing args to the script (`test -- --run`), so positional-final is false.

Evidence: `bash .claude/hooks/dispatch-spec-ledger-gate.probe.sh` (63 cases, none constructs a flag value colliding with a script or keyword); the round-7 review body on PR #2320.

Acceptance: either option shipped with two probe cases pinning the collision shapes (flag value = declared script, then a phantom → blocks; flag value = subcommand keyword, then a phantom → blocks), or the gap documented in the hook header fail-open list with the same two cases pinning the CURRENT behaviour so a later edit cannot regress silently.
<!-- SECTION:DESCRIPTION:END -->
