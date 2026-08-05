---
id: TASK-198
title: Decide whether CI jobs beyond unit-tests+lint become required status checks
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:voice'
  - 'area:ci'
  - 'origin:review'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 198000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Decide whether CI jobs beyond unit-tests+lint become required status checks

**Why:** `.github/rulesets/branch-protection.json` requires only `test` and `lint`; `mutation-tests`, `component-integration-tests`, `voice-engine-tests`, and `build` rely on the merge-discipline gate (`00-critical.md` all-green-complete-read + the pr-merge-review-check hook) rather than GitHub-level enforcement. Consistent with current practice, but a plain-UI merge would not be blocked by those jobs failing. **Fix shape**: policy decision — either add the full job set to `required_status_checks` (belt-and-suspenders; costs nothing given all-green is already the standard) or explicitly document the two-tier intent in the ruleset file. **Promote when**: next touching branch protection, or if a red non-required check ever slips through a merge. Surfaced 2026-07-03 (PR #1463 review, informational).
<!-- SECTION:DESCRIPTION:END -->
