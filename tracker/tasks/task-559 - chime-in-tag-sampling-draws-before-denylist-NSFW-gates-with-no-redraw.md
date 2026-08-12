---
id: TASK-559
title: chime-in tag sampling draws before denylist/NSFW gates with no redraw
status: To Do
assignee: []
created_date: '2026-08-12 22:33'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 559000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: sampleUpTo(pool, cap) runs before per-character gates (chimeInTag.ts:161 vs runSlashChatGates in characterTurn.ts:514). A gate-blocked sampled character silently loses its slot: in an SFW channel a tag whose most numerous carriers are NSFW-gated can produce a notice claiming "picked 5 at random" with ZERO public responses while never-drawn eligible characters existed. The module header documents the other two accepted tradeoffs (completion-order delivery, take:500 bound) but not this one, so it reads as a miss rather than a decision.

Fix shape (owner may prefer either): redraw/filter against gates before sampling, or document the tradeoff and make the notice name only characters that actually passed submission.

Acceptance: either a redraw test, or the documented tradeoff plus a notice that cannot overclaim. Source: 2026-08-12 review (tags reviewer F2, order CONFIRMED).
<!-- SECTION:DESCRIPTION:END -->
