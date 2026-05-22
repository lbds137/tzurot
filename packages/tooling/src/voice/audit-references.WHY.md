# Why `voice-refs:audit` exists

## What it does

Audits every Personality voice reference upload in the database against the Mistral TTS 30-second reference-audio cap. Approach:

1. Reads `voiceReferenceData` bytes directly from Postgres (avoiding an api-gateway round-trip)
2. Writes each blob to a temp file
3. ffprobes the file for duration
4. Reports anything over 30.0s as a hard violation, anything within `NEAR_CAP_MARGIN_S` (0.5s) of the cap as a near-miss

Supports `--env local|dev|prod` for environment scoping. Outputs colored table by default; `--json` for tooling.

## Why it was built

The Mistral Voxtral TTS API hard-rejects reference audio over 30 seconds with: `Reference audio duration X exceeds the maximum allowed duration of 30.0s`. The TtsDispatcher silently falls through to self-hosted voice-engine when Mistral rejects the request — so from the operator's view, voice cloning still "works," it just stops using Mistral. The downgrade is invisible unless someone digs into ai-worker logs and notices the dispatcher's fallback path is firing.

The audit exists because this happens regularly during voice-reference uploads: a personality owner uploads a 45-second audio clip, Mistral rejects it, the bot falls back to voice-engine, and the user gets a noticeably worse voice without anyone knowing why. The 30s cap is a Mistral-side constraint, not configurable.

The 0.5s near-cap margin catches references close to the limit that could trip on encoding rounding — re-encoding a 29.8s mp3 sometimes produces a 30.1s output, depending on the encoder.

## Threshold rationale

`MISTRAL_REF_CAP_S = 30.0` is the actual API constraint, not adjustable from this side. The `NEAR_CAP_MARGIN_S = 0.5` margin is the configurable knob — increase it to flag more refs for proactive trimming, decrease it if too many near-misses are false alarms.

The audit doesn't auto-trim references (that's still a manual operator action — see the backlog item on voice-refs trim) but does identify exactly which references need attention.

## Decay check

When this tool's reminder fires:

- Did Mistral raise the cap or remove the constraint? Delete the tool.
- Did the project drop Mistral TTS entirely (e.g., everyone moved to self-hosted)? Delete the tool — the cap doesn't apply.
- Did the voice-engine system stop accepting voice references at all? Delete the tool.
- Is the audit producing repeated findings without anyone trimming them? The tool's signal is being ignored — either escalate to auto-trim (per the backlog item) or accept that some refs will silently fall back.

This tool is one of the few that touches Railway production data (with `--env prod`); the cap exists in prod, so the audit needs to too. Don't restrict it to local-only without a strong reason.
