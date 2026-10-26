---
id: TASK-1278
title: >-
  vite advisories open on default branch: 1 high + 2 medium - classify, ride
  fixes into beta.239
status: Done
assignee: []
created_date: '2026-10-24 16:08'
updated_date: '2026-10-26 04:27'
labels:
  - 'area:deps'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1266000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
gh dependabot alerts 180/181/182, all vite@npm: 181 HIGH CVE-2026-112942, 180 medium CVE-2026-112943, 182 medium CVE-2026-112944. Surfaced by the push banner on 10-24, previously untracked (tracker and doc search: no vite advisory entries). Acceptance: classify each via pnpm ops security:advisories (direct / transitive / direct+transitive); ride every one with a fixed version into the beta.239 release preflight via pnpm.overrides (rules 05-tooling Security Advisories), or record a written reason per advisory without one.
<!-- SECTION:DESCRIPTION:END -->
