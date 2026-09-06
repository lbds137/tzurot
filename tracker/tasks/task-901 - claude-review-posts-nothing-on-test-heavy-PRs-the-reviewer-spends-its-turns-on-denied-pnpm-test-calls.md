---
id: TASK-901
title: >-
  claude-review posts nothing on test-heavy PRs: the reviewer spends its turns
  on denied pnpm test calls
status: To Do
assignee: []
created_date: '2026-09-06 04:31'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 899000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on #2349 (a 30-file tooling PR with ~3,300 tests) the claude-review job completed four times in a row without posting a comment (permission_denials_count 8, 10, 12, then a debug attempt), so the check stayed red on a valid PR. A mention-triggered review of the same commits reported that its pnpm test calls were rejected as requiring approval; the review workflow allowlist is gh-only, so a reviewer that decides to run tests burns its turns on denials and never reaches gh pr comment. The failure shape is invisible from the streamed log (the action hides the SDK stream even in debug mode).
Fix shape: in .github/workflows/claude-code-review.yml either add a prompt line telling the reviewer that tests are CI-verified and it must not run them, or allow Bash(pnpm --filter * test:*) so the calls succeed. Both are workflow-sync changes and must land via a main-cut branch (guard:workflow-sync). Verify by rerunning the review on a PR that previously went silent.
Acceptance: a PR of that shape gets a posted review on the first run; the Verify a review was posted step passes.
<!-- SECTION:DESCRIPTION:END -->

Second data point: #2350 (a 62-file runtime PR, five review rounds) — the review job completed without posting on three of its six runs; each rerun posted. The posted-review guard step now fails the job explicitly, so the silent case is at least visible.
