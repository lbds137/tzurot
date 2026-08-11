---
id: TASK-519
title: Guard cannot see a coercible CLI flag whose name is not id-shaped
status: To Do
assignee: []
created_date: '2026-08-11 02:32'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 519000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: snowflakeFlagArgv.test.ts catches id-shaped flags by naming heuristic, plus a hand-maintained EXTRA_GUARDED_FLAGS list for the ones no heuristic can see (today just gh.ts --sha). A future flag holding a long digit-capable value under a non-id name ships uncovered unless someone remembers to add it by hand, which is the same remembering-based mechanism the guard was written to replace. Raised by the PR 2060 round-4 review as documented residual risk, explicitly not blocking that PR.

What: make the detection mechanical rather than name-based. Candidate shapes: scan each action body for parsed-option reads of any declared flag and require rawOptionValue for any whose value is later used as a string id, or invert the guard so every declared flag must be either read via rawOptionValue or annotated as safe. Weigh against false-positive noise on genuinely numeric flags (--lines, --limit, --drain-timeout).

Acceptance: adding a coercible flag under a non-id name fails CI without anyone editing an allowlist, or the allowlist approach is recorded as the deliberate end state with its reasoning.
<!-- SECTION:DESCRIPTION:END -->
