---
id: TASK-257
title: Retire the admin-runtime-settings artifact into reference docs
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:docs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 257000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Retire the admin-runtime-settings artifact into reference docs — All four phasing rows shipped (#1605/#1616/#1617/#1618). Per the doc lifecycle rule, a completed proposal is verified-then-deleted — but this artifact holds the registry criteria, D4 SWR contract, D12 category semantics, and the council record. **Fix shape**: distill the durable pieces (settings registry how-to, floor semantics, descent category table) into `docs/reference/` (likely `features/` or `architecture/`), then delete the proposal; keep the config-cascade cross-links intact (`guard:proposal-links` must stay green). **Promote when**: after the operational tail closes (Railway cleanup done + dev walk passed) — the artifact is still the live runbook until then. Surfaced 2026-07-13 (epic completion).

**Why:** Doc-lifecycle hygiene; artifact is the only home of several contracts.
<!-- SECTION:DESCRIPTION:END -->
