---
id: TASK-415
title: Fix doubled voice transcript in the persisted trigger row
status: To Do
assignee: []
created_date: '2026-08-03 18:27'
updated_date: '2026-08-03 19:23'
labels:
  - 'size:S'
dependencies: []
priority: high
ordinal: 415000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CONFIRMED (2026-08-03, code-read + prod-data probe). Current-turn prompt is clean - the context cutover accidentally fixed the old double (contract test RawEnvelopeContract.consumer.contract.test.ts:194-212 pins messageContent="" for voice). But the PERSISTED trigger row doubles: DependencyStep runs before ContextStep, so visionDescriptionWriter.persistTriggerDescriptions receives the PRE-overwrite job.data.message (= bot STT transcript) and stores botTranscript + newlines + <voice_transcripts>workerTranscript</voice_transcripts>. That row renders in every SUBSEQUENT turn chat_log - spoken words twice.
Prod probe (counts-only, no content read): 55 voice rows in retention (Jul 4 - Aug 3), 55/55 have a non-empty prefix before the block, avg prefix 866 chars vs avg inner transcript 837, 50/55 within 20 percent length match. Newest row is same-day - current behavior.
Fix shape (chosen): discriminate on jobContext.rawAssemblyInputs.rawMessageContent - empty (Discord voice message) means persist descriptions only, no prefix; non-empty typed text keeps the current prefix+descriptions shape so text+image turns are unchanged. Do NOT switch the prefix source to rawMessageContent for text turns (would diverge from the bot-written baseline row).
Existing 55 doubled rows: owner call - recommend leaving them; 30-day retention evicts by ~Sep 2.
Acceptance: writer test covers audio empty-raw (descriptions only) and typed-text+attachment (prefix kept); DependencyStep forwards the discriminator; contentRewriter docblock rewritten to the live contract in the same PR.
<!-- SECTION:DESCRIPTION:END -->
