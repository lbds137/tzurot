---
id: TASK-1327
title: 'GUILD deny-edit modal UX: hide scope inputs or label the constraint'
status: To Do
assignee: []
created_date: '2026-10-29T22:13:00Z'
labels:
  - area:bot-client
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1310000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: round-4 review on PR #2687 (optional finding): both modal fields are pre-filled, so the type-aware GUILD placeholders only show after the user clears a field; validation is the real guard. Cleaner shapes: put the constraint in the field labels, or omit the Scope and Scope ID inputs for GUILD entries entirely and always submit BOT with * (only one valid value — nothing to edit).
Owner question: should the GUILD deny-edit modal hide the scope inputs (always BOT/*) or carry the constraint in labels?
Recommendation: omit the inputs — with exactly one valid value there is nothing for the user to edit, and the guard stays as backstop.
<!-- SECTION:DESCRIPTION:END -->
