---
id: TASK-1165
title: >-
  Reference crawl does not follow links inside a linked message: probe the real
  miss, then fix
status: To Do
assignee: []
created_date: '2026-10-04 16:46'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-10-04 (own words, apostrophe dropped): "a message link linking to a message containing more message links apparently doesnt dig into those additional message links. I would like it to". READ FIRST (code-reading, not runtime-confirmed): the crawler already RECURSES. services/bot-client/src/handlers/references/ReferenceCrawler.ts is a BFS: for every fetched reference it queues the message (depth+1) and extracts reply AND link references from it, cycle-safe through extractedMessageIds, bounded by maxReferences (no separate depth cap; the maxDepth field is reported only). So the observed miss has some narrower cause. Candidates to check, in order: (1) dedup stubs - a referenced message already present in conversation history becomes a lightweight stub and the code comment says no BFS traversal from stubs (ReferenceCrawler.ts, isDeduplicated branch), so links inside an already-known message are never followed; (2) the maxReferences cap (find the value passed in services/bot-client/src/services/contextBuilder/ReferenceExtractor.ts:73 and MessageReferenceExtractor); the loop stops at the cap; (3) links in a non-trigger message seen only through extended context are never crawled at all (only the trigger message is a crawl root - same family as TASK-706); (4) links living in embeds or in a forward snapshot rather than message content (LinkReferenceStrategy reads extractForwardedContent, not embeds); (5) the second-hop channel is not viewable by the bot or the invoker (LinkExtractor.fetchMessageFromLink access gate), a deliberate fail-closed.
What: reproduce with a three-message chain (A links B, B links C) on dev and read the Extracted referenced messages log (count, maxDepth) to see which candidate fires; then fix that one. If it is (1) or (2), decide a bounded policy (depth cap constant in common-types, stubs traversed or not) and say so in the PR; keep cycle safety.
Acceptance: a link to a message that itself contains message links yields all hops up to the stated bound, cycles terminate, the bound is a named constant, each pinned by a ReferenceCrawler test with a chain fixture.
<!-- SECTION:DESCRIPTION:END -->
