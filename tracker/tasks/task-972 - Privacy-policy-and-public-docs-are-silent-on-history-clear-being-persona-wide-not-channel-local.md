---
id: TASK-972
title: >-
  Privacy policy and public docs are silent on /history clear being
  persona-wide, not channel-local
status: To Do
assignee: []
created_date: '2026-09-13 23:23'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 968000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found 2026-09-13 by the TASK-966 outward sweep. /history clear writes a context epoch keyed (user, personality, persona) with no channel column, so it hides older messages for that character in EVERY channel, including the cross-channel feed. Three public or in-app surfaces describe it without saying so: docs/legal/PRIVACY_POLICY.md (~121) calls it a soft reset with undo; docs/guides/getting-started.md (~72) says it resets the recent conversation, which reads channel-local; the Discord command description in services/bot-client/src/commands/history/index.ts (~285) says Clear conversation context (soft reset), no scope word. All three are rendered live or shown in the client. None is factually wrong, each is silent on the scope a user would most likely assume wrongly. Owner ruled 2026-09-13 that the TASK-966 PR fixes the guide and the command description only; the legal surface was held back as an owner call.
Fix shape: add a scope phrase to the privacy-policy History bullet naming that the clear applies to that character across every channel you share with it. One sentence, no policy change — the described behavior is unchanged, only stated. Verify against the shipped code at the time of writing rather than this description, since TASK-966 changes what purge does but NOT what clear does.
Owner question: should the privacy policy line gain the persona-wide scope phrase, or stay as it is?
Recommendation: add it — the sentence is silent rather than wrong, so this is an accuracy improvement on a legal surface with no policy change, and the two sibling surfaces are being clarified anyway.
Acceptance: the privacy-policy History bullet states the scope of a clear; the wording matches the guide and the command description so the three surfaces agree.
<!-- SECTION:DESCRIPTION:END -->
