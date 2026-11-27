---
id: TASK-221
title: Episode type value rename 'memory'→'episode' + zod vocabulary
status: To Do
assignee: []
created_date: 2026-07-06 00:00
updated_date: '2026-11-27T05:33:00Z'
labels:
  - area:db
  - size:S
  - state:dependent
dependencies: []
priority: low
ordinal: 221000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Episode `type` value rename 'memory'→'episode' + zod vocabulary — `memories.type` still uses legacy values ('memory'/'knowledge') vs the artifact's typed model (episode/fact/reflection/canon); facts live in their own table so the rename is cosmetic. **Promote when**: any migration touches the memories table anyway. Filed 2026-07-06 (Phase 2 plan).

**Why:** Avoids a solo migration for naming.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36

---

Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `Memory.type` still defaults to `"memory"` in the schema — the cosmetic rename is deliberately deferred to ride along with the next migration that touches the memories table, which hasn't happened yet. Evidence: `grep -n 'type.*String.*@default("memory")' prisma/schema.prisma` → line 847, unchanged default value.

---

author: backlog-pilot
created: 2026-11-26 23:44

---

NOTE (backlog pilot, 50-oldest sweep). The promote-when ("any migration touches the memories table anyway") has FIRED at least three times without the rename riding: migrations 20260906225604, 20260907161646, 20261018073136 all `ALTER TABLE "memories"` (verified on develop 2026-11-26; schema default still "memory" at prisma/schema.prisma:955). Either commit the rename to the next memories migration or close as declined — that decision is the owner's (data-value rename), raised in the pilot report. Task stays open, state:dependent.

---

created: 2026-11-27T05:33:00Z

---

Owner ruling 2026-11-27 (pilot re-rate, tzurot-b): commit the rename to the NEXT migration that touches the memories table. The trigger fired three times without the rename riding; this ruling makes the next touch carry it. Task stays open, state:dependent.

---
<!-- COMMENTS:END -->
