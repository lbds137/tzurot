---
id: TASK-456
title: >-
  Canonical monitor invocation should embed $(git rev-parse HEAD), not a SHA
  placeholder
status: To Do
assignee: []
created_date: '2026-08-07 02:26'
updated_date: '2026-08-07 02:26'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: high
ordinal: 455000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The three surfaces show the monitor command with a SHA PLACEHOLDER (<full-40-char-sha> / $SHA), so arming a monitor requires transcribing a real SHA into it. That transcription failed FOUR times in one session on 2026-08-06: two abbreviated SHAs (which return total_count 0 and read as "keep waiting"), and two fabricated ones where the short SHA from a git commit line was completed with invented characters. All four are well-formed enough to pass a naive check and all four spin silently to the timeout.

PR 1992 added a local git cat-file existence check to gh:ci-gate, which turns a fabricated SHA into an instant error. That is a good backstop but it is still a backstop: it catches the mistake after it is made, and it only protects the ops-CLI form, not the bash form still used on branches whose base predates the gate.

The fix that removes the opportunity: make the canonical invocation on all three surfaces literally read --sha $(git rev-parse HEAD). Copying it verbatim is then correct by construction and there is nothing to transcribe. Verified working: a Monitor command with command substitution evaluates correctly at arm time.

Blocker to handle: guard:monitor-command normalizes the SHA with the regex --sha \S+, and $(git rev-parse HEAD) contains spaces, so the three copies would no longer normalize to equal strings. Fix the normalizer at the same time — since --sha is the last token on the line in every copy, normalizing --sha .*$ to a placeholder is both simpler and correct.

Acceptance: the rule, the skill, and the hook heredoc all show --sha $(git rev-parse HEAD); guard:monitor-command still passes; a monitor armed by copying the canonical line verbatim watches the right SHA.
<!-- SECTION:DESCRIPTION:END -->
