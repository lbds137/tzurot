---
id: TASK-99
title: Mistral TTS guardrail violations
status: Done
assignee: []
created_date: '2026-05-13 00:00'
updated_date: '2026-09-05 08:28'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Mistral TTS guardrail violations — bot-owner-visible notice

**Why:** Production logs show Mistral returning `403 guardrail_violation code 1920 "Request blocked by guardrail policy"` on innocuous content (concrete example: Monty Python reference about African vs European swallows + "capital of Assyria" joke). The dispatcher correctly falls through to self-hosted, but the user has no idea their content is being content-policed by Mistral. **Fix shape (visibility)**: in `MistralTtsClient.ts`, detect the 403 + `code === 1920` shape, throw a new `MistralGuardrailError` (sibling to `MistralReferenceAudioTooLongError`) with a `userNotice` field; thread through `TtsDispatcher.buildAttemptNotice`. ~30-50 LOC + test. **Promote when**: opportunistic during next MistralTtsClient touch, OR alongside the BYOK re-eval work. Surfaced 2026-05-13.

**DECIDED 2026-08-14 (owner, TASK-599 digest): build at the next MistralTtsClient touch - typed MistralGuardrailError with userNotice threaded through the dispatcher attempt-notice.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner-decided (2026-08-14) to build at the next `MistralTtsClient.ts` touch. No `MistralGuardrailError` class exists yet, and `git log` shows zero commits to that file since the decision date — the trigger hasn't fired. Evidence: `git grep -n "MistralGuardrailError\|code === 1920"` → no hits; `git log --oneline --since=2026-08-14 -- '**/MistralTtsClient.ts'` → empty.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
