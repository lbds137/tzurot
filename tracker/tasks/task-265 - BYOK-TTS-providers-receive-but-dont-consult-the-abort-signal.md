---
id: TASK-265
title: BYOK TTS providers receive but don't consult the abort signal
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:voice'
  - 'origin:review'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 265000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

BYOK TTS providers receive but don't consult the abort signal — `TtsContext.signal` (#1636) is checked by the self-hosted chunker and the dispatcher's fallback walk; `MistralTtsProvider`/`ElevenLabsTtsProvider` single-shot `synthesize()` calls receive the field and ignore it — correct today (no chunking, no shared semaphore, own per-request HTTP timeouts). **Fix shape**: add `signal?.throwIfAborted()` between requests if either provider grows a multi-request synthesis path. **Promote when**: a BYOK TTS provider grows chunked/long-running multi-request synthesis. Surfaced 2026-07-13 (#1636 round-2 review).

**Why:** The signal contract exists; new multi-request paths must opt in.
<!-- SECTION:DESCRIPTION:END -->
