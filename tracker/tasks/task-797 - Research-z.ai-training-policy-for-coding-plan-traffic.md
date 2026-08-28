---
id: TASK-797
title: Research z.ai training policy for coding-plan traffic
status: To Do
assignee: []
created_date: '2026-08-28 19:05'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 797000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the bot routes GUEST traffic to z.ai directly (the glm-5.3-flash piggyback on the system coding-plan key), which bypasses OpenRouter entirely — so the OpenRouter data-policy settings that enforce the Discord-ToS no-training posture do not govern that path in either direction. Whether that path is compliant is currently unknown.

Context: Discord developer ToS prohibits training on user data. The owner reads that as barring the bot from sending user content to providers that train, and has OpenRouter privacy settings configured accordingly (see the TASK-791 404 half). z.ai is the one provider reached outside those settings.

What: read z.ai official terms of service and privacy policy, specifically for the coding-plan / API tier, and report what they actually commit to regarding training on submitted data — including whether the coding-plan tier differs from pay-as-you-go, and whether any opt-out exists. Cite the documents, quote the operative clauses, and state plainly where the terms are silent rather than inferring.

Acceptance: the owner can decide whether the piggyback path stays as-is, needs an opt-out toggled, or has to be reconsidered — on quoted terms rather than a guess. Finding is recorded so it is not re-researched.
<!-- SECTION:DESCRIPTION:END -->
