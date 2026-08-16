---
id: TASK-627
title: >-
  premigrate scan residuals: quoted-identifier case folding + ALTER COLUMN TYPE
  bound vs dollar-body semicolons
status: To Do
assignee: []
created_date: '2026-08-16 06:46'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 627000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two narrow fail-direction gaps in the premigrate destructive-shape scan, found by review after the comment-stripping walker landed. Both merit their own change round rather than riding that PR: one changes the exemption comparison for all migrations, the other needs a small design decision.

1. normalizeTableRef lowercases quoted identifiers, but Postgres quoted identifiers are case-sensitive - a migration creating "Foo" then destructively targeting a pre-existing "foo" would be wrongly exempted (fail-open). Unreachable via Prisma-generated migrations (always lowercase snake_case); live only for hand-written SQL with case-colliding names. Fix shape: fold case only for UNQUOTED refs; preserve case inside double quotes; red-proof with a "Foo"/"foo" pair.

2. The ALTER COLUMN TYPE pattern bounds its span with [^;]* - written when a statement could never contain a semicolon. Post-walker, a dollar-quoted body keeps its internal semicolons inside one statement, so dynamic ALTER COLUMN ... TYPE text straddling such a semicolon silently fails to match (false negative, against the over-warning-is-safe stance). Decide: drop the bound (accepting over-flag spans across dollar bodies) or scope it; then pin.

Acceptance: both gaps either closed with red-proofed tests or explicitly catalogued in the splitSqlStatements docstring residual list with fail-direction stated.
<!-- SECTION:DESCRIPTION:END -->
