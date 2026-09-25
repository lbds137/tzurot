---
id: TASK-1099
title: >-
  claude-review posts probe and fragment comments before its review body when
  the body carries backticks or arrows
status: To Do
assignee: []
created_date: '2026-09-25 08:03'
labels:
  - 'area:ci'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1092000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on PR #2531 (2026-09-25) claude[bot] posted ten comments in 90 seconds before the final review: three literal probes (a comment reading only "test comment with backtick code and apostrophe do not worry", one "Testing: SENSITIVE_PATTERNS regex is ...", one "Testing arrow: api%2Dkey -> decoded api-key -> redacted"), then the Verification, Findings, and Info sections as separate partial posts, then a complete body whose prose had every backtick and arrow rewritten out (grep the PR comments: the 07:59:34Z body says "includes apikey or includes api_key" where the 07:58:32Z fragment had the backticked form). The reviewer was evidently probing which characters its gh pr comment call could carry, and it kept retrying with re-worded text. The PR ends with ten noise comments, the pr-merge gate injects only the last one, and each probe is a billed turn on a review that had no findings.
Not the no-post class: TASK-390, TASK-213, and TASK-901 (Done or open) cover a review that posts NOTHING; this one posts too much. Related: the Verify-a-review-was-posted step in .github/workflows/claude-code-review.yml counts claude[bot] comments since the run start, so it is satisfied by the first probe.
Fix shape: (1) read the claude-review run log for PR #2531 (run 36110083850) to see which gh pr comment invocations were denied or errored and on what character; (2) if the action permission classifier or the allowed-tools pattern Bash(gh pr comment:*) rejects a body with backticks, `$(`, or unicode arrows, switch the review prompt to write the body to a file and post with --body-file, and say so in the prompt; (3) tell the prompt to post ONE comment, never probes, and have the Verify step warn (not fail) when more than two claude[bot] comments land in one run. Workflow edits to claude-code-review.yml land via a main-cut PR (05-tooling.md guard:workflow-sync).
Acceptance: the next three reviewed PRs each carry exactly one claude[bot] comment per review run, with backticked identifiers intact in the body.
<!-- SECTION:DESCRIPTION:END -->
