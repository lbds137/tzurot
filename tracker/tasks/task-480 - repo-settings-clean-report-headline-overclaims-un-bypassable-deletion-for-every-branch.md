---
id: TASK-480
title: >-
  repo-settings clean-report headline overclaims un-bypassable deletion for
  every branch
status: Done
assignee: []
created_date: '2026-08-09 11:25'
updated_date: '2026-08-09 13:26'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 480000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: check-repo-settings.ts formatRepoSettingsReport (clean branch, ~line 513) prints "every long-lived branch carries an un-bypassable deletion rule", but the clean state is reachable with develop's deletion rule fully bypassable (auto-delete off + main clean = zero findings) — the repo's live state. The per-branch state line two rows below correctly says "deletion rule present but fully bypassable", contradicting the headline. Exit semantics unaffected; wrong claim reads as documentation (02-code-standards claim rule).
Fix shape: condition the headline on the derived branch states, or weaken to "no deletion-safety findings" and let the state lines speak. Pin with a test on the bypassable-develop clean fixture.
Surfaced by post-merge audit of #2001/#2022.
<!-- SECTION:DESCRIPTION:END -->
