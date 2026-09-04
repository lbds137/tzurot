---
id: TASK-874
title: >-
  Three structurally identical vision cache-key option types should share one
  exported definition
status: To Do
assignee: []
created_date: '2026-09-03 02:09'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 874000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR 2312 flagged that DescribeGateKeyOptions in services/ai-worker/src/services/multimodal/visionDescribeGates.ts, SingleFlightKeyOptions at services/ai-worker/src/services/multimodal/visionSingleFlight.ts:41, and VisionCacheKeyOptions at services/ai-worker/src/services/VisionDescriptionCache.ts:81 are the same shape - attachmentId optional string, url string, model optional string. Verified by reading all three definitions. Three names for one cache-identity concept can drift independently, and the canonical one is declared without export so neither sibling can reach it.

Disposition on merits, not on origin: this is a real consolidation worth doing, and it was NOT folded into PR 2312 because the fix crosses out of services/multimodal into services/VisionDescriptionCache.ts, requires exporting a type that is currently module-private by choice, and touches more than five lines - dispatch work rather than an inline tidy. Expanding a green refactor PR into a fourth module for zero runtime benefit was the worse trade.

Fix shape: export VisionCacheKeyOptions from VisionDescriptionCache.ts, import it in visionSingleFlight.ts and visionDescribeGates.ts, delete the two local interfaces. Keep the JSDoc on the surviving definition since it documents which key wins. Check for a fourth copy before starting - grep for the field triple rather than the type names, since a structural copy references no type name.

Acceptance: one exported type, the two local duplicates deleted, ai-worker typecheck and test suites green.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost it prevents (three names for one cache-identity concept that can drift independently); all three module-private interfaces are still separately declared exactly as described, freshly filed (2026-09-03) from a real PR review finding. Evidence: `grep -n "interface DescribeGateKeyOptions\|interface SingleFlightKeyOptions\|interface VisionCacheKeyOptions" services/ai-worker/src/services/multimodal/visionDescribeGates.ts services/ai-worker/src/services/multimodal/visionSingleFlight.ts services/ai-worker/src/services/VisionDescriptionCache.ts` → all three interfaces present, none exported/shared.
---
<!-- COMMENTS:END -->
