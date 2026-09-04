---
id: TASK-807
title: >-
  GitGuardian false-positives on model-id test fixtures — recurring manual
  dismissals
status: To Do
assignee: []
created_date: '2026-08-29 00:04'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 807000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GitGuardian flagged the fixture string qwen/qwen3.5-397b-a17b (ModelCapabilityChecker.test.ts) as a Generic High Entropy Secret; the owner had to dismiss incident 36656085 by hand (2026-08-27, "I hate how fucking stupid it is about test credentials"). The fixture deliberately stays a real model id (probe-fixtures-from-real-corpus rule), so the same FP recurs on future scans of that file and siblings.

What: a .gitguardian.yaml exists at repo root — evaluate adding a paths-ignore entry for *.test.ts fixtures (or a secret-type exclusion scoped to test files) so model-id strings stop paging the owner. Verify the ignore actually suppresses dashboard incidents, not just CLI scans, before calling it done.

Acceptance: the next scan of a test file carrying a model-id string raises no incident, or the approach is ruled out with the reason recorded and the recurring-dismissal cost accepted explicitly.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): REWRITTEN AROUND THE CONFIRMED FINDING. .gitguardian.yaml has excluded **/*.test.ts since 0ce9091e2 (2026-01-05), eight months before the 2026-08-27 incident that still fired on a .test.ts file. Local path exclusion does not suppress GitGuardian dashboard incidents; the fix is on the dashboard/policy side, not the config file.
---
<!-- COMMENTS:END -->
