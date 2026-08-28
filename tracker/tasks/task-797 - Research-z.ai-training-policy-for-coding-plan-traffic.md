---
id: TASK-797
title: Research z.ai training policy for coding-plan traffic
status: Done
assignee: []
created_date: '2026-08-28 19:05'
updated_date: '2026-08-28 19:43'
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

## Outcome (2026-08-28)

Researched against z.ai official documents. The published terms do NOT state whether coding-plan traffic falls under the API-services non-training commitment or the individual-user regime — the subscription terms are the only document naming the coding plan and they carry no data, training, privacy, or retention clause at all. No opt-out or zero-retention setting exists in either direction. The question is therefore unresolvable from public documents; only written confirmation from z.ai would close it.

No code change results. Owner reviewed and elected no change to the routing. Operator-side compliance notes hold the quoted clauses and the decision record.

Do not re-research from public terms — the document set was swept and is exhaustive on this point. Reopen only if z.ai publishes coding-plan data terms or responds to a written inquiry.
<!-- SECTION:DESCRIPTION:END -->
