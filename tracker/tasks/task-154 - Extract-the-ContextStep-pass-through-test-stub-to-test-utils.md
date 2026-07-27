---
id: TASK-154
title: 'Extract the ContextStep pass-through test stub to test-utils'
status: To Do
assignee: []
created_date: '2026-06-19 00:00'
labels:
  - 'area:ai-worker'
  - 'area:testing'
dependencies: []
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extract the `ContextStep` pass-through test stub to test-utils

**Why:** The class-form `ContextStep` stub (pass-through returning an empty `preparedContext`) is duplicated verbatim in `AIJobProcessor.component.test.ts` and `LLMGenerationHandler.test.ts` — both stub it so legacy-shaped fixtures don't trip the `kind:'envelope'` contract. CPD doesn't fire (class-body, not call-expression) and `pnpm quality` is green, so it's not a gate concern. **Fix shape**: a shared `makeContextStepStub()` in `@tzurot/test-utils` (or an ai-worker test helper) imported by both files. **Promote when**: a THIRD consumer needs the same stub. Surfaced 2026-06-19 by PR #1269 claude-review (non-blocking cold follow-up). Deferred 2026-06-19.
<!-- SECTION:DESCRIPTION:END -->
