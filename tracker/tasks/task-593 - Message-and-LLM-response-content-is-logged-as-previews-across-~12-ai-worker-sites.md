---
id: TASK-593
title: >-
  Message and LLM-response content is logged as previews across ~12 ai-worker
  sites
status: To Do
assignee: []
created_date: '2026-08-13 21:45'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 593000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a sweep of user-authored persona identity text in logs (TASK-533/535) enumerated a second, larger subclass it deliberately did not touch: raw message text, LLM response bodies, and vision descriptions logged as truncated previews. 00-critical Logging (No PII) bans message content outright, so these are in-scope by the letter of the rule - but unlike the persona-name sites, several carry real diagnostic weight and gutting them is a design tradeoff rather than a mechanical scrub.

The sites, as enumerated during the 533/535 sweep (re-verify before acting; line numbers drift):
- MemoryRetriever.ts:222 - contentPreview of retrieved memory text
- ConversationalRAGService.ts:238-241 - rawContentPreview and cleanedContentPreview of the LLM response. These are the remaining consumers of TEXT_LIMITS.LOG_PERSONA_PREVIEW, which 533 left in place only because of them.
- ReferencedMessageFormatter.ts:346 - preview of referenced-message text
- crossTurnDetection.ts:153, 273, 290, 317, 489 - newResponseSnippet / matchedSnippet / closestMatchSnippet, five sites
- duplicateDetectionDiagnostics.ts:51 - recentMessagesPreview
- VisionProcessor.ts:318 - the vision description of a user-supplied image
- visionDescriptionValidity.ts:105 - preview of a cached vision description
- LLMInvoker.ts:537 - responseContent, the full response
- xmlTextExtractor.ts:59 - xmlPreview
- factRetrievalHelper.ts:94 - queryPreview
- PromptLogger.ts:45 and :62 - activePersonaName and the ENTIRE assembled system prompt. Both sit behind a NODE_ENV development gate so they never run in prod; 533 left them for that reason. Decide whether the dev-only gate is sufficient protection or whether the gate itself is the fragile part.

api-gateway has zero in-class sites - checked during the same sweep.

What: this is not one decision. The duplicate-detection snippets (crossTurnDetection, duplicateDetectionDiagnostics) exist to diagnose a class of bug that is hard to reproduce, so removing them has a real cost; the LLM-response and vision-description dumps are closer to unambiguous content leaks. Triage per site into: remove, replace with a hash or a length, or gate behind an explicit opt-in debug flag rather than the normal debug level. Option three preserves the diagnostic path without leaking by default and is likely the right answer for the duplicate-detection cluster.

Acceptance: every site above has a recorded decision and either the log changed or a comment at the site saying why the content is acceptable there. If TEXT_LIMITS.LOG_PERSONA_PREVIEW loses its last consumer, remove the constant too.

Source: enumerated during the TASK-533/535 class sweep; filed as the batch rather than as individual rows because the triage is one pass.
BATCHED 2026-08-21: this is one member of the message-content-in-logs class, which is now owned as a pass by tracker doc-80 (Idea: Message-content-in-logs sweep). Do it with the batch rather than alone — the class fragmented into four separate tasks precisely because each site was found incidentally.
<!-- SECTION:DESCRIPTION:END -->
