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

## Merged from TASK-1105 (2026-10-12)

TASK-1105 (priority medium) is the usage-audit Step 2 member that this task waits on: the skill sums usage over JSONL lines, but Claude Code writes one line per content block of a reply and repeats that reply usage on each line. Measured by Deck management 2026-09-25: 1743M line-summed vs 801M counted per reply this week (2.18x; 2.29x since the 09-24 reset). Every weighted total in the machine-local usage-ledger.md and any posture arithmetic built on them runs about 2.2x high; the meter percentages are unaffected. Fix shape: rewrite Step 2 of .claude/skills/tzurot-usage-audit/SKILL.md to count each reply once at its largest output_tokens (the plugin usage-sweep on PATH does this) or call usage-sweep directly and drop the hand-rolled jq; then re-derive the ledger rows written from the inflated totals and mark earlier rows as line-summed so the drift ledger stays honest. Cloud units stay invisible to the sweep (the 2026-09-25 teleport probe wrote no local JSONL). Acceptance addition: the skill and usage-sweep agree on the weekly total within a few percent on the same JSONLs; the ledger carries the corrected rows with the method named. The "usage-audit Step 2 waits on TASK-1105" dependency is now internal to this task.
<!-- SECTION:DESCRIPTION:END -->
