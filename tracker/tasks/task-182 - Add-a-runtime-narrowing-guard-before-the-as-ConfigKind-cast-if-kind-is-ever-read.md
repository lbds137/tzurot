---
id: TASK-182
title: Runtime narrowing guard for the as-ConfigKind cast outside autocomplete
status: To Do
assignee: []
created_date: '2026-06-28 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 182000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add a runtime narrowing guard before the `as ConfigKind` cast if `kind` is ever read outside autocomplete

**Why:** `preset/autocomplete.ts` + `settings/preset/autocomplete.ts` do `const kind = (interaction.options.getString('kind', false) ?? 'text') as ConfigKind`. Safe TODAY: Discord restricts the value to the choice set (`CONFIG_KINDS`) and the autocomplete error handler returns `[]` on anything unexpected — no security hole. Adding a guard now would be premature defensiveness for an input that can't occur. **Fix shape**: `const raw = …getString('kind', false) ?? 'text'; const kind: ConfigKind = CONFIG_KINDS.includes(raw as ConfigKind) ? (raw as ConfigKind) : 'text';`. **Promote when**: `kind` is read in a NON-autocomplete context (e.g. a deferred handler) where Discord's choice-set guarantee doesn't hold. Surfaced 2026-06-28 by PR #1380 (S2c) claude-review (non-blocking, reviewer self-qualified as "if/when used in a non-autocomplete context").
<!-- SECTION:DESCRIPTION:END -->
