---
id: TASK-390
title: Release-PR claude-review posts nothing past ~2x the diff size that works
status: To Do
assignee: []
created_date: '2026-08-01 16:35'
labels:
  - 'size:M'
dependencies: []
priority: high
ordinal: 390000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Found 2026-08-01 investigating release PR #1891 (v3.0.0-beta.189).**

claude-review went green twice, ran ~3.5 min each time, and posted NOTHING. Raw
API confirms zero claude[bot] output on every surface (issue comments, review
comments, formal reviews) — only codecov commented.

**Measured, diff size as returned by `gh pr diff` (the prompt tells the reviewer
to call it):**

| PR | bytes | reviewed? |
| --- | --- | --- |
| #1891 v3.0.0-beta.189 | 673,129 | NO |
| #1874 v3.0.0-beta.187 | 314,882 | yes |
| #1865 v3.0.0-beta.186 | 266,947 | yes |
| #1879 v3.0.0-beta.188 | 159,651 | yes |

#1891 is 2.1x the largest diff that has ever produced a review, and the split is
clean at n=4. File COUNT is not the discriminator — #1865 had 135 changed files
versus #1891's 125 and reviewed fine.

**NOT confirmed, and cannot be from logs as configured.** The action prints
"Running Claude Code via SDK (full output hidden for security)", so the agent's
tool calls and reasoning are suppressed. Confirming the mechanism needs
`show_full_output: true` on the workflow. Treat the size correlation as a strong
predictive hypothesis, not a diagnosis.

**Ruled out**: the workflow-validation skip (a skip is a ~15s no-op; these ran
3.5 min and the guard reports the claude workflow files in sync with main); the
workflow `permissions: read` block (the action mints its own app-installation
token, visible as the /installation/token cleanup call, and posts fine on
smaller PRs under the same permissions).

**Fix shape, which holds regardless of the mechanism:** a release PR diff is BY
CONSTRUCTION already-reviewed code. Asking the reviewer to re-read all eleven
constituent PRs line by line is simultaneously the largest possible prompt and
the least valuable review. The holistic pass should look at what is genuinely
new at release time — the version bump, whether the release notes match the tag
range, and cross-PR seams — rather than re-reading merged diffs. A base-branch
conditional in the prompt would do it.

**Constraint on the fix**: `.github/workflows/claude-code-review.yml` is
self-validating, so the change MUST go through a main-cut PR. A develop-first
change silently disables claude-review on every PR until the next release.

**Impact**: every release large enough loses its holistic second look — the one
review that sees the release as a unit. Silent failure: the check is green.

**Acceptance**: a release PR of #1891's size receives a posted review, or the
workflow states in the job output why it declined.
<!-- SECTION:DESCRIPTION:END -->
