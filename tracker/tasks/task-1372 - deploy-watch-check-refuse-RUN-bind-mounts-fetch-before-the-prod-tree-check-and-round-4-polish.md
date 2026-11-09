---
id: TASK-1372
title: >-
  deploy:watch-check: refuse RUN bind mounts, fetch before the prod tree check,
  and round-4 polish
status: To Do
assignee: []
created_date: '2026-11-09T03:10:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1355000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2726 (TASK-314) merged at review round 4 by owner ruling (merge now, file the rest). Round 4 found a latent false-green class: RUN --mount=type=bind (or --mount with no type=, bind being the default) reads build-context files without any COPY, and parseInstructionLine in packages/tooling/src/deployment/watch-patterns.ts never inspects RUN, so the guard would print a pass for unwatched mounted sources. services/website/Dockerfile has no mounts today, so nothing is exposed now.

What: (1) refuse RUN --mount= with type=bind or no type= (allow cache, secret, tmpfs), with a test and a canary; (2) git fetch origin develop main before verifyProdPublishedTree compares HEAD, or document as-of-last-fetch in the docstring and the OPS_CLI_REFERENCE.md caveat; (3) missing-serviceId branch: UsageError or a type-narrowing comment; (4) error text for doubled-slash sources and nested $(( )) arithmetic; (5) .claude/skills/tzurot-git-workflow/SKILL.md release line: Railway dashboard or API.

Acceptance: item 1 shipped with its canary red-tail; items 2-5 shipped or dispositioned in the PR body.
<!-- SECTION:DESCRIPTION:END -->
