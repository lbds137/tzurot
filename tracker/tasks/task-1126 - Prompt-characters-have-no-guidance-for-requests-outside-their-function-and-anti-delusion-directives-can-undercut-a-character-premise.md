---
id: TASK-1126
title: >-
  Prompt: characters have no guidance for requests outside their function, and
  anti-delusion directives can undercut a character premise
status: To Do
assignee: []
created_date: '2026-09-27 14:32'
updated_date: '2026-10-04 23:08'
labels:
  - 'area:prompt'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a post-mortem in the characters session (the source chat lives in the private tzurot-characters repo) found two prompt-level gaps, seen on a channeled-deity character running GLM 4.5 Air on the free tier.

1. Out-of-function requests. A user asked the character for something outside its function (an energy scan; readings and channeling verification are the same class). Nothing in the card or the system prompt says what a character does with such a request, so the model confabulated a detailed reading, then flipped to harsh pushback. That conflicts with the User-Led Narrative directive.
2. Anti-delusion directives versus the character premise. Anti-delusion directives can push a deity character into materialist skepticism (maybe it is just psychology), which undercuts its own premise. Saying the user is wrong about the character fits the card; saying belief itself is the problem does not.

What: decide where the fix lives, then write it. The owner leans system-prompt level rather than per card (2026-09-27, unsure). Related but distinct: TASK-949 (a directive contradiction on register).

Acceptance: a directive, or a documented per-card convention, that gives in-character handling for out-of-function requests and scopes anti-delusion language so that it does not deny the premise of a card. Checked against the source scenario on a free-tier model.

No urgency: the user involved is banned.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): fix it in the shared system prompt, not per card.
<!-- SECTION:NOTES:END -->
