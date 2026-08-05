---
id: TASK-276
title: User-message envelope assembly is convoluted (owner-flagged)
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 276000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

User-message envelope assembly is convoluted (owner-flagged) — Owner reviewed a debug export 2026-07-15: a 3-char user message ships with (a) the `<contextual_references>` block DUPLICATED verbatim in system prompt AND user message (~200 wasted tokens per reply-shaped message), (b) a quote stub whose only payload is "go find it in the chat log" — indirection the chat log already provides, (c) two speaker-encoding idioms in one prompt (`<message from=…>` in history vs bare `<from>` tag + loose text for the current message — the inconsistency the output-constraints scaffolding-ban then pays for). Same class as the vision-injection row above. **Fix shape**: belongs to the prompt-assembly-architecture implementation (accepted boulder artifact) — dedupe the instruction block to system-prompt-only, drop or enrich the stub, unify the speaker encoding; regression-check against REASONING_MODEL_FORMATS quirks (GLM/Kimi scaffolding-echo class). **Promote when**: prompt-assembly implementation phase starts, or the next assembler touch. Surfaced 2026-07-15 (owner prompt-export review).

**Why:** Models cope with messy envelopes; tokens, retrieval, and maintenance surface pay the real bill.
<!-- SECTION:DESCRIPTION:END -->
