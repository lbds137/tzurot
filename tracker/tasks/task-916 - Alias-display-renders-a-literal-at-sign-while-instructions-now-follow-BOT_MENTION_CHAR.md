---
id: TASK-916
title: >-
  Alias display renders a literal at-sign while instructions now follow
  BOT_MENTION_CHAR
status: To Do
assignee: []
created_date: '2026-09-08 23:06'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 914000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the character alias command and the alias browse render alias names as a backticked at-sign plus the alias in five user-facing places (services/bot-client/src/commands/character/alias.ts and aliasBrowse.ts; find them with grep -n '`@' on those two files). After the instruction strings started reading the configured mention character, these are the remaining literal sigils in copy a user sees. On the development deployment the mention character is the ampersand, so the rendered label shows a sigil the user cannot type there.

What: this is display of a name, not an instruction to type something, so following the configured sigil is a product choice rather than a defect. Two shapes: interpolate BOT_MENTION_CHAR at those five sites (mechanical, one PR), or leave the rendered label as a name with the at-sign as decoration.

Owner question: should alias labels render with the configured mention character instead of a literal at-sign?
Recommendation: yes, interpolate it — the label is read as how to invoke the alias, and on dev it currently shows a sigil that does not work; one PR, five sites.

Acceptance: either the five sites read the configured character with a test on the non-default value, or the decision to keep the literal sigil is recorded here.
<!-- SECTION:DESCRIPTION:END -->
