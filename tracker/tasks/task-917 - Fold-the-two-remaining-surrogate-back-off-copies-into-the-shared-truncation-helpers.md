---
id: TASK-917
title: >-
  Fold the two remaining surrogate back-off copies into the shared truncation
  helpers
status: To Do
assignee: []
created_date: '2026-09-09 00:18'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 915000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the browse-truncation PR moved the code-point and UTF-16 truncation variants into packages/common-types/src/utils/codePointTruncation.ts, but its enumeration only saw the code-point-spread idiom. Two copies of the high-surrogate back-off survive outside it, both verified by grep -rn 0xd800 across services and packages (non-test): packages/clients/src/clients/errors.ts:152 (truncateForLog, a no-suffix UTF-16 cut that is a drop-in for truncateToUtf16Units(text, RAW_ERROR_BODY_MAX_CHARS) — the clients package already depends on common-types) and services/ai-worker/src/services/prompt/MemoryNoteSplitRender.ts:46 (capUserTurn, a word-boundary search with a hard-cut fallback; only the range literals are shared, so it imports the HIGH_SURROGATE_MIN and HIGH_SURROGATE_MAX constants rather than delegating — those need exporting first).

What: delegate truncateForLog; export the two range constants and import them in the note splitter; add the cheap value.length <= maxCodePoints fast-path to truncateByCodePoints so a short string skips the array spread (a code point never exceeds one UTF-16 unit in count, so the guard is exact).

Acceptance: grep -rn 0xd800 across services and packages (non-test) matches only codePointTruncation.ts; the clients and ai-worker suites stay green; a canary that reverts the errors.ts delegation reddens its existing truncation test or a new one. Source: claude-review round 4 on the browse-truncation PR.
<!-- SECTION:DESCRIPTION:END -->
