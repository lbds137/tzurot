---
id: TASK-92
title: 'Memory retrieval Found: 20 / Included: 0 mystery (Focus Mode off)'
status: To Do
assignee: []
created_date: '2026-05-03 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:ai-worker'
  - 'area:embeddings'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Memory retrieval `Found: 20 / Included: 0` mystery (Focus Mode off)

**Why:** Diagnostic screenshot 2026-05-03 showed 20 candidate memories scored 0.65–0.71 with zero included despite Focus Mode off. Possible: similarity-threshold misconfigured (0.72+?), token-budget logic returning 0, ranking-filter pipeline dropping candidates. Same screenshot also showed `History > 70%! Sycophancy risk!` — context-budget pressure may be related. **Fix shape**: trace `MemoryService.retrieveRelevant() → MemoryBudgetManager → final-include filter`; add structured log between each stage so drop reason is visible in diagnostic. **Promote when**: a user reports degraded memory recall, OR opportunistic during next memory-pipeline pass. Surfaced 2026-05-03. Deferred 2026-05-12.

GROUNDING 2026-08-11 (pipeline traced end to end; the entry above is substantially stale).

FRESHNESS — the budget-starvation hypothesis was very likely fixed two months after
this was filed. `46b9df365` (2026-07-07, "joint memory/history allocation — end
starvation under history pressure") added `MEMORY_CONTENTION_FLOOR_RATIO`, so the
memory budget is now `max(0, min(hardCap, max(contentionFloor, sharedSpace -
historyTokens)))` — under history pressure it floors at 10% of shared space instead
of collapsing to zero. The screenshot's companion symptom (`History > 70%!
Sycophancy risk!`) is exactly the condition that fix targeted. Do NOT re-open the
starvation theory without a POST-2026-07-07 runtime observation.

WHAT SURVIVES, and it is a different bug — the diagnostic conflates two drop
reasons under one label, so a healthy pipeline reads as broken:

- `ConversationalRAGService.ts:402-436` hands `recordBudgetDiagnostics` the
  `retrievedMemories` from step 3, then step 4's `contentBudgetManager.allocate()`
  runs `filterShippedMemories` (`ContentBudgetManager.ts:168-214`). So the
  diagnostic's "found" count is PRE-dedup while `includedInPrompt` is
  POST-dedup-and-post-budget.
- `services/bot-client/src/commands/inspect/views.ts:331` computes
  `budgetDropped = allMemories.length - includedTotal` and line 365 renders the
  whole difference as `N dropped for budget`. The comment at 329-330 asserts that
  framing outright.
- STM/LTM dedup drops are CORRECT — the memory is already in the prompt as
  conversation history, so dropping it is the feature working. Labelling those as
  budget drops is what makes `Found: 20 / Included: 0` look like failed recall.

Fix shape (revised, then narrowed again — the payload ALREADY carries the right
number and the view ignores it, so this is a bot-client-only change):

- `DiagnosticTokenBudget.memoriesDropped` is fed from `budgetResult.memoriesDroppedCount`
  (`DiagnosticRecorders.ts:208`), which comes from
  `selectMemoriesWithinBudget(dedupedMemories, ...)` — `ContentBudgetManager.ts:248`
  builds `dedupedMemories` via `filterShippedMemories` and line 261 passes THAT into
  `selectMemories`. So `memoriesDropped` is already the PURE budget-drop count.
- `views.ts:331` ignores it and recomputes `allMemories.length - includedTotal`,
  which spans dedup + budget.

So: use `tokenBudget.memoriesDropped` for the budget figure, and derive the dedup
figure as `max(0, allMemories.length - includedTotal - tokenBudget.memoriesDropped)`.
Render them as separate labelled counts — something like
`N total · M included · B dropped for budget · D already in history`. No ai-worker
change, no new plumbing. Also fix the comment at views.ts:329-330, which asserts the
subtraction is budget-only.

Acceptance: a diagnostic where every candidate was dedup-dropped reads as
"already in history", not "dropped for budget". Cover both drop reasons and the
mixed case in the view test.

STATUS OF THIS CLAIM: code-read, NOT runtime-confirmed. The mechanism (subtraction
spans both filters) is established by reading both call sites. That the 2026-05-03
screenshot was THIS and not starvation is a hypothesis — plausible given the
companion history-pressure symptom, but unproven, and the starvation path was live
at that date. The fix is worth shipping either way: the mislabel is real
independent of what that screenshot showed.
<!-- SECTION:DESCRIPTION:END -->
