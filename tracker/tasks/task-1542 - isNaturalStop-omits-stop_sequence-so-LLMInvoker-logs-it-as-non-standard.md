---
id: TASK-1542
title: isNaturalStop omits stop_sequence, so LLMInvoker logs it as non-standard
status: To Do
assignee: []
created_date: '2026-11-25T10:20:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1540000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/ai-worker/src/services/LLMInvoker.ts logs any finish reason outside NATURAL_STOP_REASONS (common-types constants/finishReasons.ts) at info as a non-standard completion. FINISH_REASONS.STOP_SEQUENCE is a natural completion on a configured stop sequence, and telemetry:upstream already counts it as stop through a report-local list (PR 2810).

What: decide whether stop_sequence joins NATURAL_STOP_REASONS; if it does, drop the report-local list in packages/tooling/src/telemetry/upstream-report.ts.

Acceptance: one definition of natural stop shared by the invoker log and the report, with a test.
<!-- SECTION:DESCRIPTION:END -->
