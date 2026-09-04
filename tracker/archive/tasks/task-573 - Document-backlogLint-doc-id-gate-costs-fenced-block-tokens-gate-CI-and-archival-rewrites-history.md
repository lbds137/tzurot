---
id: TASK-573
title: >-
  Document backlogLint doc-id gate costs: fenced-block tokens gate CI and
  archival rewrites history
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
updated_date: '2026-09-04 19:59'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 573000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: checkDocIdRefs deliberately skips stripCode (backticks ARE the reference convention), so (1) a fenced code block demonstrating the convention with a made-up id (doc-99) is a hard gate failure, and (2) ids resolve only against live tracker/docs/ - archiving/renumbering a doc converts every historical mention across backlog/** and tracker/tasks/** into CI failures requiring prose rewrites (#2063 itself prose-ified two shipped-theme references to go green). Working as designed for rot-detection; the forced-rewrite cost is stated nowhere the next archiver will look.

Fix shape: document the cost at the archival decision point (06-backlog or the gate error message); optionally an inline escape (e.g. doc-N marked as historical).

Source: 2026-08-12 review, tooling L1 CONFIRMED.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:59
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-90 (Idea Hook and skill hardening residue — fail open branches and unprobed arms); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-573 finds it.
---
<!-- COMMENTS:END -->
