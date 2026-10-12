---
id: TASK-1105
title: >-
  tzurot-usage-audit Step 2 overcounts about 2.2x: count each reply once, or
  delegate to the plugin usage-sweep
status: To Do
assignee: []
created_date: '2026-09-25 17:51'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1098000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the skill sums usage over JSONL lines, but Claude Code writes one line per content block of a reply and repeats that reply usage on each line. Measured by the Deck management session on 2026-09-25: 1743M line-summed vs 801M counted per reply this week (2.18x; 2.29x since the 09-24 reset). Every weighted total in the machine-local usage-ledger.md and any posture arithmetic built on them runs about 2.2x high; the meter percentages are unaffected.

Fix shape: rewrite Step 2 of .claude/skills/tzurot-usage-audit/SKILL.md to count each reply once at its largest output_tokens (the harness plugin usage-sweep on PATH already does this) or to call usage-sweep directly and drop the hand-rolled jq; then re-derive the ledger rows written from the inflated totals and mark the earlier rows as line-summed so the drift ledger stays honest. Note cloud units stay invisible to the sweep (the 2026-09-25 teleport probe wrote no local JSONL).

Acceptance: the skill and usage-sweep agree on the weekly total within a few percent on the same JSONLs; the ledger carries the corrected rows with the method named.
<!-- SECTION:DESCRIPTION:END -->
