---
id: TASK-255
title: Share arm-name constants if a third fold-eval glue script appears
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-09-04 19:44'
labels:
  - 'origin:review'
  - 'area:tooling'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 255000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Share arm-name constants if a third fold-eval glue script appears — `ARMS`/`DENSE_SWEEP` arm-name string literals (`bare-dense`, `fold3-dense`, …) are duplicated between `foldAwarePooling.eval.test.ts` (producer) and `foldAwareScoring.eval.test.ts` (consumer) — two independently-run local scripts with intentionally no runtime dependency, so reviewer ruled it below the wrong-abstraction ceiling today. **Fix shape**: lift the arm names into `qrelsReconciliation.ts` (already the shared-types home) as an exported const. **Promote when**: a third eval glue script joins the fold-pool family. Surfaced 2026-07-12 (#1613 final review).

**Why:** Two copies is fine; three is a registry.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:44
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: the third fold-eval glue script copies one of the two.
---
<!-- COMMENTS:END -->
