---
id: TASK-295
title: 'release:publish right after the release merge races the prod deploy window'
status: Done
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-07-29 16:09'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 295000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (beta.169 publish) — `release:publish` immediately after the release merge races the prod deploy window: all three beta.169 release webhooks (published/created/released) got **502 at Railway's edge** during the container handoff (GitHub's delivery log confirms; GitHub never retries), and the DM blast arrived via the :41 hourly reconcile sweep instead (10-min lag; recipients=1, worked exactly as designed). **Decide + document**: either (a) note in the git-workflow skill's publish step that the immediate-publish race is known-benign and the DM may lag ≤1h via reconcile, or (b) have `release:publish` (or the skill) wait for the prod gateway deploy to settle before creating the release for an immediate DM. (a) is zero-code; (b) is nicer UX for the announce. Skill edits are review-gated — batch with the next skill/tooling touch. **Promote when**: next release-flow touch, or if a future release's DM lag causes real confusion.

**Why:** The reconcile absorbed it perfectly — this is documentation of a benign race, not a bug fix.
<!-- SECTION:DESCRIPTION:END -->
