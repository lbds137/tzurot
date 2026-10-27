---
id: TASK-1307
title: >-
  Facts forget: a failed list refresh after a successful forget reads as if the
  forget failed
status: Done
assignee: []
created_date: '2026-10-27T06:39:00Z'
updated_date: '2026-10-27T14:52:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1291000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2672 review round 1. handleForgetConfirm (factsDetail.ts) sends no success message when a forget succeeds; the list refresh that follows is the only sign it happened. With PR 2672 a failed refresh now says the page failed to load or the session expired, while the message still shows the confirm view. Both notices read as if the forget itself failed, and tapping Confirm again gives a not-found error. Code-reading finding, not runtime-confirmed.

What: for the post-forget refresh only, use copy that says the forget worked, for both refusal reasons (gone session and failed fetch). The confirm-forget branch in interactionHandlers.ts would pass a flag into refreshFactsList (or the shared refusal helper), and the two copies would differ from the back and batch-cancel ones.

Owner question: when a fact is forgotten successfully but the list cannot be refreshed afterwards, what should the notice say?
Recommendation: one line for both reasons, for example: Fact forgotten. The list could not be refreshed, so run /memory facts to see it. The forget is the thing the user did, so the notice should confirm it before explaining the refresh problem.

Acceptance: per the chosen wording; the confirm-forget path has a test for each refusal reason.

OWNER RULING 2026-10-27 (Lila, via AskUserQuestion): confirm the forget first, one line for both refusal reasons: "Fact forgotten. The list could not be refreshed, so run /memory facts to see it." Built in PR 2672 (same PR as the refresh feedback), not as a separate change. No separate owner question remains.

SHIPPED 2026-10-27 (PR 2672, Done). The notice goes through the catalog warning spec (CATALOG.info.warning), so it carries the catalog warning glyph ahead of the ruled sentence; the repo raw-content lint rule would not take a raw literal at that position. The stale buttons left on screen after a failed post-forget refresh are a member of TASK-1306.
<!-- SECTION:DESCRIPTION:END -->
