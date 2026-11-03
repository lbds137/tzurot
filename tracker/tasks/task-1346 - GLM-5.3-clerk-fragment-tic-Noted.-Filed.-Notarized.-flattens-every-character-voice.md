---
id: TASK-1346
title: >-
  GLM 5.3 clerk-fragment tic (Noted. Filed. Notarized.) flattens every character
  voice
status: To Do
assignee: []
created_date: '2026-11-03T19:55:00Z'
updated_date: '2026-11-03T20:04:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:dependent
dependencies: []
priority: high
ordinal: 1329000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GLM 5.3 replies fill with one-word bureaucratic fragments (Noted. Data. Filed. Notarized.) across every character, so all characters converge on one clerk voice; Lila 11-03: it has killed her enthusiasm to chat with her characters. Community report r/SillyTavernAI (GLM 5.3 dialogue, 11-03) says prompt instructions only tone it down, never remove it.

Grounding: presets already carry frequency/presence/repetition penalties and logit_bias (packages/common-types/src/schemas/llmAdvancedParams.ts:43-49,212), but penalties act within one reply and the tic is cross-turn; logit_bias support on the z.ai plan endpoint is unprobed. services/ai-worker/src/services/ResponsePostProcessor.ts already strips model-learned artifacts in ordered steps (echo strip, wrapper unwrap), the natural home for an output-side strip.

Candidate layers (hypothesis, unmeasured): (1) measure tic rate per model over recent assistant turns; (2) scrub the fragments from prior assistant turns when rendering history, so one occurrence does not self-reinforce (inference: in-context imitation drives the spread); (3) strip standalone clerk fragments in ResponsePostProcessor, logged and counted; (4) a prompt line as a weak extra.

Owner question: may Tzurot deterministically remove standalone clerk fragments from replies and from rendered history, or prompt-only?
Recommendation: strip in both places with a narrow standalone-fragment pattern plus telemetry - prompt-only is reported not to work.

Acceptance: measured before/after tic rate on GLM 5.3 replies; a character legitimately saying a word mid-sentence is untouched; regression tests on the pattern.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Hold (Lila 11-03): no design pick until the full r/SillyTavernAI thread (38 comments) is read - it has more fixes than the preview. Blocker: Deck building a reddit-post exporter Lila runs (requested 11-03). Owner question above stays open until then.

Ruling (Lila 11-03): moving characters off GLM is ruled out - it means paying another provider (OpenRouter per-token) on top of existing plans. The fix must work on the z.ai plan models; her characters run GLM 5.3 Flash, which shows the same tic.

Sequence (Lila 11-03): thread read -> read-only sweep of conversation_history assistant turns and memories (frequency and shapes of the tic, per model and character; pattern list informed by the thread) -> only then any logic change. Sweep runs against prod as a script Lila runs (classifier blocks prod reads), counts plus shape samples to docs/local only; personal chat content stays on Anthropic lanes.

Correction (Lila 11-03): the sweep reads DEV, not prod - db-sync copies conversation_history and memories nightly (services/api-gateway/src/services/sync/config/syncTables.ts:262,274). No owner-run script needed; the session runs it read-only.

Dev sweep 11-03 (findings: docs/local/glm-tic/findings.md, gitignored): 28% of last-month replies show at least one shape (narrow-pattern floor). In-sentence bureaucratic metaphor 21%, negative definition 6%, standalone fragment only 1.9%, so a deterministic strip reaches a small slice. Metaphor share in memories: 2% Jul 2026 to 25% Sep, lining up with GLM 5.3 arriving in Aug (correlation). Next candidate: dev A/B replay (baseline vs positive voice block vs scrubbed history) after the z.ai reset.
<!-- SECTION:NOTES:END -->
