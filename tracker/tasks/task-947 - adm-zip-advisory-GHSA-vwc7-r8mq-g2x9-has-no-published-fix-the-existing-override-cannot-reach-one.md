---
id: TASK-947
title: >-
  adm-zip advisory GHSA-vwc7-r8mq-g2x9 has no published fix; the existing
  override cannot reach one
status: To Do
assignee: []
created_date: '2026-09-12 21:07'
labels:
  - 'area:deps'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 945000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm ops security:advisories reports GHSA-vwc7-r8mq-g2x9 (medium, adm-zip, extraction follows destination symlinks and allows arbitrary file overwrite) as transitive with no fix published. Verified 2026-09-12: pnpm why -r adm-zip resolves a single copy, adm-zip 0.6.0, reached through onnxruntime-node from both @tzurot/ai-worker and @tzurot/embeddings, so it sits in the prod dependency tree rather than a dev-only branch. The vulnerable range is >= 0.5.9 through 0.6.0, and pnpm-lock.yaml already carries an override pinning adm-zip below 0.6.0 up into the >=0.6.0 <0.7.0 range from an earlier advisory in the same package. The new range extends through exactly the version that override targets, so there is nothing to bump to today and Dependabot will never open a PR for it.
Fix shape: nothing to do until upstream publishes a fixed release. When one lands, widen the existing pnpm.overrides entry to reach it and confirm the advisory clears. An onnxruntime-node release that drops the adm-zip dependency closes it equally well.
Promote when: a fixed adm-zip release exists, or a release preflight shows the advisory carrying a fix.
Acceptance: pnpm ops security:advisories reports no open adm-zip advisory.
<!-- SECTION:DESCRIPTION:END -->
