---
id: TASK-170
title: "classifyReferenceAuthorRole mislabels own persona as 'bot' when clientUserId is undefined…"
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
labels:
  - 'area:bot-client'
  - 'area:conversation-history'
dependencies: []
ordinal: 170000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`classifyReferenceAuthorRole` mislabels own persona as `'bot'` when `clientUserId` is undefined (startup/reconnect)

**Why:** `classifyReferenceAuthorRole` (`services/bot-client/src/handlers/references/authorRole.ts`) gates the `'assistant'` check on `signals.clientUserId !== undefined`. `clientUserId` is `message.client.user?.id`, which is `undefined` before `ClientReady` fires and during gateway reconnects — so in that window a reference to our own persona's webhook reply falls through to `return 'bot'`. Because `authorRole` is persisted into stored conversation-history snapshots, the mislabel is durable: later turns read `role='bot'` and attribute the persona's own prior line to a third-party bot. The window is narrow (startup + reconnects) but the stored row is permanently wrong. `authorRole.test.ts` currently asserts this degraded path returns `'bot'` and calls it "does not misclassify" — that assertion is itself wrong for our own persona. **Fix shape**: when `applicationId` is present but `clientUserId` is undefined, omit `authorRole` (let the worker's name-match fallback run) rather than hard-coding `'bot'`; update the test expectation + comment. **Promote when**: next touching `authorRole.ts`, OR a startup/reconnect-window self-attribution spiral is observed. Surfaced 2026-06-24 by PR #1324 release review.
<!-- SECTION:DESCRIPTION:END -->
