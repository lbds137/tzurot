---
id: TASK-954
title: >-
  PARKED: reply-ping toggle ignored — fix branch fix/reply-ping-gate must not
  merge without a Discord capture
status: To Do
assignee: []
created_date: '2026-09-13 15:53'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 951000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moved off backlog/now.md 🚨 (2026-09-13 context-budget trim). TASK-649 was ARCHIVED by owner call 2026-08-18 (unresolvable without a Discord runtime capture); the prod symptom is real. origin/fix/reply-ping-gate (5 commits, 3 fixups) carries the code-read fix: resolveReplyPersonality gates only on message.reference and never consults the inbound ping; mentions.repliedUser is populated on every reply so the discriminator is membership in mentions.users. Do NOT delete the branch; do NOT merge on the code read — a wrong answer suppresses every reply.
Promote when: a dev capture shows whether Discord lists a WEBHOOK author in mentions when the ping is ON. Full analysis in tracker/archive/tasks/task-649.
<!-- SECTION:DESCRIPTION:END -->
