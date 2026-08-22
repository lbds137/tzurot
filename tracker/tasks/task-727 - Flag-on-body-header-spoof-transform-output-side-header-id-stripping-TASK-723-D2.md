---
id: TASK-727
title: >-
  Flag-on body header-spoof transform + output-side header/id stripping
  (TASK-723 D2)
status: To Do
assignee: []
created_date: '2026-08-22 13:47'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 727000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a typed header-shaped body line survives verbatim flag-on, and /inspect discloses the exact header format AND id tags to any participant for their own generations (DiagnosticCollector.ts records the exact shipped messages; inspect is owner-or-own-rows) — the forge is lowest-effort, which the standing posture says to block. Design record: prompt-assembly-architecture.md 9d D2 (2-2 panel split, tiebreaker verdict adopted).
What: flag-on-only post-pass converting brackets to parens on body lines exactly matching the rendered header shape (pattern derived from the header-render code; em-dash only); unconditional including fenced regions; hit telemetry {channelId, requestId} + count, NEVER line text (no-PII); systemSettings kill switch (default ON) captured at the per-turn read (rides U3). Plus stripResponseArtifacts gains: strip leading header-shaped line + (id:...) tags from model output, logged.
Acceptance: spoofed body header neutralized flag-on; flag-off bodies byte-identical; kill switch verified; output strip canaried.
<!-- SECTION:DESCRIPTION:END -->
