# TEN framework / turn-detection (relocated from the voice-engine theme at close-out)

**Relevance gate**: only if live voice-channel conversation ever lands (vs today's
attachment-based STT/TTS). Ingested 2026-07-05; parked here when the voice-engine
theme closed 2026-07-13.

**TEN_Turn_Detection** is a text-based semantic end-of-turn classifier
(Qwen2.5-7B fine-tune; finished/unfinished/wait; EN+ZH; ~90.6% accuracy;
Apache-2.0). It answers "when should the character speak" better than audio VAD,
because it classifies the _semantics_ of the transcript-so-far rather than
silence duration.

The parent **TEN framework** (10.8k stars, active) is a full realtime
voice-agent pipeline — worth studying as prior art if live voice ever becomes a
theme, not adopting now.
