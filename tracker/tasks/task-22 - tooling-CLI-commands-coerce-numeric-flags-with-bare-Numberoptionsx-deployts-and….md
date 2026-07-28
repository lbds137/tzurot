---
id: TASK-22
title: 'Tooling CLI numeric flags: bare Number(options.x) coercion'
status: To Do
assignee: []
created_date: '2026-07-10 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-10 — tooling CLI commands coerce numeric flags with bare `Number(options.x)` (deploy.ts and siblings; reviewer-noted while fixing backfill-facts, which now validates): NaN flows into comparisons that silently no-op. **Fix shape**: sweep `packages/tooling/src/commands/*.ts` for `Number(` coercions and add `Number.isInteger`/bounds validation (or a shared parseIntFlag helper). **Promote when**: next tooling-commands hygiene pass.

**Why:** NaN comparisons are always-false — flags silently ignore themselves; backfill-facts showed the worst case (an uncapped canary).
<!-- SECTION:DESCRIPTION:END -->
