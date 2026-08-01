---
id: TASK-377
title: isInsideCodeSpan does not model Markdown double-backtick spans
status: Done
assignee: []
created_date: '2026-07-31 04:11'
updated_date: '2026-08-01 17:31'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 377000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by #1880 final review. isInsideCodeSpan (packages/common-types/src/utils/codeSpanDetection.ts) treats each backtick as an inline toggle, so a double-backtick span - Markdown's form for code containing a literal backtick - toggles twice and nets out to "not code". A quoted control-delimiter inside such a span is therefore NOT recognised as quoted.

Why it is worth filing rather than shrugging at: the DIRECTION is wrong. The docstring already records a fence simplification (any triple backtick toggles state, not just a line-anchored one) and argues it is tolerable because it fails toward PRESERVING content - an over-eager fence makes callers decline to extract. This one fails the other way: an unrecognised code span makes callers extract, which is the data-loss direction the whole utility exists to prevent.

Why it is low priority anyway: the trigger requires a model to quote a control delimiter AND need a literal backtick inside the same span. Not seen, and not a shape this product produces.

Fix shape if taken: follow CommonMark and treat RUNS of backticks as delimiters - a run of N backticks opens a span that only a matching run of N closes. That subsumes the single-backtick case rather than special-casing, and would also let the fence branch fall out of the same rule instead of being a separate check.

Member of the same family as TASK-373 (audit every parse site for quoted control syntax); do it there if that sweep rewrites this utility anyway.
<!-- SECTION:DESCRIPTION:END -->
