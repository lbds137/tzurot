---
id: TASK-297
title: 'narrowed extractSubmission catch, shared truncateByCodePoints across all four prefill…'
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 297000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-19 (#1711 r2 + #1713/#1714 reviews; items a–c SHIPPED in #1714 — narrowed extractSubmission catch, shared `truncateByCodePoints` across all four prefill sites, toolkit type split) — remaining modal-toolkit item, one trigger: (d) **non-text validation + submission-path convergence** — `validateSubmission` covers text only, AND the live submission path still reads through `extractModalValues`' blanket `catch {}` (the narrowed catch protects a path with zero production callers; safe today because every live field is text-kind, whose only throwable is the skippable field-not-found). When the first non-text field consumer lands: extend per-kind validation AND converge submission-reading onto `extractSubmission` (retiring `extractModalValues`' catch-all) in the same slice. **Promote when**: first non-text modal field consumer.

**Why:** Two implementations of one operation with different hardening levels is a temporary state — the first real non-text consumer is the forcing function.
<!-- SECTION:DESCRIPTION:END -->
