---
id: TASK-986
title: Evaluate mnemos as input to the memory overhaul
status: To Do
assignee: []
created_date: '2026-09-15 00:37'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 982000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Owner shared https://github.com/Riley-Coyote/mnemos as a possible source of ideas for the memory overhaul lineage (doc-8 / doc-97). Nobody has read it; relevance is unknown and may be zero.

Fix shape: Read the repo README plus whatever architecture notes it carries. Record a verdict: which concepts map onto our retrieval / summarisation / fact-extraction seams, and which do not apply given the Postgres + pgvector + BullMQ stack we already run. Do NOT adopt anything mid-epic without an owner call.

Acceptance: a verdict exists on a durable surface. If something is worth taking, it becomes an idea doc naming the concept and the seam it touches. If nothing is, this task is archived with that reason recorded in the removing commit.
<!-- SECTION:DESCRIPTION:END -->
