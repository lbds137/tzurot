---
id: TASK-445
title: Decide the disposition of three orphaned .github/rulesets JSON variants
status: Done
assignee: []
created_date: '2026-08-06 14:03'
updated_date: '2026-08-06 14:37'
labels:
  - 'area:docs'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: low
ordinal: 445000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
branch-protection-no-bypass.json, branch-protection-no-checks.json, and solo-developer-minimal.json are leftover import variants from the 2025 repo setup. All three describe a combined main+develop ruleset that was never applied anywhere.

Why it matters: they are now actively hazardous, not merely stale. Importing any would create a THIRD ruleset overlapping the two live ones. The no-bypass variant in particular would strip the develop admin bypass, which is what lets sanctioned direct doc-commits push without a PR — so importing it silently breaks that workflow.

Nothing references them: the rewritten README file table lists only the two live snapshots, so a future reader browsing the directory has no way to learn these are landmines.

Fix shape: delete all three (git preserves them). Owner call because it is a deletion.

Acceptance: either the three files are gone, or the README gains a note saying what they are and why they must not be imported.
<!-- SECTION:DESCRIPTION:END -->
