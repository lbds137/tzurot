---
id: TASK-1106
title: >-
  Retire the 11 twin hooks the harness plugin now ships, and rewrite the doc-64
  queue entry
status: To Do
assignee: []
created_date: '2026-09-25 17:52'
updated_date: '2026-10-19 04:12'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1099000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-harness docs/adoption-tzurot.md (commit f9435f6) lists 11 hooks under .claude/hooks that have a same-named twin in the harness plugin; a project hook of the same name wins, so Tzurot keeps running its own copies and misses the plugin fixes. The same doc says usage-audit and session-mining now ship machine-wide. backlog/cold/queue.md still describes doc-64 (the meta-harness spinoff) as a side track awaiting a council pass, but the work moved to the Deck management role on 2026-09-25.

Fix shape: follow the retire-a-twin procedure in adoption-tzurot.md for each of the 11 hooks (delete the project copy plus its probe registry entry, keep any Tzurot-only behaviour by upstreaming it first), one PR for the hooks and one direct doc commit for the queue.md entry pointing at the Deck management role.

Acceptance: no .claude/hooks file has a same-named plugin twin without a recorded reason; guard:hook-probes green; the queue.md doc-64 entry names the Deck management role as the owner.

## Merged from TASK-1119 (2026-10-12)

TASK-1119 (priority medium): retire Tzurot's `gh:ci-gate` monitor hook copies once the harness pr-ci-wait port ships. Harness 0.3.12 merged 2026-09-27 (claude-harness main d760527) with bin/pr-ci-wait and the PostToolUse pr-monitor-reminder; Deck management installs it, and it is startable once a Tzurot session runs on 0.3.12. This is the pr-monitor-reminder member of group C above (cwd-drift, lossy-pipe, pr-monitor-reminder, session-start): follow the retirement steps in the harness repo `docs/adoption-tzurot.md` from that PR, including the `guard:monitor-command` three-copy pin (05-tooling.md, the hook heredoc, /tzurot-git-workflow) and the hook-probe registry entry; via PR (hooks and rules are review-gated). Acceptance: one pr-monitor reminder fires per PR push, not two; `pnpm ops guard:monitor-command` and `guard:hook-probes` pass; the three prose copies point at the harness mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): retire the strict-superset twins first in one PR; list the rest with their Tzurot-only delta to upstream before they go.

Classification 2026-10-11 (groups A+B): retire bare-token-binding-reminder, blocking-question-channel-check, context-size-reminder, queued-message-receipt, turn-end-shape-gate, promise-ledger-check, grep-escaped-dollar-guard, dispatch-posture-gate (needs SYG_DISPATCH_SRC_RE in project settings env). KEEP with delta: claim-shape-guard (husky pre-commit wiring, not a twin in effect); self-matching-pattern-guard (plugin lacks the bracketed-literal-recurs check, upstream to Seyag first); python-heredoc-edit-guard (plugin deliberately looser: blocks only same-file read-modify-write). Group C (cwd-drift, lossy-pipe, pr-monitor-reminder, session-start) pending.

Part 1 SHIPPED 2026-10-11 in #2604 (8 twins retired, SYG_DISPATCH_SRC_RE in project env). Open: the 7 kept twins, each waiting on its recorded delta landing in Seyag (asks sent via Deck) or on lossy-pipe test re-pointing; cloud coverage is TASK-1212.

2026-10-15 (Seyag session cross-check, its PR-2 mid-word-bracket FP fix): Tzurot's self-matching-pattern-guard copy has NO false positive on mid-word classes (it only recognizes leading one-char classes, so `cc-rou[t]e` derives no literal and never blocks) — but the same leading-only rule is a false NEGATIVE: a mid-word-bracket pattern derives no literal, so the recurrence check misses that evasion vector entirely. The retirement precondition for this twin is the plugin gaining Tzurot's leading-class recurrence check AND the PR-2 mid-word handling — the union, not either alone.

2026-10-18 (backlog review batch C, owner-approved): all 7 kept twins exist in both trees (seyag 858f2ec, 0.3.81) and still differ substantially (diff line counts Tzurot vs plugins/seyag/hooks: claim-shape-guard 194, self-matching-pattern-guard 148, python-heredoc-edit-guard 90, cwd-drift-guard 653, lossy-pipe-guard 169, pr-monitor-reminder 571, session-start 189). Next step per twin: a parity read (does the Seyag version cover the recorded Tzurot delta?), then one deletion PR for the twins that pass.

Part 2 parity reads 2026-10-19 (agy gemini, read-only; claims spot-checked by grep). Retire: lossy-pipe-guard (plugin covers all; Tzurot wrappers move to env SYG_LOSSY_PIPE_GH_WRAPPERS) in the part-2 PR. KEEP permanently, Tzurot-specific: claim-shape-guard (runs from .husky/pre-commit:190, not a Claude hook, so no twin in effect); cwd-drift-guard (refuses pnpm tracker writes from a linked worktree, cwd-drift-guard.sh:244-261, plugin has none); session-start (injects CURRENT.md, cadence:status, orphan worktree and gh:ci-gate waiter scan); pr-monitor-reminder (assignee backfill for unassigned human PRs, pnpm ops gh:ci-gate command pinned by guard:monitor-command, /tzurot-review-response pointer). KEEP pending Seyag: self-matching-pattern-guard (plugin has no literal-recurrence check, 0 'recur' matches vs 8); python-heredoc-edit-guard (plugin deliberately looser: does not block write-only generation scripts, Tzurot lines 64-66). Retire either only if Seyag adopts the delta.
<!-- SECTION:NOTES:END -->
