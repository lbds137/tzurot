---
id: TASK-1452
title: Trigger-embed follow-ups from the PR 2764 final review
status: To Do
assignee: []
created_date: '2026-11-18T06:45:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1452000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review round 2 on PR 2764 (TASK-1440, head 247e34dbd, no blockers), filed at the review-round step-back. Finding 1 (link preview images now reach vision) was ruled KEEP by Lila 11-18 (AUQ "Keep images"); it is recorded in backlog/now.md deploy notes for the release notes.

1. The `/character chat` path (services/bot-client/src/services/character/characterTurn.ts): buildContext runs with the bot-posted echo as the anchor, so the current turn can now carry the echo's unfurled embeds, but sendAndPersistUserMessage persists the echo without them (history later lacks them). Long messages are echoed in chunks and only the last chunk is the anchor. Either wire triggerEmbedsXml into the echo persist or document why not; add a test for that path.
2. `force: true` costs one uncached REST GET per non-weigh-in trigger (MessageReferenceExtractor.refetchMessage). Consider skipping the forced refetch when it cannot gain an unfurl (no URL in the content and no forwarded snapshot); measure the route's rate-limit headroom first.
3. rawAssemblyInputsSchema.rawMessageEmbedsXml (packages/common-types/src/types/schemas/rawEnvelope.ts) has no size bound; add .max(10) on the array (Discord's embed cap) and a per-string max, matching any sibling precedent.
4. rawMessageEmbedsXml is pre-rendered XML in the "raw" envelope; note the exception in its JSDoc (history's messageMetadata.embedsXml is the precedent) or rename it.
5. Nit: retitle the forwarded-snapshot test in MessageContextBuilder.test.ts so it does not imply the embed comes from the refetch.
6. Nit: docs/reference/conformance/discord-surface.json lists the fetch option keys force and message as unclassified; classify them if the surface tool has a fitting category.

Acceptance: each item fixed or ruled out with its reason.
<!-- SECTION:DESCRIPTION:END -->
