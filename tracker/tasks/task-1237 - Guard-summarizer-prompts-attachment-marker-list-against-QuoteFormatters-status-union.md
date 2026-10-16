---
id: TASK-1237
title: >-
  Guard summarizer prompt's attachment-marker list against QuoteFormatter's
  status union
status: To Do
assignee: []
created_date: '2026-10-16 16:51'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1225000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The summarizer prompt's attachment rule hand-lists the renderer's attachment status markers (untranscribed/undescribed/expired/unprocessed + the not-supported stub). A new status added to services/ai-worker/src/services/prompt/QuoteFormatter.ts would quietly fall outside the rule. Cheap guard, per PR 2626 review round 3 finding 6: export the status union values as a const array from QuoteFormatter.ts and add a test asserting each value appears in SUMMARIZER_SYSTEM_PROMPT.
<!-- SECTION:DESCRIPTION:END -->
