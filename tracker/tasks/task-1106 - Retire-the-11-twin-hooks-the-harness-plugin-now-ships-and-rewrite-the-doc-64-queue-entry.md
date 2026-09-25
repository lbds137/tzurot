---
id: TASK-1106
title: >-
  Retire the 11 twin hooks the harness plugin now ships, and rewrite the doc-64
  queue entry
status: To Do
assignee: []
created_date: '2026-09-25 17:52'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1099000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-harness docs/adoption-tzurot.md (commit f9435f6) lists 11 hooks under .claude/hooks that have a same-named twin in the harness plugin; a project hook of the same name wins, so Tzurot keeps running its own copies and misses the plugin fixes. The same doc says usage-audit and session-mining now ship machine-wide. backlog/cold/queue.md still describes doc-64 (the meta-harness spinoff) as a side track awaiting a council pass, but the work moved to the Deck management role on 2026-09-25.

Fix shape: follow the retire-a-twin procedure in adoption-tzurot.md for each of the 11 hooks (delete the project copy plus its probe registry entry, keep any Tzurot-only behaviour by upstreaming it first), one PR for the hooks and one direct doc commit for the queue.md entry pointing at the Deck management role.

Owner question: retire all 11 twins now, or only the ones whose plugin version is a strict superset?
Recommendation: retire the strict-superset ones first in one PR and list the rest with their delta, since a twin that carries Tzurot-only behaviour needs upstreaming before it can go.

Acceptance: no .claude/hooks file has a same-named plugin twin without a recorded reason; guard:hook-probes green; the queue.md doc-64 entry names the Deck management role as the owner.
<!-- SECTION:DESCRIPTION:END -->
