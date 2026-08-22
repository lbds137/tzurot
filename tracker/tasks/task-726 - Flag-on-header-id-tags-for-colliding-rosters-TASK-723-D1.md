---
id: TASK-726
title: Flag-on header id tags for colliding rosters (TASK-723 D1)
status: Done
assignee: []
created_date: '2026-08-22 13:47'
updated_date: '2026-08-22 18:47'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 726000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: flag-on headers carry the name only (RealMessagesBuilder.ts buildHeaderLine), so duplicate-name rosters have no identity mechanism — the last realMessagesEnabled flip gate, design settled 4-0 in prompt-assembly-architecture.md 9d D1.
What: collision-conditional (id:xxxx) tag in headers (fixed 4-hex UUID prefix, extend-all-on-prefix-collision); ONE shared normalized collision predicate (NFKC+casefold+trim+zero-width) reused by ParticipantFormatter and RealMessagesBuilder; sanitizeHeaderName strips (id:...) shapes AFTER bracket conversion and neutralizes the em-dash separator in names; trim leading blank lines from bodies; WORST_CASE_HEADER_ID_SUFFIX_TOKENS in measureHistoryEntryRealTokens; roster note names the mechanism + metadata/authority instruction lines.
Acceptance: colliding rosters render tagged headers bound to roster ids; non-colliding channels byte-identical; name-slot forgery impossible (test pins the strip); measure charges the constant.

Rider (from #2183 rounds 3-4, accepted): while re-touching these signatures, make realMessagesEnabled REQUIRED (no default) on buildRealMessages, renderHistoryEntryForMeasure, measureHistoryEntryTokens, measureHistoryEntryRealTokens, serializeCrossChannelHistory, countHistoryTokens (every production site already threads explicitly — fixture churn only); and add the missing cross-channel flag-on dedup-wording pin (a cross-channel group with a deduplicated reference rendered realMessagesEnabled:true asserts the real-messages stub wording — a hardcoded false at that call site currently compiles and passes).
<!-- SECTION:DESCRIPTION:END -->
