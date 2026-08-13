---
id: TASK-592
title: >-
  splitLongWord injects literal "..." into force-split fragments, corrupting
  reassembled content
status: To Do
assignee: []
created_date: '2026-08-13 21:31'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 592000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: splitLongWord (packages/common-types/src/utils/discord.ts) appends a literal "..." to EVERY fragment when force-splitting a single word longer than maxLength. That reads as a truncation marker but nothing was truncated - the fragments are all emitted, so a reader reassembling them sees "..." injected at each boundary and the content reads as corrupted. Trigger: any single whitespace-free token over the cap (a long URL, a base64 blob, a path, a stderr blob with no spaces).

Scope: this is shared splitMessage behavior with five callers - four in bot-client (VoiceTranscriptionService, DiscordResponseSender x2, chunkedReply) plus the health webhook poster. It became newly reachable from the health path when splitMessageByLines started delegating over-cap lines to the same natural-boundary splitter, which is how it was noticed, but it is not new and not specific to that path.

Why not fixed in the PR that surfaced it: changing it alters output for four bot-client paths that PR never touched, so it needs its own consideration of what each caller wants at a force-split boundary.

Fix shape: decide what a force-split boundary should emit. Options: (a) emit nothing, letting the fragments concatenate cleanly - most correct for reassembly, loses the visual cue that a token was cut; (b) keep a marker but make it unambiguous and only between fragments, not after the last one; (c) make it a parameter so the health poster can opt out while chat responses keep the cue. Note the chunkSize math already reserves 10 chars for the marker, so removing it changes the effective chunk size too.

Acceptance: a no-whitespace over-cap token round-trips through splitMessage and splitMessageByLines without literal "..." appearing in content that was never truncated, with the chosen behavior pinned by a test and the reserved-headroom math updated to match.

Source: 2026-08-13 claude-review on the health-webhook chunking PR, finding 5.
<!-- SECTION:DESCRIPTION:END -->
