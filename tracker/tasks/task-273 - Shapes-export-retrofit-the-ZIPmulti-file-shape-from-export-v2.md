---
id: TASK-273
title: 'Shapes export: retrofit the ZIP/multi-file shape from export v2'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 273000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Shapes export: retrofit the ZIP/multi-file shape from export v2 — Owner 2026-07-15: shapes export is "a bit better [than the giant account JSON] but might need work too." Once export v2 proves the ZIP-with-per-section-files + both-formats shape, consider retrofitting shapes export to match (drop its format toggle, reuse the zip assembly + markdown formatters). **Promote when**: export v2 ships and the owner confirms the shape works in practice. Surfaced 2026-07-15 (account-export smoke debrief).

**Why:** One export UX across the bot beats two divergent ones.

**DECIDED 2026-08-14 (owner, TASK-599 digest): retrofit approved, low priority - owner confirmed the export-v2 ZIP shape works in practice, so the gate is met; shapes export drops its format toggle and reuses the zip assembly + markdown formatters.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner already approved the retrofit (2026-08-14, recorded in the task's own DECIDED note). Confirmed export v2's ZIP/multi-file shape shipped separately (`AccountExportAssembler.ts`/`AccountExportFiles.ts` reference zip handling), while `ShapesExportJob.ts` still has the old single-format toggle (`format === 'markdown' ? ... : ...`, producing one `.md` or `.json` file) — the retrofit itself hasn't been implemented yet. Purely an implementation task now, no remaining owner gate. Evidence: `grep -n "format|zip" services/ai-worker/src/jobs/ShapesExportJob.ts` → still the old markdown/json toggle, no zip; `git grep -rlin "\bzip\b" services` → zip handling exists only in the `AccountExport*` family, confirming export v2 shipped elsewhere and shapes export hasn't been retrofitted.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
