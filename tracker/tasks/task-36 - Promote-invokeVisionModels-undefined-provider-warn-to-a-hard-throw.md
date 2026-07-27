---
id: TASK-36
title: "Promote invokeVisionModel's undefined-provider warn to a hard throw"
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
labels: []
dependencies: []
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Promote `invokeVisionModel`'s undefined-provider `warn` to a hard `throw`

**Why:** `VisionProcessor.ts:287` warns (+ falls back to the env-default provider) when `invokeVisionModel` gets `provider === undefined`; the code comment at line 285 already pre-committed: "will be promoted to a hard error once a few weeks of clean Railway logs confirm no upstream caller fires this." Post-C2b the contract is stricter — `describeImage` (the only caller) always passes `options.provider ?? detectVisionProvider(usedModel)`, never undefined — so the branch is effectively unreachable and a hit would be a real bug worth failing loud. **Fix shape**: after confirming clean prod logs, change the `warn`+fallback to `throw`. **Promote when**: a few weeks of clean Railway logs post-C2b deploy show zero "called without explicit provider" warn hits. Surfaced 2026-07-01 (Phase 4 plan; the code comment pre-committed to this).
<!-- SECTION:DESCRIPTION:END -->
