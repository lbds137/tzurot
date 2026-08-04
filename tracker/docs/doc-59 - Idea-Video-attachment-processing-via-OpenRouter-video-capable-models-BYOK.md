---
id: doc-59
title: 'Idea: Video attachment processing via OpenRouter video-capable models (BYOK)'
type: other
created_date: '2026-08-04 02:39'
---

_Owner ask 2026-08-03, filed verbatim-intent during the unsupported-attachment-stub fix (the MP4-reads-as-failed-voice prod bug). Today videos get an honest `[File: name] not supported` stub; this idea makes them actually processable._

## What

For users with a paid OpenRouter API key (BYOK), route video attachments to a video-input-capable model for description/analysis, the way images go to vision models today.

Components:

1. **Capability catalog**: `OpenRouterModelCache` already parses `architecture.input_modalities` for audio (`supportsAudioInput`); add video-input capability detection and surface it through the same catalog/autocomplete features that expose vision support today. Related features (model pickers, capability badges) need the new axis.
2. **Length cap as the spend bound**: videos are processed only up to a maximum length (TBD default). The cap exists specifically to place an upper bound on how much a single request can spend on the user's API key.
3. **Config-cascade knob**: the length cap is tweakable at admin (global default) and user levels via the existing config cascade, with a sensible default. (Owner explicitly asked for the cascade item.)
4. **Pipeline**: `MultimodalProcessor` gains a video branch gated on (a) user has a paid OpenRouter key, (b) a video-capable model is resolvable, (c) attachment within the length cap. Everything failing those gates keeps today's `[File:]` stub behavior.

## Open questions (scoping)

- Default length cap value and unit (seconds vs projected token cost) — TBD, owner call.
- Whether guest/instance-funded requests are always excluded (spend-bound rationale suggests yes: BYOK-only).
- Which OpenRouter video models are worth allowlisting at launch vs trusting the modality flag.
- Interaction with the attachment allocation budget (paid-work-must-appear seam tests per 02-code-standards).

## Acceptance sketch

A BYOK user uploads a short MP4; the persona describes its visual content. An over-cap video, a non-BYOK user, or a no-video-model persona gets the honest `[File:]` stub. Usage rows attribute the spend to the user's key.
