---
id: TASK-36
title: Promote invokeVisionModel's undefined-provider warn to a hard throw
status: Done
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-07-28 17:09'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Promote `invokeVisionModel`'s undefined-provider `warn` to a hard `throw`

**Why:** `VisionProcessor.ts:287` warns (+ falls back to the env-default provider) when `invokeVisionModel` gets `provider === undefined`; the code comment at line 285 already pre-committed: "will be promoted to a hard error once a few weeks of clean Railway logs confirm no upstream caller fires this." Post-C2b the contract is stricter — `describeImage` (the only caller) always passes `options.provider ?? detectVisionProvider(usedModel)`, never undefined — so the branch is effectively unreachable and a hit would be a real bug worth failing loud. **Fix shape**: after confirming clean prod logs, change the `warn`+fallback to `throw`. **Promote when**: a few weeks of clean Railway logs post-C2b deploy show zero "called without explicit provider" warn hits. Surfaced 2026-07-01 (Phase 4 plan; the code comment pre-committed to this).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in #1832 (871728a24): promoted at the TYPE level — InvokeVisionModelOptions.provider now required, warn branch deleted. Gate evidence: 25 prod deployments (3 weeks) swept clean for the warn; detectVisionProvider is total.
<!-- SECTION:NOTES:END -->
