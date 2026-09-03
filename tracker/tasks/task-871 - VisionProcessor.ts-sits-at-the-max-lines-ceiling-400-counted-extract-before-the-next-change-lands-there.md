---
id: TASK-871
title: >-
  VisionProcessor.ts sits at the max-lines ceiling (400 counted) - extract
  before the next change lands there
status: Done
assignee: []
created_date: '2026-09-02 22:51'
updated_date: '2026-09-03 02:10'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 871000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the #2309 round-1 fix (single-flight coalesced attribution + a noop-bound notifier to hold complexity at 20) took services/ai-worker/src/services/multimodal/VisionProcessor.ts to exactly 400 ESLint-counted lines (skipBlankLines + skipComments), the max-lines limit. The next added line fails lint. describeImage also sits at complexity 20, the warn ceiling that the package lint script (eslint src --max-warnings=0) turns into a failure.

Fix shape: extract the cache-hit + single-flight preamble of describeImage (the readValidCachedDescription branch, enterSingleFlight, the coalesced return) into a colocated module with its own test, keeping the onAttribution seam tests green; measure with the eslint max-lines one-liner before and after. size:S, one file split.

Acceptance: VisionProcessor.ts under 360 counted lines and describeImage under complexity 18, with the existing VisionProcessor and single-flight suites unchanged in meaning.

Correction (while building): extracting the preamble ALONE cannot meet this acceptance. The preamble is 25 counted lines, and max-lines runs with skipComments, so removing it lands the file near 381 against the 360 threshold. The shipped seam is wider - a visionDescribeGates module also taking VisionModelError, both category sets, buildFailureFallback and checkNegativeCache, 128 counted lines total. See PR 2312.
<!-- SECTION:DESCRIPTION:END -->
