---
id: TASK-1304
title: >-
  Batch pick post-ack tests: route the deny wiring test through the real deny
  select router and tidy names and copy
status: Done
assignee: []
created_date: '2026-10-27T05:06:00Z'
updated_date: '2026-10-27T05:46:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1289000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2669 review round 3 (test-strength items declined there because each needed another force-push round).

What: (1) route the deny wiring test in deny/browseBatch.test.ts through the deny command real handleSelectMenu (deny/index.ts, isDenyBatchSelect dispatch) instead of registering handleDenyBatchPick directly, so deny own select router is covered; (2) add a TTS-config case for handleOverrideBatchPick (voice/tts/browse.ts uses ttsOverrideConfig; the new test only runs the preset config); (3) rename the five unit tests titled propagates an editReply failure to the central handler to propagates an editReply failure after the ack (does not swallow it), since they only prove the handler rejects; (4) derive the expected error copy in the two central tests from CATALOG.error.interactionFailed() instead of the hardcoded string. Declined on merit in the PR: a shared registerTestCommand helper for the private prefixToCommand access, and a DRY helper for the five propagation tests.

Acceptance: the four items land with mutation canaries red where they add coverage; no source change.

SHIPPED, AS BUILT (PR 2670, tests only, Done 2026-10-27). Item (1) was re-targeted at grounding: deny/index.test.ts module-mocks ./browseBatch.js, so the real pick handler cannot run through the real router there; instead that file now pins that deny own handleSelectMenu (two routes) AND handleButton (three routes) propagate a routed-handler rejection and call the routed handler. Item (2) was ruled out on merit: overrideBrowseBatch.test.ts already runs makeConfig(TTS_PREFIX) through the pick and confirm paths and the real ttsOverrideConfig is private to voice/tts/browse.ts, so a TTS row would execute the same function with different strings. Items (3) and (4) shipped as filed (five renames; the two central assertions use renderSpec(CATALOG.error.interactionFailed()), coupling a copy edit to reply.test.ts only). Remaining review-round items are filed as TASK-1305.
<!-- SECTION:DESCRIPTION:END -->
