---
id: TASK-1316
title: Migrate opus-implementer to seyag:implementer (stale fork)
status: To Do
assignee: []
created_date: '2026-10-28T15:21:00Z'
labels:
  - area:skills
  - area:hooks
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1299000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: tzurot/.claude/agents/opus-implementer.md (41 lines) is a stale fork of seyag/plugins/seyag/agents/implementer.md (38, fuller contract: scratch containment, step-0 self-heal git exception, project-neutral verification floor). Noticed 10-27 during the Sonnet driver arm; held until the Tue arm ended per the Inbox trigger. Same direction as the standing push to move generic Tzurot tooling into Seyag. Spec: dev-docs BACKLOG Inbox commit 4acf485.

What: point tzurot-orchestration SKILL.md (~line 49, Worker model tier) and dispatch-spec-ledger-gate.sh plus its probe at seyag:implementer; delete the local agent file; move the pnpm verification floor (pnpm --filter @tzurot/<pkg> test, typecheck, typecheck:spec) into Tzurot CLAUDE.md or a rules file so it binds seyag:implementer sessions; confirm the model override still applies (pass model on the Agent call, or a project override).

Acceptance: git grep opus-implementer over tracked files comes back empty; the gate and its probe pass on the new agent name; the verification floor is stated in a Tzurot always-loaded surface, not only the deleted agent file; model-override behavior confirmed by the dispatch path that replaces the deleted agent.

Needs a PR (agent file + hook + skill are load-bearing). Sequence: lands after PR 2678 (TASK-1315) merges — same skill file, separate review scope.

Close-out notes (PR 2679, recorded before the Done flip so the acceptance reads honestly): (1) the model-override clause was FALSIFIED on the z.ai lane — both dispatches ran glm-5.3-flash despite model: sonnet (subagent JSONL .message.model) — and moved to TASK-1318 (Anthropic-lane probe + Worker-model-tier caveat). (2) The grep-empty clause is met OUTSIDE tracker/ (zero hits); the tracker hits are historical records (doc-69 snapshot, resolved tasks, this task's own title) that 06-backlog keeps — the scope note lives in the PR body too.
<!-- SECTION:DESCRIPTION:END -->
