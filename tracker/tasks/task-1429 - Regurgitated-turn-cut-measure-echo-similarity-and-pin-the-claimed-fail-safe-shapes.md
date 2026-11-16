---
id: TASK-1429
title: >-
  Regurgitated-turn cut: measure echo similarity and pin the claimed fail-safe
  shapes
status: To Do
assignee: []
created_date: '2026-11-16T22:06:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1429000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2756 round-2 review (verdict: nothing blocks the merge). The cut in cutRegurgitatedLeadingTurns (services/ai-worker/src/utils/responseArtifacts.ts) is purely structural, so a reply where the model mis-stamps its own first paragraph with another speaker header and then restamps its own header would lose that first paragraph. Driver decision at merge: keep the structural cut (the observed prod failure, TASK-1422, is an echo; the mis-stamp shape is unobserved) and measure before adding any content guard. What: (1) echo-similarity telemetry on the existing warn line, comparing the cut body against the user message (normalized word overlap), so prod logs show whether cuts ever remove non-echo text; thread userMessage in from ResponsePostProcessor. (2) Pin or hedge the JSDoc claims: fence handling is approximate (marker prefix only; an inline triple-backtick span fails safe by opening a fence), and the Anna / Anna Belle residual (add a fixture showing the actual loop output, and reword fails safe to unchanged from before). (3) Fixtures: self header at EOF with no trailing newline (blank skip); the mis-stamped two-message shape as an accepted-residual fixture. (4) JSDoc note that cut lines count only in regurgitatedTurnCutChars, not headerLinesStripped; rewrap the over-long JSDoc line. Acceptance: telemetry field logged and tested; each JSDoc behaviour claim pinned by a named test or hedged. Promote the content guard only if telemetry shows non-echo cuts.
<!-- SECTION:DESCRIPTION:END -->
