---
id: TASK-329
title: Review-response riders get less scrutiny than planned work
status: Done
assignee: []
created_date: '2026-07-26 00:00'
updated_date: '2026-07-29 16:09'
labels:
  - 'area:process'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 329000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-26 (#1795 six-round review, self-observed) — **review-response RIDERS get less scrutiny than planned work, and it shows in the finding ledger.** Across #1795's rounds, 3 of 4 findings were additions I made in response to an EARLIER finding: `recordPurgeFailure` (written + unit-tested + never called), the `personality_owners` reach arm (added in round 1, untested until round 3 caught it), and a schema doc comment I staled by changing behaviour in a file I wasn't editing. #1796 repeated the shape — the mutation gate caught an extracted module at 52% because extraction moved code out from under a file average. Each was described as small ("one clause", "~10 lines"), and small is exactly the size that skips the does-this-need-a-test / is-the-doc-still-true check a planned change gets. **Fix shape**: a short rider checklist in `/tzurot-review-response` rule 3 (apply step) — when the fix ADDS code rather than changing it, ask the three questions a planned change answers: (a) does it need its own test, (b) does it stale a comment/doc elsewhere (incl. `schema.prisma`), (c) does moving code between files change what a coverage/mutation gate measures. Rule 3 already gates on the test suite; this is the authoring-time complement. **Promote when**: the next review-response cycle that runs past 3 rounds, or the next mutation/coverage gate failure traced to a review rider.

**Why:** Self-observed pattern with a 4-instance evidence base in one session; the procedure exists and already owns the apply step, so this is a checklist addition rather than new machinery.
<!-- SECTION:DESCRIPTION:END -->
