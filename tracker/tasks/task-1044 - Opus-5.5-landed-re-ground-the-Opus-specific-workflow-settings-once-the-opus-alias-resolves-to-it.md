---
id: TASK-1044
title: >-
  Opus 5.5 landed: re-ground the Opus-specific workflow settings once the opus
  alias resolves to it
status: To Do
assignee: []
created_date: '2026-09-22 16:36'
updated_date: '2026-09-22 18:28'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1038000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Anthropic released Claude Opus 5.5 on 2026-09-22 (claude-opus-5-5, $4/$20 per MTok, cache reads 5%, default effort MEDIUM, thinking always on; Opus 5 moved to the legacy list). The models overview now says start with Opus 5.5 for most workloads and use Fable 5.1 when 5.5 at higher effort still falls short. Probed the same day: Claude Code 2.1.278 (npm latest) still resolves the opus alias to claude-opus-5, and the model is grayed out in the picker. Nothing in the repo pins an Opus model ID (git grep -n -i opus-5 -- packages services .github .claude returns nothing), so the switch arrives through the alias with no code change.
Fix shape, when the alias flips: (1) settings.json modelSettings gains a claude-opus-5-5 entry at medium (the docs: 5.5 at medium matches Opus 5 at high and thinks MORE per turn at a given level, so a carried-over high is the wrong setting) and the effort sweep in the driver memory runs on the first 5.5 drain window; (2) ~/.claude/statusline.sh effort_want for opus needs a 5.5 case at medium or the drift alarm goes red on every 5.5 session; (3) .claude/skills/tzurot-orchestration/SKILL.md carries two Opus-5 tendency cites, over-delegation (When the worker reports) and long disk deliverables (Opus-main-loop posture); keep both rules, re-ground the cites against the 5.5 prompting guide, which has no subagent-control section; (4) owner decision on the driver split: the docs invert the default (Opus 5.5 first, Fable for what it cannot do) and Fable is the tighter usage line, so run the next drain window on 5.5 at medium as the sweep sample before changing the theme-day driver. Nothing else references Opus 5: opus-implementer.md already runs at medium; the turn-end posture rules already match the 5.5 guide on unattended runs.
Sequencing (owner ruling 2026-09-22): run the /tzurot-usage-audit mining pass at the next stopping point (#2472 merged, TASK-318 PR pushed) BEFORE the first Opus 5.5 window, so the Fable sample is closed before the sweep sample opens; Fable weekly usage was 55 percent on the Tuesday, ahead of linear pace.
Acceptance: a 5.5 session shows the right effort with no statusline alarm; the two skill cites name 5.5 sources; the sweep result is recorded in the driver memory; the driver-split decision is written to the board.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-22 (Opus 5.5 session): items (1) and (2) DONE. ~/.claude/settings.json modelSettings gained claude-opus-5-5 at medium; ~/.claude/statusline.sh wants medium for an Opus 5.5 model name (display name or id), high for Opus 5 and Fable, alarm tested for all eight model x effort pairs. The alias question is moot: the owner selected Opus 5.5 by /model. Remaining: (3) the two orchestration-skill cites, (4) the sweep result and driver-split decision after this window.
<!-- SECTION:NOTES:END -->
