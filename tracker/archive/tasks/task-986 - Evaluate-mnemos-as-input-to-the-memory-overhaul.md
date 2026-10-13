---
id: TASK-986
title: Evaluate mnemos as input to the memory overhaul
status: To Do
assignee: []
created_date: '2026-09-15 00:37'
updated_date: '2026-10-13 01:45'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-10-12 (AskUserQuestion, backlog review Batch B owner calls): READ IT NOW, cheaply: one cheap reader writes the verdict; worth-taking concepts become an idea doc, otherwise archive with the reason.

Verdict 2026-10-12: the shared link now resolves to Riley-Coyote/mnemos-hermes (old name 404s; successor not confirmed), a 1-star 0.1.0-alpha local SQLite memory for Hermes Agent, MIT, last push 2026-08-02. Its concepts each map to something Tzurot already has or has filed: scoped recall (persona scoping), bounded recall caps (memoryLimit / memoryScoreThreshold), an explicit correct/supersede/forget tool (/memory facts Correct, Forget, Lock), agent-invoked recall tools (TASK-1222 direction). Its docs do not describe ranking, extraction or supersession internals, the parts that would be new. Ruled out: nothing to take; revisit only if it publishes those mechanisms.
<!-- SECTION:NOTES:END -->
