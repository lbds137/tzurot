---
id: TASK-1132
title: >-
  develop-code-commit-guard override passes a commit whose INDEX holds gated
  code files
status: To Do
assignee: []
created_date: '2026-09-27 19:12'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 is documented as "doc-only commit with an incidentally dirty tree: stage ONLY the doc files", but the override is a blanket pass: `.claude/hooks/develop-code-commit-guard.sh:438-439` emits ok for any segment carrying the token, and never inspects what is STAGED. On 2026-09-27 a `pnpm ops worktree:transfer` had already run `git apply --index` (21 code files staged); a following `git add <tracker file>` plus the override committed all 22 onto develop, and the push reached pre-push before the driver stopped it (it never landed on origin). Any staged code rides through the override the same way.

What: when the override token is present, compute the STAGED set (`git diff --cached --name-only`, plus the paths the command itself adds where parseable) and block if any staged path is a gated (non-doc) file, naming them. Keep the working-tree check for the no-override path. Consider the same check in .husky/pre-commit so it holds outside Claude sessions. Probe cases: override + only a staged tracker file passes; override + a staged .ts file blocks.

Acceptance: the override can no longer commit a staged code file to develop.
<!-- SECTION:DESCRIPTION:END -->
