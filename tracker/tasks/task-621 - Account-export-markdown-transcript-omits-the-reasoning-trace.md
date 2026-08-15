---
id: TASK-621
title: Account-export markdown transcript omits the reasoning trace
status: To Do
assignee: []
created_date: '2026-08-15 17:16'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 621000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: AccountExportMarkdown.ts renders row.content only and never row.thinkingContent, while the module docblock enumerates its Deliberate exclusions (secrets, embeddings, binaries, usage logs) without listing this one. So the omission reads as an oversight rather than a decision.

NOT a data-rights gap, which is why this is medium and not high: AccountExportAssembler.ts queries conversationHistory with no select, so thinkingContent IS present in the raw JSON export under conversations/. The user has the data. What is missing is the trace in the friendlier artifact, the human-readable transcript, which is the one most people will actually open.

Surfaced by review of PR 2105, the PR that added the column. Deliberately not fixed there: the export module is outside that PR scope and the choice is a product call about transcript shape, not a defect in the persistence work.

Fix shape: pick one and make it explicit. Either render the trace under its assistant turn (indented or in a collapsible block so it does not swamp the conversation), or add it to the docblock exclusion list with the reason. Rendering is the better default since the user can already read the same trace via /inspect and View Reasoning, so excluding it from their own export is the inconsistent option.

Acceptance: the transcript either shows the trace or the docblock names it as an exclusion; whichever is chosen, the docblock and the code agree.
<!-- SECTION:DESCRIPTION:END -->
