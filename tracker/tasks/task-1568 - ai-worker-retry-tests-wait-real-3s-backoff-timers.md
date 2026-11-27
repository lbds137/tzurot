---
id: TASK-1568
title: ai-worker retry tests wait real 3s backoff timers
status: To Do
assignee: []
created_date: '2026-11-27T04:57:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1561000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: re-profile 2026-11-27 (PR 2823 round-1 measurement, vitest json reporter over both files): 8 unit tests at ~3003 ms each — 5 in services/ai-worker/src/services/multimodal/AudioProcessor.test.ts (transcribeAudio retry/fallback paths) and 3 in services/ai-worker/src/services/ReferencedMessageFormatter.test.ts (failure-path tests whose rejected mocks reach the REAL fallback machinery; the formatter itself has no retry code — the original "retry paths in ReferencedMessageFormatter" premise was wrong, no retry/backoff code exists in that file). The 3s cost is real backoff timers: `withRetry` defaults (`packages/common-types/src/constants/timing.ts:203` RETRY_CONFIG.INITIAL_DELAY_MS 1000 with backoffMultiplier 2 → 1s + 2s waits, consumed at `services/ai-worker/src/utils/retry.ts:248`) and the voice-engine path (`services/ai-worker/src/services/voice/VoiceEngineClient.ts:247` INITIAL_DELAY_MS 3_000). What: move the 8 tests onto fake timers per 02-code-standards § Fake Timers — `vi.useFakeTimers()` + `advanceTimersByTimeAsync`, with the rejection assertion attached BEFORE the timers advance; keep the retry-count assertions unchanged; no production change (no test-only injectable delay parameter — that adds a production option used only by tests, the heavier option). Acceptance: those 8 tests drop under 200 ms each with the retry-count assertions unchanged; no prod call site changes its delay.
<!-- SECTION:DESCRIPTION:END -->
