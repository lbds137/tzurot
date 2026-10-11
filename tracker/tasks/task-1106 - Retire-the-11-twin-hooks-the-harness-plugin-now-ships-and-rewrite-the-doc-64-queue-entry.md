---
id: TASK-1106
title: >-
  Retire the 11 twin hooks the harness plugin now ships, and rewrite the doc-64
  queue entry
status: To Do
assignee: []
created_date: '2026-09-25 17:52'
updated_date: '2026-10-11 17:34'
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
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): retire the strict-superset twins first in one PR; list the rest with their Tzurot-only delta to upstream before they go.

Classification 2026-10-11 (groups A+B): retire bare-token-binding-reminder, blocking-question-channel-check, context-size-reminder, queued-message-receipt, turn-end-shape-gate, promise-ledger-check, grep-escaped-dollar-guard, dispatch-posture-gate (needs SYG_DISPATCH_SRC_RE in project settings env). KEEP with delta: claim-shape-guard (husky pre-commit wiring, not a twin in effect); self-matching-pattern-guard (plugin lacks the bracketed-literal-recurs check, upstream to Seyag first); python-heredoc-edit-guard (plugin deliberately looser: blocks only same-file read-modify-write). Group C (cwd-drift, lossy-pipe, pr-monitor-reminder, session-start) pending.
<!-- SECTION:NOTES:END -->
