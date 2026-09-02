---
id: TASK-866
title: >-
  lines:check: add a skills surface so skill-body bytes are measured and
  ratcheted
status: To Do
assignee: []
created_date: '2026-09-02 13:39'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 866000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: skill bodies under .claude/skills total roughly 240k bytes and every invoked skill is re-injected on each compaction, yet nothing measures their growth the way lines:check does for rules and CURRENT.md. Owner decision 2026-09-02: add the surface (and run the economy pass, filed separately).

Fix shape: extend the lines:check / lines:update-baseline tooling with a skills surface over .claude/skills/*/SKILL.md — a baseline block with a grace margin like rules, --breakdown ranking skills worst-first by bytes, --surface skills for the scoped refresh. Colocated tests; OPS_CLI_REFERENCE row if flags change; 05-tooling mentions the surface in one line.

Acceptance: lines:check prints a skills row gated on a written baseline; --breakdown ranks skills by bytes; lines:update-baseline --surface skills refreshes only that block; pnpm quality green.
<!-- SECTION:DESCRIPTION:END -->
