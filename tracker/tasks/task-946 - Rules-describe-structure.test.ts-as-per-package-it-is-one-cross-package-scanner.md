---
id: TASK-946
title: >-
  Rules describe structure.test.ts as per-package; it is one cross-package
  scanner
status: To Do
assignee: []
created_date: '2026-09-12 21:06'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 944000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: .claude/rules/02-code-standards.md states that All packages are enforced by structure.test.ts - services, common-types, embeddings, AND tooling. Verified 2026-09-12 during PR 2410: exactly one structure.test.ts exists repo-wide, packages/common-types/src/structure.test.ts, and it is a cross-package scanner whose dirs list names packages/test-utils/src and packages/tooling/src among others. The claim is true in effect but wrong in form. A reader who greps for packages/tooling/src/structure.test.ts finds nothing and cannot tell whether the enforcement is missing or merely lives elsewhere, which is exactly the ambiguity that cost a premise-ledger row and an orchestrator detour in that PR.
Fix shape: reword the sentence to name the single scanner and its dirs list as the mechanism, so the reader knows where to look and what it covers. Rules are a review-gated surface, so this rides a PR - the next rules-editing PR is a fine home for it.
Acceptance: the rule names packages/common-types/src/structure.test.ts as the one scanner and says which package roots its dirs list covers.
<!-- SECTION:DESCRIPTION:END -->
