---
id: TASK-1456
title: cpd:check reads a stale jscpd report with no staleness guard
status: To Do
assignee: []
created_date: '2026-11-18T20:01:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1456000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
pnpm ops cpd:check and cpd:filtered read reports/jscpd/jscpd-report.json written by the last pnpm cpd run (JSCPD_REPORT_PATH in packages/tooling/src/cpd/postFilter.ts) and never check whether that report reflects the current tree. A bare cpd:check after src edits re-judges a stale scan: observed 2026-11-18 when an implementer worker ran cpd:check after eliminating a clone pair and got the pre-edit red verdict (1813 over ceiling 1809), costing a full re-dispatch and nearly a second one; a fresh pnpm cpd immediately showed 1799, green. Fix options: cpd:check detects a report older than the newest tracked ts file and warns or rescans; at minimum a docs line in the 02-code-standards CPD section stating the ordering. Acceptance: a bare cpd:check after an edit that eliminates a clone cannot report the stale pre-edit number.
<!-- SECTION:DESCRIPTION:END -->
