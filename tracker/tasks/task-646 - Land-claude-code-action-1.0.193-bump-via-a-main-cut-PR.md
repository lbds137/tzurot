---
id: TASK-646
title: Land claude-code-action 1.0.193 bump via a main-cut PR
status: To Do
assignee: []
created_date: '2026-08-17 21:48'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 646000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2125 bumps anthropics/claude-code-action 1.0.187 to 1.0.193 inside BOTH self-validating workflow files (.github/workflows/claude-code-review.yml, claude.yml). Merging it to develop silently disables claude-review on every PR until the next release (guard:workflow-sync exists for exactly this, yet the PR own lint job passed -- so that green is NOT evidence of safety. The drift itself is verified directly: git diff --name-only origin/main FETCH_HEAD -- the two guarded files, which lists both. Why the guard stayed silent is NOT established; the leading hypothesis is its documented fail-open path (a shallow CI checkout makes merge-base throw, hitting the catch), but that was not confirmed against a CI log. Worth confirming when TASK-646 is executed, since a guard that cannot fire in CI is a second, larger finding.)

What: after beta.204 merges to main (main == develop at that point), cut a branch FROM main, apply only the two workflow-file hunks, PR against main, merge, then pnpm ops release:finalize. Close #2125 or let dependabot close it when the bump lands.

Acceptance: origin/main and origin/develop both carry claude-code-action 1.0.193 in both guarded files, and pnpm ops guard:workflow-sync passes on develop.

Procedure: tzurot-git-workflow skill, section Claude workflow changes target main.
<!-- SECTION:DESCRIPTION:END -->
