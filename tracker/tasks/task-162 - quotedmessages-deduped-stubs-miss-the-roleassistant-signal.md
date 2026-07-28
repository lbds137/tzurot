---
id: TASK-162
title: <quoted_messages> deduped stubs miss the role="assistant" signal
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`<quoted_messages>` deduped stubs miss the `role="assistant"` signal

**Why:** In `xmlMetadataFormatters.ts`, `formatStoredReferencedMessage` (the non-deduped path) computes `role` via `isAuthorAssistant(...)`, but the deduped path (`dedupedRefs.map` → `formatDedupedQuote`) omits it — so a deduped quote of a bot's own prior message in `<quoted_messages>` renders `<quote from="Lilith">` without `role="assistant"`. Same self-reply-confusion bug-class PR #1317 fixed on the live `<contextual_references>` path, but on the historical/stored path (lower stakes — it's prior-turn context, and the global anti-continuation `OUTPUT_CONSTRAINTS` partially covers it). Pre-existing on develop; #1317 only touched this file's test. **Fix shape**: in the `dedupedRefs.map` callback, derive `role` via the already-in-scope `isAuthorAssistant(authorName, personalityName, allPersonalityNames)` and pass it to `formatDedupedQuote`; consider also emptying bot-authored stub content for parity with the live path (secondary — stored text is already in history). Add a colocated test + refresh snapshots. **Promote when**: next touching `xmlMetadataFormatters.ts`, or a stored-path self-reply spiral is observed. Surfaced 2026-06-23 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
