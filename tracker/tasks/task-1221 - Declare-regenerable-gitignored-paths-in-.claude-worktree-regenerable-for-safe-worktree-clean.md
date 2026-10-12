---
id: TASK-1221
title: >-
  Declare regenerable gitignored paths in .claude/worktree-regenerable for
  safe-worktree-clean
status: To Do
assignee: []
created_date: '2026-10-12 04:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1210000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: safe-worktree-clean HOLDs every agent worktree that has build output, because Tzurot declares no regenerable ignored paths. On 2026-10-12 one tree drew about 20 HOLD:ignored lines for packages/*/dist/, packages/common-types/src/generated/prisma/, tsconfig.tsbuildinfo and the .husky/_/ stubs, all rebuilt by pnpm install and the package builds. The tool reads a committed .claude/worktree-regenerable from its base (origin/main today), one glob per line.

What: add .claude/worktree-regenerable listing those paths (globs such as packages/*/dist/*, packages/common-types/src/generated/prisma/*, */tsconfig.tsbuildinfo, .husky/_/*), checked against a real agent worktree's ignored set. It takes effect once it reaches main (next release), or sooner if the seyag base becomes configurable (lbds137/seyag#75).

Acceptance: safe-worktree-clean on a built agent worktree prints no HOLD:ignored line for build output.
<!-- SECTION:DESCRIPTION:END -->
