---
id: TASK-636
title: 'Dedupe the model footer: hyperlink rides the arrow target, model named once'
status: To Do
assignee: []
created_date: '2026-08-17 01:16'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 636000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the guest-mode substitution footer (#2118) made the footer visibly long - the resolved model renders twice (leading hyperlink + right side of the fallback arrow). Owner-proposed shape (2026-08-16, screenshot in session): move the hyperlink onto the arrow-right resolved model and drop the duplicate leading mention, e.g. "Model: z-ai/glm-5 -> [glm-4.5-air](url) (guest mode) - via Z.AI Coding Plan". No-fallback case renders "Model: [glm-4.5-air](url)" unchanged.

Fix shape: footer builder in bot-client - locate the model-line renderer, restructure so the hyperlink wraps the RESOLVED model wherever it sits (arrow target when a chain exists, sole mention otherwise). Keep guest-mode/via/pin segments as-is.

Acceptance: with a fallback chain the resolved model appears exactly once (hyperlinked, right of the arrow); without a chain the footer is unchanged; snapshot tests updated.
<!-- SECTION:DESCRIPTION:END -->
