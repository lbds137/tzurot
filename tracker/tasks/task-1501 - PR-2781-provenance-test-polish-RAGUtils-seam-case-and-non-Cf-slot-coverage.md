---
id: TASK-1501
title: 'PR 2781 provenance test polish: RAGUtils seam case and non-Cf slot coverage'
status: To Do
assignee: []
created_date: '2026-11-22T03:25:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1501000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR 2781 (TASK-1485) approved with zero blocking findings and noted four non-blocking test/doc polish items (minor seam coverage, asymmetric non-Cf slot tests, fullwidthOpener spelling consistency, optional false-positive JSDoc clause).
What: add one RAGUtils.test.ts seam case sending an intra-label or non-Cf forged header through the real description path; add non-Cf colon-to-space and non-Cf multi-word-label cases in packages/common-types/src/utils/attachmentProvenance.test.ts; use fullwidthOpener consistently across the new rows; optionally note the accepted VS/Hangul-filler false-positive trade-off in HEADER_INVISIBLE_SOURCE JSDoc.
Acceptance: all four polish items addressed and tests pass.
<!-- SECTION:DESCRIPTION:END -->
