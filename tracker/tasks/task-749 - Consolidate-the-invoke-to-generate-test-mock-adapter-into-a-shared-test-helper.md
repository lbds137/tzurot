---
id: TASK-749
title: Consolidate the invoke-to-generate test-mock adapter into a shared test helper
status: To Do
assignee: []
created_date: '2026-08-23 16:34'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 749000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2195 review (round 1, Low) - three test files hand-roll the same adapter wrapping an invoke-shaped mock into the generate seam invokeModelGuarded calls: LLMInvoker.test.ts (mockChatModel), MultimodalProcessor.test.ts and VisionProcessor.test.ts (generateFromInvokeMock, byte-identical incl. JSDoc). Test files are excluded from the CPD ratchet so the copies will not be caught mechanically, and any future test touching a mocked chat model will want the same shape.
Fix shape: move one adapter into packages/test-utils (typed against BaseChatModel/LLMResult), import at the three sites, delete the local copies. Also fold in the fourth near-copy in describeImageWithFallback.integration.test.ts (scriptModelInvocations wraps generate directly - decide whether it joins or stays).
Acceptance: one shared helper, zero local adapter copies, all four suites green.
<!-- SECTION:DESCRIPTION:END -->
