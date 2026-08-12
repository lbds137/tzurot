---
id: TASK-523
title: Update the ops backlog gate description in 05-tooling.md
status: To Do
assignee: []
created_date: '2026-08-11 13:22'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 523000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2063 added two gated checks to pnpm ops backlog — relative-link resolution and doc-N cross-reference validation across tracker/docs, tracker/tasks and backlog. The command table in .claude/rules/05-tooling.md still describes the gate as "now.md caps + queue.md doc references + task-file integrity + open-task triage labels", so an always-loaded surface now understates what the gate enforces. Surfaced by the round-7 review.

Why not fixed in 2063: .claude/rules is review-gated (00-critical) and the Opus 5 orchestrator trial in the task-513 record carries an explicit no-rules-edits boundary. Same handling as TASK-520.

What: add the two checks to that line. Rides the next .claude/rules PR.

SECOND STALENESS IN THE SAME FILE (PR 2066 round-6 review, 2026-08-11): the Commit Message Format section lists "Scopes: ai-worker, api-gateway, bot-client, common-types, ci, deps", which is a strict SUBSET of what commitlint actually accepts. The real scope-enum is built as allScopes in commitlint.config.cjs - dynamically generated from every workspace package and service directory, PLUS static root scopes the doc never mentions (skills, rules, hooks, backlog, docs, legal, prisma, repo, husky). PR 2066 itself legitimately committed as docs(skills), a scope the always-loaded doc says does not exist.

The failure direction is the expensive one: an agent trusting the doc believes a valid scope is invalid, so it either omits the scope or picks a worse-fitting one from the short list - and never learns otherwise, because omitting the scope also passes. Wrong-but-passing is why this went unnoticed.

Fix shape for both items: rather than re-listing a hand-maintained subset that will drift again, point the doc at commitlint.config.cjs as the source of truth and name only the rule (dynamic package scopes + a static root set), the same way the gate description should name its checks. Both edits ride the same .claude/rules PR.

THIRD OMISSION, same line (PR 2069, 2026-08-11): the gate now also prints a NON-gating warning naming any uncommitted file under tracker/. It is deliberately advisory — it never sets the exit code — so the description should say that rather than list it beside the gating checks; a reader who takes it for a gate will assume an uncommitted task file fails CI, which is exactly backwards. Note the trend: three separate additions to one command have now landed without the always-loaded description moving, which is the argument for naming the source of truth instead of re-listing checks by hand.

Acceptance: the 05-tooling.md description of pnpm ops backlog names every check the gate actually runs AND distinguishes the advisory warning from the gating checks, AND its scope guidance no longer contradicts commitlint.config.cjs.
<!-- SECTION:DESCRIPTION:END -->
