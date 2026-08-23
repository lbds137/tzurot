---
id: TASK-752
title: 'Skill: recurring Claude Code usage audit + limit-drift ledger'
status: To Do
assignee: []
created_date: '2026-08-23 20:27'
labels:
  - 'area:repo'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 752000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner directive (2026-08-23) - the JSONL usage analysis (per-model token aggregation weighted 1x/5x/0.1x/1.25x, calibrated against /usage readings) produced a working weekly-Fable capacity estimate (~450M input-equiv); Anthropic does not publish limits and they may drift, so repeatable measurement + a data-point ledger tests the drift hypothesis and keeps budget planning surgical.
What: a tzurot-usage-audit skill (procedure: jq aggregation over ~/.claude/projects JSONLs since the Sunday 02:00 ET reset, weighted totals per model, ask owner for a fresh /usage reading, compute implied capacity, append to a machine-local ledger at ~/.claude/projects/-home-deck-Projects-tzurot/usage-ledger.md). The recipe seed lives in the user_fable_plan_mechanics memory. Decide at build: skill in .claude/skills (tracked, review-gated PR) vs local-only procedure doc - the analysis is owner-personal, repo is public.
Acceptance: invoking the skill reproduces the analysis end-to-end and appends a dated data point; ledger seeded with the 2026-08-23 calibration (69.2M@15%, 72.0M@16%, capacity ~450M).
<!-- SECTION:DESCRIPTION:END -->
