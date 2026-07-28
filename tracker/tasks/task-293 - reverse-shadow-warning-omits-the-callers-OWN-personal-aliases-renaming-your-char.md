---
id: TASK-293
title: reverse-shadow warning skips the caller-owned personal aliases
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 293000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (#1702 r2 observation) — reverse-shadow warning omits the caller's OWN personal aliases: renaming your character to match your own personal alias silently kills that alias with no proactive nudge (the my-aliases browse shows `shadowed: true` after the fact, so it's discoverable, just not at rename time). Global rows warn; personal rows were excluded for privacy — but the CALLER's own rows have no privacy concern. **Fix shape**: extend the create/rename shadow probe with a second query over the caller's own personal rows (`userId = caller`), merged into `shadowedAliases`. **Promote when**: next reverse-shadow/alias-warning touch, or an owner report of a silently-dead personal alias.

**Why:** Caller's own data — the privacy rationale doesn't apply to it; two-line query addition.
<!-- SECTION:DESCRIPTION:END -->
