---
id: TASK-154
title: Extract the ContextStep pass-through test stub to test-utils
status: To Do
assignee: []
created_date: '2026-06-19 00:00'
updated_date: '2026-09-04 19:43'
labels:
  - 'area:ai-worker'
  - 'area:testing'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extract the `ContextStep` pass-through test stub to test-utils

**Why:** The class-form `ContextStep` stub (pass-through returning an empty `preparedContext`) is duplicated verbatim in `AIJobProcessor.component.test.ts` and `LLMGenerationHandler.test.ts` — both stub it so legacy-shaped fixtures don't trip the `kind:'envelope'` contract. CPD doesn't fire (class-body, not call-expression) and `pnpm quality` is green, so it's not a gate concern. **Fix shape**: a shared `makeContextStepStub()` in `@tzurot/test-utils` (or an ai-worker test helper) imported by both files. **Promote when**: a THIRD consumer needs the same stub. Surfaced 2026-06-19 by PR #1269 claude-review (non-blocking cold follow-up). Deferred 2026-06-19.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:43
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: the third consumer of the ContextStep stub copies it from one of the two.
---
<!-- COMMENTS:END -->
