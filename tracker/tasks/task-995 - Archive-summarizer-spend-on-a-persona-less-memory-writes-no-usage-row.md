---
id: TASK-995
title: Archive summarizer spend on a persona-less memory writes no usage row
status: To Do
assignee: []
created_date: '2026-09-16 20:19'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 991000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ArchiveSummaryProcessor bills a model call for every memory it summarizes, but the usage-row write early-returns when the memory has no persona owner (ownerId === null), so that spend is billed by the provider and invisible in usage_logs. The daily cap and any cost report undercount by exactly those calls. Found by reading (docs/local/handoffs/ground-doc97p4-C-summarizer.md, gitignored, surprise 1); not runtime-confirmed. Positive control: a usage row IS written for persona-owned memories (request_type archive_summary).
Fix shape: write the row with a null owner (the schema allows it or a sentinel system owner), or attribute to the personality; pin with a test that a persona-less memory produces one usage row. Check fact_extraction for the same early-return.
Acceptance: every archive_summary model call yields one usage_logs row; the count of persona-less rows is reported once from prod after deploy.
Found by the doc-97 Phase 4 grounding pass, 2026-09-16.
<!-- SECTION:DESCRIPTION:END -->
