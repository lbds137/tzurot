---
id: TASK-964
title: >-
  Relationship, locked, and corrected facts have no reserved slot in the prompt
  facts block
status: Done
assignee: []
created_date: '2026-09-13 17:49'
updated_date: '2026-09-14 01:40'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 961000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner observation 2026-09-13 on dev — Emily reacted with surprise to being called her angelic girlfriend, a status that IS a stored fact ("Lila addresses Emily angel persona as her angelic girlfriend"); the next-turn payload carried that fact and she corrected herself. Mechanism, grounded: the prompt facts block is the top FACT_RETRIEVAL_LIMIT = 10 facts (services/ai-worker/src/services/FactRetriever.ts) ordered by cosine distance to the current message, with valid_from and salience only as tiebreaks — the FactStore comment (services/ai-worker/src/services/extraction/FactStore.ts ~137–140) records that full type/salience weighting is not implemented. Emily has 1,195 facts; a relationship-status fact wins one of ten slots only on turns whose message resembles it. Locked and corrected-tier facts are guaranteed a place in the EXTRACTOR context (FactStore ~27), not in the prompt. This is the substrate of the relationship carve-out the owner ruled on 2026-09-13 (doc-97 Phase 2 v2, TASK-950): a form of address or relationship recorded as a fact is meant to be kept, and it cannot be kept when it is not in the block.
Fix shape: reserve a small number of slots (2–3, constant beside FACT_RETRIEVAL_LIMIT) for facts that must always render regardless of query similarity — the isLocked and corrected-tier facts first, then facts tagged commitment:address or otherwise relationship-typed (entityTags carry kind:name; check which kinds the extractor emits for relationship status before hard-coding one) — and fill the remaining slots by similarity as today, deduplicating. Stay inside factBudget (FACT_BUDGET_MAX_TOKENS / FACT_BUDGET_MAX_FRACTION). Log the reserved count in the retrieval log line so the effect is observable. One unit test where a relationship fact with low similarity to the query still renders; one where the reserved set is empty and the block is unchanged from today.
Acceptance: on a turn whose message does not resemble the relationship fact, the fact still appears in the facts block; the count of reserved facts is logged; FACT_RETRIEVAL_LIMIT behaviour for the similarity-filled slots is unchanged.
<!-- SECTION:DESCRIPTION:END -->
