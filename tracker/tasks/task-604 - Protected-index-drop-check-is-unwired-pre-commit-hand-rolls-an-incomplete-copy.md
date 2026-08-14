---
id: TASK-604
title: >-
  Protected-index drop check is unwired: pre-commit hand-rolls an incomplete
  copy
status: Done
assignee: []
created_date: '2026-08-14 12:02'
updated_date: '2026-08-14 16:37'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 604000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: VERIFIED 2026-08-14 during PR 2099 review. `.husky/pre-commit` hand-rolls its own grep-based drop-without-recreate check (lines ~202-217) covering only idx_memories_embedding and memories_chunk_group_id_idx. idx_memory_facts_embedding is absent — grep confirms the name appears nowhere in .husky/pre-commit. That is a FOURTH copy of the protected-index registry, and the least complete one.

Worse, the tool that does have the full list is not wired into anything that gates. `db:check-safety` appears exactly once outside its own source: the `check:migrations` alias in package.json. It is NOT in the pnpm quality chain, NOT in any .github/workflows file, and NOT in .husky. So today a migration dropping idx_memory_facts_embedding without recreating it passes pre-commit silently and has no CI backstop; the only net is the weekly `pnpm ops health` roster entry, which reports rather than blocks.

Stakes: 03-database.md flags these as CRITICAL — dropping an IVFFlat index degrades the affected queries to sequential scans, a silent ~100x slowdown rather than a visible failure.

Fix shape: replace the hand-rolled grep block in .husky/pre-commit with a call to `pnpm ops db:check-safety`, so the hook consumes the derived registry instead of maintaining a fourth copy that can drift. Adding the missing third grep would be the WRONG fix — it entrenches the copy. Consider also adding it to the quality chain or CI so the gate is not local-only. Hook edits need their probe updated (guard:hook-probes) and the pre-commit latency checked, which is why this was not folded into PR 2099.

Acceptance: a migration that drops any one of the three protected indexes without recreating it is rejected before merge; no index name is hardcoded in .husky/pre-commit; the WHY.md "Where it actually runs" section is updated to match.
<!-- SECTION:DESCRIPTION:END -->
