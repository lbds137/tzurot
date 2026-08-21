---
id: TASK-533
title: Persona bio text is logged as contentPreview at debug level
status: Done
assignee: []
created_date: '2026-08-11 21:31'
updated_date: '2026-08-13 23:01'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 533000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found while closing the personaName PII-logging class in MemoryRetriever during PR 2067 (reviewer flagged three sites in the new helper; a sweep of the same function found five more). Four were display names and were fixed in that PR. This one was deliberately left, because it is a different question and answering it inside a map-keying PR would be scope creep.

MemoryRetriever.ts, the Loaded persona debug line, logs contentPreview: personaData.content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW). That content is the user-authored persona bio - a self-description someone wrote about themselves. 00-critical Logging (No PII) bans message content and usernames; a persona bio is neither exactly, but it is user-written personal text and sits closer to the banned list than to safe identifiers.

What: decide and apply. The cheap options are (a) drop the preview and keep resolvedPersonaId, which is enough to correlate against the DB when actually debugging; (b) keep it but gate it behind an explicit debug flag rather than the normal debug level; (c) log only a length or a hash. Option (a) matches how the rest of that function now logs after the 2067 sweep.

Worth noting the counter-argument before deciding: the preview is real diagnostic value when a persona renders wrong, and it is already length-capped by a named constant, so this is not an unbounded content dump.

Acceptance: a decision recorded, and either the log changed or a comment at the site saying why the preview is acceptable.
BATCHED 2026-08-21: this is one member of the message-content-in-logs class, which is now owned as a pass by tracker doc-80 (Idea: Message-content-in-logs sweep). Do it with the batch rather than alone — the class fragmented into four separate tasks precisely because each site was found incidentally.
<!-- SECTION:DESCRIPTION:END -->
