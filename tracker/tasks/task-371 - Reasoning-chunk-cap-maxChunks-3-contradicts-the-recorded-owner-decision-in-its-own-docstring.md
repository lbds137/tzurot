---
id: TASK-371
title: >-
  Reasoning chunk cap (maxChunks: 3) contradicts the recorded owner decision in
  its own docstring
status: To Do
assignee: []
created_date: '2026-07-31 01:17'
labels:
  - 'area:bot-client'
dependencies: []
priority: medium
ordinal: 371000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30** by the owner hitting it in prod: _"aw man we're not showing the full thinking output. I guess there's a cap on chunks?"_

`buildReasoningView` (`services/bot-client/src/commands/inspect/views.ts:208`) opens with a docstring recording an explicit owner decision:

> "Reasoning content, always inline — chunked across ephemeral messages when long (**owner decision: reading text must never require a file download**)."

…and ~30 lines later sets `maxChunks: 3` with `overflowFilename: 'reasoning-full.txt'`, which does exactly what that decision forbids. The two intents sit in the same function and contradict each other.

**Provenance**: the cap arrived with `00fb239ca` (UX epic PR-8b), which capped Reasoning, Input, AND Post-Processing at 3 inline chunks each. Its rationale is coherent on its own terms ("the COMPLETE content as a text file, so the reader never stitches messages") — it simply overrode a recorded decision already written above it, and nobody noticed because nothing executes a docstring.

**Observed**: glm-5.2 at `effort=medium` produced ~10k of reasoning. At ~1900 usable chars/chunk that is ~6 chunks against a cap of 3, so half rendered inline and the rest arrived as `reasoning-full.txt` (9.75 KB). Nothing is LOST — the overflow tail carries complete, self-contained content — but the reading experience is the one the owner ruled out.

**Fix shape (owner picks the number)**: raise the reasoning cap rather than remove it. Unbounded means a pathological 50k dump becomes ~26 ephemeral messages; ~10 chunks (~19k inline) honors the decision for every realistic reasoning size while keeping the attachment as a genuine-outlier path. Whatever lands, **fix the docstring so it describes what the code does** — a stale invariant claim is what produced this.

**Also decide**: Input and Post-Processing share the `maxChunks: 3` cap. Input carries the full user message plus referenced-message content and can run long too.

**Class**: same as TASK-368 — a load-bearing invariant living in prose where nothing executes it, contradicted by code in the same file. Third instance found on 2026-07-30. Worth adding to 368's sweep scope: the sweep should catch a docstring contradicted by its OWN function body, not only cross-module carriage claims.
<!-- SECTION:DESCRIPTION:END -->
