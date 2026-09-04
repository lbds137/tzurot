---
id: TASK-806
title: 'ZAI_MODEL_CATALOG has no sync mechanism — hand-curated, drift-prone'
status: To Do
assignee: []
created_date: '2026-08-29 00:04'
updated_date: '2026-09-04 20:04'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 806000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner asked (2026-08-27) "does z.ai have a models endpoint like OpenRouter?" — probed same session: /models exists but is 401-gated behind auth and returns no syncable metadata (no vision/context-length fields), so the catalog stays hand-curated. The open sync question was never filed; mining run 2026-08-28 caught it.

What: the catalog lives in packages/common-types/src/constants/ai.ts (ZAI_MODEL_CATALOG, read at ai.ts:616). Every new z.ai model (glm-5.3-flash was the trigger) needs a manual entry, and a missing entry silently degrades routing/capability checks. Options to evaluate: (a) authenticated periodic probe comparing /models ids against catalog keys, warn-only, in the weekly ops health sweep; (b) a release-checklist line; (c) accept hand-curation and document the update path next to the constant.

Acceptance: one option chosen and implemented (or explicitly ruled out with the reason), and the catalog constant carries a comment naming how it stays current.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:04
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-93 (Idea External release watch list — read at dependency bump time); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-806 finds it.
---
<!-- COMMENTS:END -->
