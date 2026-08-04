---
id: TASK-357
title: Switch council Qwen axis to 3.8 once it lands in the MCP registry
status: To Do
assignee: []
created_date: '2026-07-30 12:06'
updated_date: '2026-08-04 13:56'
labels:
  - 'size:S'
  - 'area:docs'
dependencies: []
priority: low
ordinal: 357000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Qwen 3.8 was announced 2026-07-19 at WAIC (2.4T params, first Qwen multimodal >1T, claimed second only to Claude Fable 5). Only Qwen3.8-Max-Preview is live in Qwen Studio; open weights promised with no date/license. Verified 2026-07-30 it is NOT in the council MCP registry (list_models --provider qwen returns 40 models, newest is qwen3.7-max), so it is not routable and /tzurot-council-mcp correctly still names Qwen 3.7 Max.
Note the registry DOES carry preview variants (qwen/qwen3.6-max-preview exists), so qwen3.8-max-preview may appear before open weights ship.
Fix shape: one-line swap of the Qwen entry in .claude/skills/tzurot-council-mcp/SKILL.md (two sites: the task table + the avoid-R1 paragraph). Review-gated per 00-critical (skills are load-bearing).
Promote when: `mcp__council__list_models --provider qwen` lists a 3.8 id. Owner raised this 2026-07-30.
<!-- SECTION:DESCRIPTION:END -->
