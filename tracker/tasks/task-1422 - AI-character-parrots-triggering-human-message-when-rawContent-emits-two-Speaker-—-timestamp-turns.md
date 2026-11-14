---
id: TASK-1422
title: >-
  AI character parrots triggering human message when rawContent emits two
  [Speaker — timestamp] turns
status: To Do
assignee: []
created_date: '2026-11-14T17:04:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1422000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: In production on 2026-11-14 (`requestId: ea499654-3887-4cbc-a9a0-0ec09d8b667a`, `2026-11-14T14:02:35.894Z`, character `Lila Elyona` `5e487299-468e-52cb-8bb4-caa009077246`, `triggerMessageId: 1571163429958582283`, `channelId: 503951097245990942`, model `z-ai/glm-5.3-flash` via `Relace`; related model-scaffolding watch: TASK-782), `Lila Elyona` posted a reply that began with all 3 paragraphs of the triggering human user's message (`audient`) as bare unattributed text spoken by the character, followed mid-message by a literal `[Lila Elyona — 2026-11-14 (Sat) 14:07]` header line, followed by Lila Elyona's actual 4-paragraph reply.

Root cause (verified against debug JSON + `ResponsePostProcessor.ts` / `responseArtifacts.ts`):
1. `llmResponse.rawContent` opened with a two-speaker real-messages transcript block: `[a̻̐u̙̓d̊͆ͅi͓͛e̞͋n͂͐͊t♄♥☄🌲 — 2026-11-14 (Sat) 14:02]\n` + all 3 paragraphs of `inputProcessing.rawUserMessage` (with a 1-word transcription drift: `"at the end of day"` vs `"at the end of the day"`, plus combining-mark order shift on `audient`), followed by `\n\n[Lila Elyona — 2026-11-14 (Sat) 14:07]\n` + the character's actual reply.
2. In Step 5 (`services/ai-worker/src/services/ResponsePostProcessor.ts:263-269`), `stripRealMessageEchoArtifacts` (`services/ai-worker/src/utils/responseArtifacts.ts:366-430`) iteratively applies `leadingHeaderLineMatcher()` (`services/ai-worker/src/services/context/RealMessagesBuilder.ts:390-404`) at index 0 only. That stripped ONLY the 54-char leading `[audient... — 2026-11-14 (Sat) 14:02]\n` header line (`artifact_strip`: `stripped 54 chars`), turning a speaker-attributed echo of another participant's turn into bare text attributed to `Lila Elyona`, and never reached the mid-output `[Lila Elyona — 2026-11-14 (Sat) 14:07]\n` self-header.
3. In Step 5b (`ResponsePostProcessor.ts:276-280`), `stripUserMessageEcho` (`responseArtifacts.ts:498-522,562-622`) requires an exact character-for-character normalized prefix match in `findEchoCutIndex`, so the single omitted `"the"` (`"at the end of day"` vs `"at the end of the day"`) returned `mismatch` (`-1`) and left all 3 parroted human paragraphs intact.

What:
1. In `stripRealMessageEchoArtifacts` (`services/ai-worker/src/utils/responseArtifacts.ts:366-430`, using header matchers from `services/ai-worker/src/services/context/RealMessagesBuilder.ts:210-430`), detect the multi-turn transcript-regurgitation shape where `content` starts with one or more non-self `[<OtherSpeaker> — <timestamp>]\n<body>` blocks followed by the active character's own `[<PersonalityName> — <timestamp>]\n` turn header (subject to `MAX_STRIP_RATIO` / non-empty remainder safety so a pure regurgitation without a character reply does not silently blank). Strip the echoed non-self turn(s) AND the character's own turn header line so output begins cleanly at the character's reply.
2. Also decide whether `stripUserMessageEcho` (`responseArtifacts.ts:498-622`) should tolerate minor token/edit-distance drift on long (`>= MIN_ECHO_LENGTH`) multi-sentence prefixes when no `[PersonalityName — timestamp]` boundary is present, or keep exact matching once (1) handles the real-messages two-header case.

Acceptance:
- Unit + seam regression tests in `services/ai-worker/src/utils/responseArtifacts.test.ts` and `services/ai-worker/src/services/responseStripSeam.test.ts` covering the exact `ea499654-3887-4cbc-a9a0-0ec09d8b667a` two-speaker shape (with 1-word drift in the echoed user body + mid-reply `[Lila Elyona — 2026-11-14 (Sat) 14:07]` header) produce `cleanedContent` starting at the character's reply with zero echoed human paragraphs and zero surviving `[Lila Elyona — ...]` header lines.
- Existing keep-cases in `RealMessagesBuilder.test.ts` and `responseStripSeam.test.ts` (legitimate in-prose quoting of another speaker's header without a subsequent self-turn boundary, code-fenced demonstrations, and flag-off `realMessagesEnabled: false` byte-identity) remain green.
<!-- SECTION:DESCRIPTION:END -->
