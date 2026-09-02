---
id: TASK-869
title: >-
  pr-body-ref-gate KNOWN GAPS: three undocumented parser edges from the round-6
  review
status: To Do
assignee: []
created_date: '2026-09-02 16:40'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 869000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the PR-body claim scan (rule 2 of pr-body-ref-gate.sh) landed after six review rounds; the sixth surfaced three parser edges that are real but undocumented, and the review-response cap stops in-context iteration there. None blocks a real PR: each is a fail-open miss, not an over-block.

Fix shape: three KNOWN GAPS bullets in the hook header, plus a probe case where one is cheap. (1) A whole-token-quoted field, -f or -F or --field followed by a quoted body=... token, puts the quote before body= so the required-flag check never matches and the command passes both rules unscanned; the canonical gh style quotes only the value. (2) A host without sha256sum (stock macOS) never runs rule 2 at all, since the availability guard fails open on every call; say so where the guard is. (3) A shell-variable PR number in the PATCH path (pulls/$N) defeats the digit-anchored pulls/N detector, so a scripted edit is unscanned. Optionally narrow pre-filter #1 so body= does not substring-match words like nobody=; pre-filter #2 already rejects those before the jq fork, so this is cost, not correctness.

Acceptance: the three bullets are in the header; the probe stays green; the review that filed these (PR 2302 round 6) is cited in the commit.
<!-- SECTION:DESCRIPTION:END -->
