---
id: TASK-971
title: >-
  memory:summarize sweep report breaks down dead rows by error class but not
  failed rows
status: To Do
assignee: []
created_date: '2026-09-13 22:45'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 967000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: read on prod 2026-09-13 while checking the Emily pre-warm gate. The sweep report prints "Dead rows by error class" (25 rows, all no_template) but gives failed rows only as a bare count (73). Emily gate reads 85.8% of 95% NOT READY, and those 73 failures are exactly what stands between the gate and READY — 599 done + 73 failed + 25 dead + 1 never attempted = 698 in window. With 25 rows terminally dead the ceiling is 96.4%, so the gate is reachable ONLY if nearly every failed row clears, and the report cannot say what they failed on. A rollout gate that stalls with no diagnosable reason is the shape that turns a per-character flip into guesswork.
Fix shape: mirror the existing dead-row breakdown for failed rows — the same GROUP BY over summary_last_error, filtered to summary_status = failed instead of dead. The dead-row query already exists in the sweep (packages/tooling/src/memory/summarize-sweep.ts; its test at summarize-sweep.test.ts:333 pins the dead-class rendering shape), so this is the sibling query plus a second report section. Keep the existing dead section unchanged and assert both in the test.
Acceptance: the sweep report prints failed rows grouped by error class alongside the dead-row breakdown; a test pins both sections; the Emily gate read becomes diagnosable without a manual SQL query.
<!-- SECTION:DESCRIPTION:END -->
