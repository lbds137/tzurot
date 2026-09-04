---
id: TASK-362
title: >-
  system_prompts.isDefault has no partial unique index (parity with llm/tts
  configs)
status: To Do
assignee: []
created_date: '2026-07-30 18:46'
updated_date: '2026-09-04 20:07'
labels:
  - 'size:S'
  - 'area:db'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 362000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `system_prompts` has no constraint preventing two rows with
`isDefault: true`, unlike `llm_configs` and `tts_configs`, which both carry
partial unique indexes for exactly this (`llm_configs_default_unique`,
`tts_configs_free_default_unique` — see `03-database.md` § Protected Indexes).
Every reader uses `findFirst({ where: { isDefault: true } })` with no
`orderBy`, so with two default rows the one returned is whatever the planner
picks first — not stable across queries or deploys.

Pre-existing and NOT introduced by #1873; the same query shape already lives in
`admin/createPersonality.ts` and `user/personality/create.ts`. #1873 adds a
third reader (`DescriptionPromptService`), which is what makes the parity gap
worth recording: the row it picks frames every image description the instance
writes, so an unstable pick would be an unstable framing.

**Fix shape**: a partial unique index `WHERE is_default = true`, mirroring the
llm/tts pattern — and note it must go in `prisma/drift-ignore.json`'s
`ignorePatterns`, because Prisma cannot represent partial unique indexes and
will try to DROP it on every subsequent migration (that is precisely why the
existing entries are listed there).

**Promote when**: a second `isDefault` row is observed in any environment, OR
the next migration that touches `system_prompts` for another reason (the index
is cheap to add while already editing that table).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:07
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-95 (Idea Config service and config schema refactor family); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-362 finds it.
---
<!-- COMMENTS:END -->
