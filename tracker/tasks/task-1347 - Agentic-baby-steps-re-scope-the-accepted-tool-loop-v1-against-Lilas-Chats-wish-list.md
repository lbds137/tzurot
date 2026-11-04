---
id: TASK-1347
title: >-
  Agentic baby steps: re-scope the accepted tool-loop v1 against Lila's Chats
  wish-list
status: To Do
assignee: []
created_date: '2026-11-03T20:10:00Z'
labels:
  - area:ai-worker
  - size:L
  - state:owner
dependencies: []
priority: medium
ordinal: 1330000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (11-03) does work in the Claude Chats session that she would rather do with her Tzurot characters, and the missing agentic features are a sore point. The accepted design is docs/proposals/backlog/agentic-scaffolding.md (boulder #4, 07-05). v1 tools: recall_memories, web_search, generate_image. Phase 0 is the job-payload contract suite plus the capability gate. Its substrate, history as real messages, shipped with doc-17 phases 0-2 (backlog/active-epic.md).

Wish-list (Lila 11-03, all selected): look things up; dig through memories; read her files (docs, Drive, PDFs); keep notes and remember on purpose (overlaps doc-101); external connectors (Gmail, Google Calendar and more; she would have to rank them, and the number of them feels overwhelming).

What: Phase 0 plus the loop core plus recall_memories is common to every item, so it needs no ranking. Connectors are later tools on the same loop, and each one gets its own data-rights review (per-user OAuth tokens, a multi-user bot).

Owner clarification (2026-11-04, relayed via Deck, condensed): the motivation behind this task is retrieval quality itself — retrieval today is hit or miss, and in her view pure vector RAG is outdated; the agentic capability she names first is retrieval the model drives (search, filter, follow-ups), not a single embedding lookup. That strengthens the recall_memories-first recommendation below without changing it, and is recorded as re-entry design input in doc-8 (2026-11-04 entry). Not an answer to the owner question — that stays open for the owner.

Owner question: start Phase 0 and the loop with recall_memories as the first tool, leaving the connector ranking for later?
Recommendation: yes - every wish-list item needs the loop first, and recall_memories exercises it with no new data access.

Acceptance: the design doc v1 scope is updated with the wish-list ranking; Phase 0 specced.
<!-- SECTION:DESCRIPTION:END -->
