---
id: TASK-99
title: Mistral TTS guardrail violations
status: To Do
assignee: []
created_date: '2026-05-13 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:voice'
  - 'size:M'
dependencies: []
priority: low
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Mistral TTS guardrail violations — bot-owner-visible notice

**Why:** Production logs show Mistral returning `403 guardrail_violation code 1920 "Request blocked by guardrail policy"` on innocuous content (concrete example: Monty Python reference about African vs European swallows + "capital of Assyria" joke). The dispatcher correctly falls through to self-hosted, but the user has no idea their content is being content-policed by Mistral. **Fix shape (visibility)**: in `MistralTtsClient.ts`, detect the 403 + `code === 1920` shape, throw a new `MistralGuardrailError` (sibling to `MistralReferenceAudioTooLongError`) with a `userNotice` field; thread through `TtsDispatcher.buildAttemptNotice`. ~30-50 LOC + test. **Promote when**: opportunistic during next MistralTtsClient touch, OR alongside the BYOK re-eval work. Surfaced 2026-05-13.
<!-- SECTION:DESCRIPTION:END -->
