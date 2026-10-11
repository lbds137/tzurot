---
id: TASK-1213
title: >-
  Move tzurot-session-mining and tzurot-usage-audit onto the Seyag
  session-extract/session-log/usage-sweep tooling
status: To Do
assignee: []
created_date: '2026-10-11 18:51'
labels:
  - 'area:repo'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1202000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1207 cut both skills to Tzurot deltas over the Seyag twins, but each keeps its own mechanics where Seyag uses fixture-tested tools: session-mining Steps 0/1/1b hand-roll jq extraction and a README range ledger (Seyag: session-extract + session-log ledger, which also feed a third procedure lens), usage-audit Step 1 derives the window by hand and Step 5 keeps its own ledger columns (Seyag: claude-usage --json, usage-sweep). Two mechanisms for one job drift, and Tzurot runs skip the procedure lens.

What: migrate each kept mechanic to the Seyag tool, carrying the existing README ranges and ledger rows over so no mined range is re-mined, then cut the remaining sections to pointers. usage-audit Step 2 waits on TASK-1105.

Acceptance: both skills hold only Tzurot bindings (paths, slug, ops commands); a session-mining run produces all three lens reports; the usage ledger history is preserved.
<!-- SECTION:DESCRIPTION:END -->
