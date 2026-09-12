---
id: TASK-942
title: >-
  reportDeliveries tests in retentionGatewayCalls.test.ts are order-coupled
  through a mockResolvedValueOnce queue
status: To Do
assignee: []
created_date: '2026-09-12 14:31'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 940000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the seven reportDeliveries cases (moved verbatim from gatewayServiceCalls.test.ts in the TASK-936 split) share one mockServiceClient whose releaseBroadcastDeliveries mock is primed with mockResolvedValueOnce; the global afterEach clears calls but a queue left un-drained by one case leaks into the next. Observed under the TASK-936 canary: with maxAttempts forced to 1 the truncated queue reddened a later case, not only the one under mutation. Inert with correct code, so no runtime effect; it makes the canary tail misattribute and a future edit that changes attempt counts will see phantom failures.
Fix shape: prime each case with mockResolvedValue plus explicit per-call sequencing, or reset the mock with mockReset in a beforeEach scoped to the reportDeliveries describe block, then re-run the maxAttempts=1 canary and confirm exactly the cases that assert the retry count redden. File services/bot-client/src/utils/retentionGatewayCalls.test.ts.
Acceptance: the maxAttempts=1 mutation reddens only the retry-asserting cases; the suite stays green unmutated.
<!-- SECTION:DESCRIPTION:END -->
