---
id: TASK-993
title: >-
  Reserved fact slot matches commitment:address case-sensitively while account
  deletion lowercases tags
status: To Do
assignee: []
created_date: '2026-09-16 20:17'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 989000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: FactStore.findReservedActiveFacts (services/ai-worker/src/services/extraction/FactStore.ts:270) reserves a slot on entity_tags && ARRAY[commitment:address] with an exact match. The extraction prompt asks for lowercase kind:name tags but the Zod validation (extractionPrompt.ts) only trims; nothing lowercases at write. The one other SQL tag consumer, AccountDeletionService.ts:173, compares lower(t.tag). A Commitment:Address tag would silently never reserve, with no distinguishing log. Trigger unverified: whether the model ever emits mixed case is unmeasured.
Fix shape: step 1 measure on prod, read-only: SELECT tag, count(*) FROM memory_facts, unnest(entity_tags) tag WHERE lower(tag) LIKE commitment:% GROUP BY tag. If any mixed-case rows exist, normalize at write (lowercase in the extraction validation) and change the reserved query to compare lower(). If zero, still normalize at write so the invariant is mechanical, and pin it with a test that a Commitment:Address tag reserves.
Acceptance: a fact tagged Commitment:Address fills a reserved slot; the write path lowercases tags; the prod count is recorded here.
Found by the doc-97 Phase 4 grounding pass, 2026-09-16.
<!-- SECTION:DESCRIPTION:END -->
