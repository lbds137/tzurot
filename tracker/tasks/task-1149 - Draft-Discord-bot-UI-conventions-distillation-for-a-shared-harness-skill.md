---
id: TASK-1149
title: Draft Discord bot UI conventions distillation for a shared harness skill
status: To Do
assignee: []
created_date: '2026-10-01 02:05'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila wants one Discord design language across her bot projects; the YAGPDB session consulted Tzurot (2026-09-30) on buttons/dismiss/slash conventions and relayed her packaging idea - an optional harness skill rather than per-project prose. Tzurot is the maturity model, so the draft starts from our codified material: 04-discord.md (3-second rule incl. nested-router nuance, button text policy label+emoji separate, button order primary-view-nav-destructive, subcommand table browse/view/create/edit/delete/list, ephemeral vs public classes, ack-first) plus practiced code patterns (page-counter button, spawner-gated dismiss with server-side permission check, deferReply-quiet-success).

What: distill the project-neutral design language (NOT the Tzurot TypeScript utilities) into a draft doc; hand it to the Harness session to package as an optional harness skill; Tzurot keeps its code-level rules.

Acceptance: draft exists as a doc the Harness session can lift verbatim; YAGPDB slash pass offered a review against it.
<!-- SECTION:DESCRIPTION:END -->
