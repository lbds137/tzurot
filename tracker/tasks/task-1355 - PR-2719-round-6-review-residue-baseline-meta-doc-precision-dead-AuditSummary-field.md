---
id: TASK-1355
title: >-
  PR 2719 round-6 review residue: baseline-meta doc precision + dead
  AuditSummary field
status: To Do
assignee: []
created_date: '2026-11-05T17:41:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
type: docs
ordinal: 1338000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #2719 (TASK-1320) merged with round-6 review items filed rather than iterated (6-round cap; verdict: no blocking findings). Items, reviewer-verified:
1. JSDoc + audit-enforcement.md overstate provenance: merge-base reads the LOCAL origin/develop ref (never fetched), so a stale ref records an older commit than the true branch point. Say "at or before the base, as of the last fetch" or accept (reviewer offers either).
2. AuditSummary.meta.generatedFromSha (summary.ts:49) is optional and unpopulated — no src producer sets it (verified by grep on the merge head b0d0eb55f: only the declaration, the baseline-writers field-list string at cpd.ts:134, and test fixtures). Preferred: delete the dead field.
3. buildBaselineMeta JSDoc runtime claims need hedges per 02-code-standards: "re-run records the same base" and "stays an ancestor of develop unless history rewritten" — hedge "(by git semantics; not tested here)".
4. Rename private getGitSha() -> getDevelopBaseSha() to match the merge-base contract.
5. Test title "records unknown when the git read rejects (git absence)" -> "(throws)" — the mock covers all throw shapes.
Real-git seam stays untested (reviewer-checked acceptable: shallow checkouts degrade to unknown, no flake).
<!-- SECTION:DESCRIPTION:END -->
