---
id: TASK-838
title: 'Periodic-maintenance cadence ledger: overdue nag for the audit skills'
status: To Do
assignee: []
created_date: '2026-08-31 02:30'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 838000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner pain 2026-08-31 (verbatim): "we can have all the damn skills. But if there is nobody who remembers to use them every now and again, then they kinda just sit there and rot." The periodic passes — /tzurot-doc-audit, memory promotion, the rules economy/trim pass, /tzurot-session-mining, /tzurot-arch-audit, /tzurot-usage-audit, the doc-63 ratchet-tighten pass — all rely on the owner remembering to prompt for them. Their cadences exist only as prose inside each skill.

Precedent to copy, in-repo: secrets:rotation-status (ledger + overdue state + a daily nag). Same shape, pointed at process passes instead of secrets.

Fix shape:
1. A tracked registry (JSON, baseline-style) of periodic passes: name, cadence days, last-run stamp, one-line what-it-buys. Seed with the seven above; cadences from each skill body where stated (/tzurot-session-mining says 4-6 weeks or ~500 messages; /tzurot-usage-audit says near the weekly reset), owner-tunable.
2. pnpm ops cadence:status — prints overdue passes; pnpm ops cadence:mark <name> stamps a run (the sanctioned update path, same contract as test:audit --update).
3. Surface it where zero attention is needed: the SessionStart hook already injects CURRENT.md — append the cadence:status overdue lines there, and add one row to 06-backlog § Starting a Session step 6 (the repo-state sweep) naming the command.
4. Registered ops command needs its OPS_CLI_REFERENCE row (guard:ops-doc) and a WHY.md if it registers as an audit tool (read docs/reference/audit-enforcement.md first).

Token-usage note (part of the owner ask): the rules economy pass is one of the seeded cadences, and lines:check --breakdown is its trim-order input — this ledger is what makes that pass recur instead of happening once.

Acceptance: cadence:status lists every seeded pass with days-since-last-run and flags overdue ones; mark updates the stamp; the SessionStart surface shows overdue passes without being asked; a unit test covers status/mark and the overdue computation.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: owner-ruling
created: 2026-09-13
---
Owner ruling 2026-09-13: SCHEDULED — this builds as the next process unit after TASK-951, on the Opus drain lane; the doc-61 economy pass over .claude/rules and backlog/now.md runs right after it so the trim has an owner that nags before it regrows. Measured that day: ~280 KB (~70k tokens) always-loaded per session (rules 162,211 B, CURRENT.md 38,911, now.md 27,369, active-epic 24,482, MEMORY.md 9,695); the rules regrew from 142,502 B after the 2026-08-09 trim to 162,211.
---
<!-- COMMENTS:END -->
