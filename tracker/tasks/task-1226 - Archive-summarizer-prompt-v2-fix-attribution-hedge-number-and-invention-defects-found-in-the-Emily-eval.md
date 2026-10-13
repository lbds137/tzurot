---
id: TASK-1226
title: >-
  Archive summarizer prompt v2: fix attribution, hedge, number and invention
  defects found in the Emily eval
status: To Do
assignee: []
created_date: '2026-10-13 01:26'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1215000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1224 eval (docs/local/emily-eval/REPORT.md, local) checked the 400 most-recalled Emily summaries against the original exchanges: 79.5% faithful, 87 defect rows (OMISSION 31, DISTORTION 20, ATTRIBUTION 18, HEDGE_LOST 15, TENSE_STATE 3), 4 serious, including conditional dosing advice made unconditional and an invented symptom. High priority: the defects concentrate in health and medication content the character later repeats as fact.

What: prompt v2 for the memory-archive summarizer: never attribute Emily or quoted-block content to the user; label or drop the [Referenced content] block; keep hedges and conditional advice as written; keep every number, dose count, deadline and duration, with the exchange date given so relative words become dates; record final state (returned, stopped) and plan vs done; a safety keep-list (medical thresholds, dosing conditions, when to see a doctor); no invention, never summarize an attachment marked not analysed; when Emily corrects a figure write corrected from X. Bump summary_prompt_version so v1 rows re-summarize, in order of retrieval_count.

Acceptance: re-run the eval pass-3 check (summary-prompt.md, same 400 memories re-summarized on a dev copy or via a dry-run path) and reach at least 90% faithful with zero serious defects.
<!-- SECTION:DESCRIPTION:END -->
