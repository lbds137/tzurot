---
id: TASK-1225
title: >-
  Record per-turn generation provenance on assistant turns: model path,
  settings, memory and fact ids
status: To Do
assignee: []
created_date: '2026-10-13 01:20'
updated_date: '2026-10-13 01:20'
labels:
  - 'area:ai-worker'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1214000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner 2026-10-12, from the TASK-1224 Emily eval: we cannot tell which memories and facts were in the prompt for a given reply. The full rendered prompt lives only in llm_diagnostic_logs, kept 24 hours (schema.prisma model LlmDiagnosticLog). memories.last_retrieved_at / retrieval_count (slice C1, PgvectorMemoryAdapter.ts stampRetrieval) are aggregates with no per-turn link. The eval readers could attribute almost no error to a source because reasoning paraphrases notes instead of quoting them; with ids, an error can be traced to the exact stored summary or fact.

What: when the assistant turn is persisted, add a retrieval block to conversation_history.message_metadata (JSONB, so no migration): the injected memory ids with each note render arm (summary / user turn + linked facts / verbatim fallback / user turn only), the fact ids (retrieved and linked), the digest id if one rendered, and a short hash of each rendered note text so later re-summarization or fact supersession is detectable. Ids and hashes only, never content (doc-12 hard constraint). Size estimate: about 50 uuids, ~2 KB per assistant turn, bounded by the 30-day history window. Written in the same create as the turn, so no extra write and no updated_at bump on a sync-tracked table (03-database.md). The memories table needs no change for this.

Scope widened (owner 2026-10-12): "store as much metadata as is reasonable with conversation turns/pairs, to make this kind of debugging easier; otherwise we are left to guess what the ingredients were for responses that did not go as hoped". Today message_metadata (messageMetadataSchema in common-types types/schemas/message.ts) carries only INPUT context (referencedMessages, embedsXml, voiceTranscripts, reactions, forwarded, channelEnvironment); nothing about how the reply was generated. So the block is a generation-provenance record on each assistant turn, ids and settings only:
- Model: provider, model id, llm config id, key mode (own key / guest / system), reasoning effort, and the fallback chain actually taken (retries, quota retargets, auto-promotion), with tokens per attempt (also closes TASK-1223 gap 2).
- Prompt: release version or git sha, the effective memory settings (memoryLimit, memoryScoreThreshold), the context window, and the history window (turns included, turns dropped for budget).
- Retrieval: the memory and fact ids above, the digest id, and any vision or voice description ids used.
- Joins: requestId (llm_diagnostic_logs while it lives) and the usage_logs row.
Decide during design which fields belong on the turn and which can be joined from usage_logs; avoid storing twice.

Acceptance: a read-only query (or ops command) lists, for any assistant turn in the window, its generation record: model and fallback path, effective settings, the injected memory ids with render arm, the fact ids, and whether each note text still matches its hash today. The TASK-1224 rerun uses it.
<!-- SECTION:DESCRIPTION:END -->
