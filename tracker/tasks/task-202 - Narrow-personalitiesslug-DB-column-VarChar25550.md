---
id: TASK-202
title: 'Narrow personalities.slug DB column VarChar(255)→(50)'
status: To Do
assignee: []
created_date: '2026-07-24 00:00'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'area:docs'
dependencies: []
ordinal: 202000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Narrow `personalities.slug` DB column VarChar(255)→(50) — Code now guarantees ≤50 at every write path (`normalizeSlugForUser` cap, #1484), but the column stays VarChar(255) and pre-cap rows may exceed 50 (shapes imports never enforced length at persist). **Fix shape**: data migration first (re-normalize any >50 rows via the truncate+hash path, updating references), then the column narrowing, then `pnpm ops test:generate-schema`. **Promote when**: the next PR that PRODUCES A MIGRATION touching `personalities` — owner-designated trigger: ride along rather than running a standalone migration. (Sharpened 2026-07-24: the original wording said "touches `prisma/schema.prisma`", which a comment-only edit satisfies while offering no migration to ride along with — the letter fired without the intent.) Filed 2026-07-04 (owner deferral, post-beta.147). ~~**Rider**: stale doc-comment citing the deleted `docs/planning/SLASH_COMMAND_ARCHITECTURE.md`~~ ✅ DONE — rewritten to state the invariant (per-persona cutoffs) instead of pointing at a dead path.

**Why:** Schema permits what code forbids; drift is invisible until an out-of-band write bypasses the app layer.
<!-- SECTION:DESCRIPTION:END -->
