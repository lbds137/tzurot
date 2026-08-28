---
id: TASK-787
title: Split the server target out of /deny add everywhere
status: To Do
assignee: []
created_date: '2026-08-28 02:41'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 787000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner verdict from the beta.209 smoke run (2026-08-28, TASK-764 acceptance pass): it is confusing that /deny add everywhere accepts either a user OR a server. index.ts:153-165 — everywhere is the only subcommand exposing server: (a server denial is bot-wide by definition), so it carries two OPTIONAL target options (user:, server:) while every sibling scope subcommand is single-target with a required user:. Two target types under one scope word breaks the scope-first symmetry the redesign bought.

Fix shape (proposal — final naming is owner taste, veto on the PR): make everywhere single-target (user: required), and give server denials their own scope subcommand (e.g. /deny add server + /deny remove server, server: required), so every subcommand names exactly one target shape and no optional-pair validation is needed. Sweep the runtime validation that currently arbitrates the user/server pair, and pnpm test:component for the command-structure snapshots.

Acceptance: each /deny add|remove subcommand takes exactly one target option, required; the old dual-optional everywhere shape is gone; component snapshots updated; owner confirms the naming reads right.
<!-- SECTION:DESCRIPTION:END -->
