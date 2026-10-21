---
id: TASK-1187
title: >-
  STT eval: Gemini 3.8 Flash (and other dedicated STT engines) as a second
  provider beside Voxtral Mini
status: To Do
assignee: []
created_date: '2026-10-07 00:27'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (relayed by the Chats session, 2026-10-06) asks to evaluate Gemini 3.8 Flash alongside Mistral Voxtral Mini for voice transcription. An eval, not a switch: the standing voice rule is add engines alongside, never replace (memory project_voice_tts_research).

Data point (one recording, anecdotal, measured by Chats): a 39-minute 2013 phone call, mono 16 kHz MP3. voxtral-mini-latest (Mistral /v1/audio/transcriptions, diarize) vs google/gemini-3.8-flash via OpenRouter chat completions (input_audio, provider pinned to google-vertex/google-ai-studio, temperature 0, prompt asking for verbatim [H:MM:SS] Speaker: text). Flash cost $0.09 for the whole call. Word-aligned diff: Voxtral silently dropped a ~20 s passage of one speaker and misheard proper nouns and domain terms Flash got right (COS 340 -> Coast 340 / cost class; Dean Graves -> Dean Gray; in network -> in that work; busy time of year -> 50 times a year). Flash kept fillers and stutters as asked. Gemini 3.1 Pro preview was a bad fit (57.6k reasoning tokens, hit max_tokens, truncated at 8 min, $0.84); cap reasoning if ever used.

What the eval must measure (Chats notes, not owner rulings):
- Discord voice messages are short: per-clip latency and per-clip cost matter more than long-form accuracy.
- Verbatim fidelity: chat-completions Gemini has no native word timestamps or diarization guarantee and an LLM can paraphrase or clean up; the dedicated Voxtral endpoint cannot.
- Safety filters: Gemini may block or blank adult or edgy audio; Voxtral also blocks adult content at times (Lila 2026-10-21; seen on TTS, unprobed on STT), so measure refusal rates for both engines on the same clips; character chats include such content. Test before trusting.
- OpenRouter BYOK gives users a Gemini path without a Google key.
- Include a quick look at other dedicated STT engines in the same eval (gpt-4o-transcribe, ElevenLabs Scribe, Deepgram, AssemblyAI). No Chinese-hosted routes for user audio.

What: an eval harness over a fixed set of short Discord-style clips (incl. edgy content and proper nouns), reporting WER/omissions, latency, cost per clip and refusal/blank rate per engine; then a fallback/second-provider design if one wins.

Acceptance: eval results recorded in a tracker doc; owner decides whether to add an engine. TTS is out of scope (separate backlog items; OpenRouter has no voice-cloning TTS).

## Merged from TASK-784 (2026-10-12)

Gemini 3.5 Transcribe as an STT option (flagged by the owner for later evaluation 2026-08-27). Facts: 85+ languages with auto-detection, WER 4.0% streaming / 2.6% non-streaming (Artificial Analysis), diarization up to 3 speakers with timestamps, filler-word removal and auto-formatting, custom vocabulary, 70% faster time-to-final. Public preview models: gemini-3.5-transcribe (Interactions API, pre-recorded) and gemini-3.5-transcribe-live (Live API, realtime). Pricing and audio-length limits were not stated in the announcement. Source: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5-transcribe/. Compare against the current STT path (user STT override cascade falling back to the self-hosted voice-engine) on persona-chat voice-note accuracy, pricing once published, and whether the ai-worker already holds a Gemini key that covers it.
OWNER RULING (C13, 2026-09-04 digest pass): run the evaluation; priority medium. The deliverable is the written recommendation (pricing plus a quality spot-check), no code. Add alongside existing providers, never replace.

## Merged from TASK-1167 (2026-10-12)

Cactus "Whistle" STT, a 16.9 MB CPU speech-to-text model (owner intake 2026-10-04, from a @cactuscompute tweet): said to beat Whisper base while 9x smaller and 6x faster; languages EN, DE, FR, ES, IT, NL, PL. Figures are vendor claims, NOT verified; find the model card, license and benchmark source before relying on any of it. Include in this eval as a CPU candidate: check license, whether it runs in the Python voice-engine (services/voice-engine) on CPU, language coverage (7 languages is narrow versus the current ASR), accuracy on a few real persona-chat voice notes versus the current self-hosted path, and latency/RAM. Original priority was low. Voice-engine ASR follow-ups live in doc-94 (TASK-181).
<!-- SECTION:DESCRIPTION:END -->
