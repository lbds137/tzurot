---
id: TASK-867
title: >-
  Skills economy pass: apply the four-question cut test to the largest skill
  bodies
status: Done
assignee: []
created_date: '2026-09-02 13:39'
updated_date: '2026-09-03 00:44'
labels:
  - 'area:skills'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 867000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the skills corpus is the biggest re-injected context surface (roughly 240k bytes) and has only ever grown. Owner decision 2026-09-02: run the pass in beta.214 alongside the measuring surface.

Fix shape: once the skills lines:check surface lands, run --breakdown and take the top three skills by bytes. Apply the doc-audit skill section 3b cut test (constraint or narrative; would a reader act differently; said in more than one layer; made structural by a gate since) passage by passage. One review-gated PR per pass with before/after bytes in the body and each cut justified by its question number; ratchet DOWN with --surface skills. Contested passages are cut and named in the PR body — the owner restoring one line is cheaper than the corpus keeping ten.

Acceptance: a measured byte reduction on the top three skills; every procedure in them still works as written; the skills baseline is ratcheted down in the same commit.
<!-- SECTION:DESCRIPTION:END -->
