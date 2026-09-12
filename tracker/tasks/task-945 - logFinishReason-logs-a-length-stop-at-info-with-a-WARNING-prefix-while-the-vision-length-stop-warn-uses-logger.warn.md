---
id: TASK-945
title: >-
  logFinishReason logs a length stop at info with a WARNING prefix while the
  vision length-stop warn uses logger.warn
status: To Do
assignee: []
created_date: '2026-09-12 17:05'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 943000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/ai-worker/src/services/LLMInvoker.ts logFinishReason (a private method, ~597) logs a length finish reason at info level with a literal WARNING: prefix in the message, pinned by the test should log info with WARNING prefix when finish_reason is length. The vision path (warnIfLengthTruncated in VisionProcessor.ts, shipped in PR 2409) logs the same condition through logger.warn with a plain message and the finish reason as a field. Two conventions for one condition means a warn-level filter misses the text path. Surfaced by the PR 2409 review.
Fix shape: switch logFinishReason to logger.warn with the field-first shape the vision warn uses (finishReason as a field, no prefix in the message), update the pinned test to assert warn instead of info, and grep for other WARNING: prefixed info logs in ai-worker (grep -rn "WARNING:" services/ai-worker/src --include=*.ts) to sweep the class in the same PR.
Acceptance: a length finish reason on the text path emits one logger.warn with finishReason in its fields and no WARNING: prefix; the pinned test asserts warn; no info-level WARNING: prefixed log remains in ai-worker.
<!-- SECTION:DESCRIPTION:END -->
