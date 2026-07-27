---
id: TASK-255
title: 'Share arm-name constants if a third fold-eval glue script appears'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 255000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Share arm-name constants if a third fold-eval glue script appears — `ARMS`/`DENSE_SWEEP` arm-name string literals (`bare-dense`, `fold3-dense`, …) are duplicated between `foldAwarePooling.eval.test.ts` (producer) and `foldAwareScoring.eval.test.ts` (consumer) — two independently-run local scripts with intentionally no runtime dependency, so reviewer ruled it below the wrong-abstraction ceiling today. **Fix shape**: lift the arm names into `qrelsReconciliation.ts` (already the shared-types home) as an exported const. **Promote when**: a third eval glue script joins the fold-pool family. Surfaced 2026-07-12 (#1613 final review).

**Why:** Two copies is fine; three is a registry.
<!-- SECTION:DESCRIPTION:END -->
