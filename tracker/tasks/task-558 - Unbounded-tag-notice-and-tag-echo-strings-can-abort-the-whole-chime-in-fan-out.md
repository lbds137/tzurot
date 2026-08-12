---
id: TASK-558
title: Unbounded tag-notice and tag-echo strings can abort the whole chime-in fan-out
status: To Do
assignee: []
created_date: '2026-08-12 22:33'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 558000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the /chime-in tag: over-cap sampling notice interpolates cap-many markdown-escaped display names (each up to 255 chars, escaping can ~double) into one UNGUARDED context.editReply (chimeInTag.ts:166; only the sibling deleteReply branch has try/catch). Past 2000 chars Discord throws 50035 and the whole fan-out aborts before any turn runs - and tags are character-owner-authored, so any user can publish public characters with long names on a popular tag and break that tag for everyone. Same class: emptyTagPoolDetail (tagPool.ts:129) echoes the unbounded typed tag (Discord string options allow 6000 chars), breaking its own error reply.

Fix shape: truncate the name list (...and N more), wrap the notice editReply in the proceed-on-failure guard the deleteReply branch already has, cap the echoed needle at TAG_LIMITS max.

Acceptance: length-bounding tests for both strings. Source: 2026-08-12 review (tags reviewer F1/F3).
<!-- SECTION:DESCRIPTION:END -->
