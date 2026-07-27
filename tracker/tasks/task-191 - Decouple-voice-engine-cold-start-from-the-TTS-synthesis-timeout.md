---
id: TASK-191
title: 'Decouple voice-engine cold-start from the TTS synthesis timeout'
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
labels:
  - 'area:voice'
dependencies: []
ordinal: 191000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Decouple voice-engine cold-start from the TTS synthesis timeout

**Why:** `TTSStep.runWithTimeout` wraps the WHOLE self-hosted dispatch — including the serverless cold-start warmup (up to the 120s `voiceEngineWarmup` budget) — in one `TTS_MAX_TOTAL_MS` race, so a cold-start eats into the synthesis budget. The flat bump to 300s (this fix) covers a typical cold-start (~52s) + a long synthesis (~190s), but a pathological full-120s cold-start + very-long synthesis can still exceed it. **Proper fix**: start the synthesis timeout at warmup-completion (the warmup already has its own 120s budget) so the two are budgeted independently — a genuine synthesis hang still fails fast from synthesis-start, and a cold-start never starves the synthesis. Needs the dispatcher/`SelfHostedTtsProvider` to signal "warmup done, synthesizing" so `runWithTimeout` can (re)start the synthesis clock. Related robustness win: deliver the late-completed audio as a follow-up instead of discarding it (`TTSStep` currently throws away audio that finishes after the timeout). **Why the cold path is hit routinely (not rarely)**: moderation-blocked (edgy) content fails the Mistral BYOK guardrail (403 `guardrail_violation`) and ALWAYS falls back to the serverless self-hosted engine, which cold-starts — so for such content the ~52s warmup is the norm, which is exactly what stacks onto a long synthesis to blow the budget. **Promote when**: the 300s budget is exceeded again in prod (full cold-start + long text), or opportunistically when next touching the TTS pipeline. Surfaced 2026-06-29 (prod voice-output-dropped diagnosis; observed trace: ~52s cold-start + 190s self-hosted synthesis > the 240s pre-fix budget, late audio discarded).
<!-- SECTION:DESCRIPTION:END -->
