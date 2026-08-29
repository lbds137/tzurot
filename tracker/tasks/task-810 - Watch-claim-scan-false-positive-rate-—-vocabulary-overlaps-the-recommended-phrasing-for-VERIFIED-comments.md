---
id: TASK-810
title: >-
  Watch: claim-scan false-positive rate — vocabulary overlaps the recommended
  phrasing for VERIFIED comments
status: To Do
assignee: []
created_date: '2026-08-29 01:43'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 810000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the merge-gate added-comment claim scan (pr-merge-review-check.sh, shipped with the mining-operationalizations PR) fires on always/never/cannot/guaranteed — the same vocabulary 02-code-standards § "A Comment That Asserts Behavior Is a Claim" recommends for comments that ARE pinned by tests. Review prediction: the banner may fire on a large fraction of comment-bearing PRs (this repo hooks are full of NEVER/ALWAYS prose), risking cries-wolf skimming. Cost is one banner paragraph, never a block.

What: after a few weeks of real merges, judge whether the scan earns its keep — count roughly how often the banner fired vs how often it surfaced a genuinely unverified claim. If noise dominates: tune (e.g. require the claim vocabulary to co-occur with provenance/count shapes, or exempt lines that name a test), do not remove without owner call. If tuning happens, ALSO add the deferred probe case pinning claim-scan + origin-scan co-rendering in one call (round-4 review, Low) — both blocks in one stderr output.

Acceptance: a disposition recorded (earning its keep as-is / tuned with the co-render probe case added / escalated to owner).
<!-- SECTION:DESCRIPTION:END -->
