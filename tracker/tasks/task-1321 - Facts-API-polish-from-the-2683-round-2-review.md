---
id: TASK-1321
title: Facts-API polish from the 2683 round-2 review
status: To Do
assignee: []
created_date: '2026-10-29T01:29:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1304000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four low/nit items from the PR 2683 round-2 review, filed at merge per the train-holding rule. (1) Joinable warns: one fetch failure logs two warns (fetchFacts class warn with personalityId; caller warns with userId/messageId) with no shared field; declined in-PR because threading userId is a signature change across call sites - revisit at the next factsApi.ts touch or if a prod incident needs the join. (2) The CONTRACT comment in factsApi.ts carries two back-to-back parentheticals; move the fetchFacts exception into its own sentence after the throw classification. (3) The caller-level swallow test in factsBatch.test.ts could pin expect(stub.listFacts).toHaveBeenCalledTimes(1) (the logger-mock half was declined: the helper-level test already pins the warn). (4) Rename the 404 test in factsApi.test.ts to record why 404 is logged here (null is caller-visible), unlike warnNonMiss. Acceptance: each item lands or gets a recorded reason.
<!-- SECTION:DESCRIPTION:END -->
