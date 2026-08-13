---
id: TASK-581
title: >-
  truncateForSelect cuts mid-surrogate — the class #2083 fixed, in the browse
  module
status: To Do
assignee: []
created_date: '2026-08-13 00:18'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 581000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: truncateForSelect (services/bot-client/src/utils/browse/truncation.ts:51) truncates with processedText.substring(0, maxLength - 3), the same UTF-16 slice that motivated the code-point-safe echoableNeedle in #2083. An astral character (emoji, CJK) straddling the cut is split, and Discord renders the lone surrogate as a replacement glyph. Reaches every browse select-menu label and description, and truncateForDescription delegates to it.

Why not fixed in #2083: not a naive swap. A code-point slice keeps maxLength code POINTS, but Discords select-label ceiling is enforced in UTF-16 units, so cutting by code point can OVERSHOOT the API limit and turn a cosmetic glyph bug into a hard 50035. The fix has to cut on a code-point boundary while still respecting a UTF-16 budget - a different mechanism from the tag-surface fix, in a utility every browse surface depends on.

Fix shape: keep the UTF-16 budget, back the cut off to the nearest code-point boundary (never forward). Reuse or generalize truncateByCodePoints (utils/modal/toolkit.ts) only if its budget semantics can be reconciled; its docstring currently scopes it to editable prefill, not display text.

Acceptance: an astral-character fixture at the cut boundary produces no lone surrogate AND stays within the UTF-16 ceiling; canary it. Source: 2026-08-12 claude-review on #2083 (Low, origin-scoped, given a merits deferral on mechanism).
<!-- SECTION:DESCRIPTION:END -->
