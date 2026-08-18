---
id: TASK-659
title: Tighten forwardedFrom.timestamp at the request boundary only
status: To Do
assignee: []
created_date: '2026-08-18 14:57'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 659000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review finding on PR #2141. forwardedOriginSchema declares timestamp as z.string().optional() while PatchForwardedOriginRequestSchema.messageTime uses z.string().datetime(). Both are documented ISO-8601, so a malformed forwardedFrom.timestamp passes the request schema unnoticed.

Why the OBVIOUS fix is wrong: forwardedOriginSchema is reached through messageMetadataSchema, which parseMessageMetadata (packages/conversation-history/src/ConversationMessageMapper.ts:147-160) runs over every STORED row -- and on any failure it returns undefined for the ENTIRE blob, discarding referencedMessages, embedsXml, voiceTranscripts and reactions along with the bad field. Adding .datetime() there converts a field that currently degrades safely into a total-metadata loss. Same hazard that got the empty-object refine declined earlier in the same PR.

Current behaviour is safe, verified rather than assumed: promptTime -> formatPromptTimestamp -> parseTimestamp returns empty string on an invalid date, so the renderer emits no t= attribute instead of throwing.

Fix shape: strictness belongs at the WRITE boundary, not on the shared schema that also parses reads. In PatchForwardedOriginRequestSchema, take forwardedOriginSchema.extend({ timestamp: z.string().datetime().optional() }) so an inbound backfill is rejected at the door while stored rows stay leniently parsed.

Also in scope, same file pair (review nitpick 2): handlePatchForwardedOrigin logs a debug "matched no row" on any false from mergeForwardedOrigin, including the case where the writer already emitted a warn for a real DB error. Thread the distinction if this ever needs alerting.

Acceptance: a malformed timestamp is rejected by the request schema; a stored row carrying one still parses and still yields its other metadata keys, pinned by a test.
<!-- SECTION:DESCRIPTION:END -->
