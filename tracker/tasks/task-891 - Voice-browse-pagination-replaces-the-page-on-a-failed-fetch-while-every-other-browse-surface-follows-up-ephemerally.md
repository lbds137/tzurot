---
id: TASK-891
title: >-
  Voice browse pagination replaces the page on a failed fetch while every other
  browse surface follows up ephemerally
status: To Do
assignee: []
created_date: '2026-09-04 22:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 889000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/voice/voices/browse.ts handles a failed page fetch (the !result.ok branch, around the classifyGatewayFailure call) by editing the failure into the page, while the other browse surfaces (character, channel, persona, deny, models) keep the page and send an ephemeral follow-up through followUpBrowsePageFailure (utils/browse/pageLoadFailure.ts). Found by the class sweep in the drain batch A1 review; left as-is there because which rendering is right for voice is a UX-taste call, not an agent call.
Owner question: should voice browse keep replacing the page on a failed fetch, or follow up ephemerally like the other five surfaces?
Recommendation: follow up ephemerally like the others — one behaviour across browse surfaces is easier to explain and the page the user was on stays visible; the change is one call plus one test, and the existing editReply test is updated rather than deleted.
Acceptance: a decision is recorded here; if aligned, voice pagination calls followUpBrowsePageFailure on !result.ok and its test asserts the followUp seam.
<!-- SECTION:DESCRIPTION:END -->
