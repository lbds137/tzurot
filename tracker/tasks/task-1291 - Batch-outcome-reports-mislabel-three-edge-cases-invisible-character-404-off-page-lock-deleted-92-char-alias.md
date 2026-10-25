---
id: TASK-1291
title: >-
  Batch outcome reports mislabel three edge cases: invisible-character 404,
  off-page lock, deleted 92-char alias
status: To Do
assignee: []
created_date: '2026-10-25 18:44'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1277000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the Anthropic post-merge re-review of PRs 2652-2654 (GLM-driven merges), 2026-10-25. No wrong mutation in any case; the user-facing report is wrong after a destructive batch run. Items: (1) VERIFIED alias: services/bot-client/src/commands/character/aliasBatchConfirm.ts runSingleAliasRemoval maps every 404 to already-gone, but the gateway (services/api-gateway/src/routes/user/personality/aliases.ts requireVisiblePersonality) 404s for an INVISIBLE character too, so a my-aliases removal on a now-private character reports already gone while the alias row survives; the single-remove flow says not found. Fix: neutral not-found copy for a gateway 404, keep already-gone only where the pre-fetch proved absence. (2) VERIFIED facts: services/bot-client/src/commands/memory/factsBatch.ts resolveBatchLabels reads isLocked only from the current page, so a selected fact that drifted off-page and is already locked runs setFactLock(true) again and reports succeeded; memoriesBatchConfirm.ts does a per-id fetch for exactly this. Fix: per-id state resolution for ids missing from the page, mirroring memories. (3) alias: an exactly-92-char alias deleted before confirm reports failed (could not resolve) rather than already gone; fail-closed is safe and a test pins it; adjudicate the copy alongside TASK-1289 item 3. (4) cosmetic: the alias confirm listing shows the select-menu numbering (bullet 3. @foo) via readSelectOptionLabels, result lines do not; strip it together with TASK-1289 item 2. (5) PLAUSIBLE memory: detailApi.ts deleteMemory returns data.success for non-404, so a 200 success:false would report already gone instead of failed; check the gateway delete route shape first. (6) Test gap: memoriesBatchConfirm.test.ts mocks browse/search/detail/detailApi/browseSession wholesale; add one seam test running router, session lookup, confirm handler and refreshed view with only the gateway client mocked (02-code-standards principle 7). Acceptance: each of 1, 2 pinned by a test that fails on develop today; 3-5 decided with the reason in the PR.

PR 2657 additions (2026-10-25): (7) alias: runSingleAliasRemoval in services/bot-client/src/commands/character/aliasBatchConfirm.ts does not catch a REJECTED removePersonalityAlias call, so toBatchOutcomeLine puts the raw transport message (e.g. fetch failed) on the user's result line; mirror the override flow (catch, log ids only, rethrow the module's failure copy). (8) facts and memories: factsBatch.ts and memoriesBatchConfirm.ts still inline 'already gone'; switch them to the shared ALREADY_GONE_NOTE export in utils/browse/multiSelectBatch.ts. (9) alias: the confirm-prep catch in handleAliasBatchConfirm calls followUpSpec with no .catch, so a rejecting followUp escapes to the router; add the .catch + warn and a both-reject test, mirroring handleOverrideBatchConfirm. (10) copy: the override batch confirm warning says "Cleared characters will fall back to your default ..." but a slot-only pick clears one slot; reword to "Cleared overrides will fall back ..." (utils/overrideBrowseBatch.ts, handleOverrideBatchPick). Round 5: (11) correctness, both override paths: parseOverrideSelectValue → narrowModelSlot returns undefined for an unknown slot segment, so a deploy-skewed confirm (personalityId::<renamed slot>) issues a DEFAULT-slot (text) delete instead of the pick; fail closed (batch: one failed line; one-pick clear:: customId: error reply) and pin it with a test. (12) typing: DeleteOverrideWasSet in overrideBrowseBatch.ts comes from the model-override schema only; tie it to the TTS DELETE schema too, which means exporting its type from common-types. (13) robustness: move ackUpdate inside the prep guard in handleOverrideBatchConfirm. (14) UX: resolveConfirmDisplayLabels is all-or-nothing on bullet count, so a clamped listing falls back to id labels for every row; keep the matched prefix. (15) test: aliasBatchConfirm.test.ts covers strip-rejects but not the clientsFor-throws arm.
<!-- SECTION:DESCRIPTION:END -->
