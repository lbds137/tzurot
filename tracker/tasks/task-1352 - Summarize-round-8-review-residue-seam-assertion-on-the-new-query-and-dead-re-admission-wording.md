---
id: TASK-1352
title: >-
  Summarize round-8 review residue - seam assertion on the new query and dead
  re-admission wording
status: To Do
assignee: []
created_date: '2026-11-04T18:59:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1335000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #2716 round-8 residue, filed at merge per the declared round-6 stop. (1) Minor, test coverage (02-code-standards core principle 7): no test checks the arguments crossing the new mocked seam - printReport could pass a wrong or missing personality id to FAILED_BY_ERROR_CLASS_SQL and every test would still pass; add expect(queryMock).toHaveBeenCalledWith(FAILED_BY_ERROR_CLASS_SQL, PERSONALITY_ID) (and the DEAD twin) to the positive test. The dead query had the same gap before this PR. (2) Nit, prose: the test comment says re-eligible before terminal but dead rows are re-admitted after a prompt-version bump (ELIGIBLE_PREDICATE admits dead with summary_prompt_version < current; ArchiveSummaryProcessor short-circuits only when isCurrent) - reword to terminal at the current prompt version, and optionally note the version-bump re-admission on the dead caption for operators mid-rollout.
<!-- SECTION:DESCRIPTION:END -->
