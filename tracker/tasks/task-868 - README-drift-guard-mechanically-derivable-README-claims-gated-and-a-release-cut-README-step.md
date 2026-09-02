---
id: TASK-868
title: >-
  README drift guard: mechanically-derivable README claims gated, and a
  release-cut README step
status: Done
assignee: []
created_date: '2026-09-02 14:23'
updated_date: '2026-09-02 23:55'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 868000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the root README drifted for six weeks unnoticed (Node prerequisite one major off the engines field, a Planned section three-quarters shipped or abandoned, three slash commands missing). Its derivable claims mirror the filesystem and package.json but nothing derives them; its feature prose has no named moment where it gets re-read. Owner call 2026-09-02: do both halves.

Fix shape: (1) a tooling guard, pnpm ops guard:readme, registered in the quality chain (gate-parity allowlist if needed) with a colocated test and an OPS_CLI_REFERENCE row: the packages/ and services/ lists in README equal the tree; the Node prerequisite line agrees with package.json engines; every fenced pnpm script the README shows exists in root scripts; every command under services/bot-client/src/commands (each subcommand directory and each top-level context-menu command file, test files excluded) appears in the Slash Commands list — strict, NO allowlist: Discord registers every command the bot ships, so an undocumented command is a documentation bug by definition (owner call 2026-09-02); relative links resolve. (2) one step in the release-cut procedure (tzurot-git-workflow skill, review-gated): with the release notes in hand, ask whether the README Highlights and Features still describe the range, and fix in the same cut. The doc-audit skill section 10 already lists README checks; point it at the guard for the derivable half.

Acceptance: guard:readme fails on a planted mismatch in each of the five classes and passes on develop; it runs in pnpm quality and CI (gate-parity green); the release procedure carries the README step.
<!-- SECTION:DESCRIPTION:END -->
