---
id: TASK-1152
title: >-
  Override deepmerge-ts >=8.0.0 (GHSA-ggr8-5vv4-36mx, high) with prisma-CLI
  verification
status: To Do
assignee: []
created_date: '2026-10-01 18:30'
labels:
  - 'area:deps'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
pnpm audit surfaces deepmerge-ts 7.1.5 (via @prisma/config 7.10.0 <- prisma CLI, dev-chain) vulnerable to GHSA-ggr8-5vv4-36mx (stack exhaustion, patched >=8.0.0); the GitHub advisory list does not carry it yet, so security:advisories stays silent. The fix is a forced major through @prisma/config - verify the prisma CLI still loads config and runs a dev db:safe-migrate dry-run at 8.x before riding it. Promote when: the advisory appears in security:advisories output, or the next prisma patch bumps deepmerge-ts upstream.
<!-- SECTION:DESCRIPTION:END -->
