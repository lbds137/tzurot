---
id: TASK-178
title: 'test:audit serviceDirs is a hardcoded list'
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:tooling'
  - 'area:conversation-history'
  - 'area:db'
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 178000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`test:audit` `serviceDirs` is a hardcoded list — auto-discover `packages/*/src`

**Why:** `findServiceFiles` enumerates scan dirs by hand (4 service/package dirs + now identity + conversation-history via #1344). Every package the next extraction creates silently escapes the ratchet until someone remembers to add it here — the exact hole #1344 just closed, which will recur. `hasPrismaUsage()` already filters at the file level, so the blast radius of scanning all packages is low. **Fix shape**: replace the hardcoded list with a glob over `packages/*/src` + `services/*/src` (readdirSync), keeping the Prisma-usage filter; exclude non-service packages (tooling, test-utils, test-factories) if they produce noise. Bump TEST_AUDIT_IMPL_VERSION + refresh baseline. **Promote when**: the next package extraction, or another "package escaped the ratchet" omission. Surfaced 2026-06-25 by PR #1344 round-2/3 claude-review (explicitly "no change needed in this PR; backlog candidate").
<!-- SECTION:DESCRIPTION:END -->
