---
id: TASK-1006
title: 'Recent-days digest: a billed validator rejection logs nothing per pair'
status: To Do
assignee: []
created_date: '2026-09-18 01:40'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1002000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on the first dev tick with the switch on (2026-09-18 01:36Z) the owner pair (409 rows, ~42k input tokens) was rejected twice as first_person and the only trace was the sweep summary line failedBilled=1. The class lives on the row (last_error) and had to be read with a DB query; the validator detail is the constant string "first-person pronoun detected", so even the row cannot say WHICH token tripped it. Sibling of TASK-971 (the sweep report gives failures as a bare count).
Fix shape: in recentDaysDigestSweep.ts, after a billed failure write (the recordDigestFailure path, ~:170-190, verify), emit ONE logger.warn with { personaId, personalityId, cls, detail, attempts, status } and no content; in recentDaysDigestValidation.ts make the first_person detail carry the matched pronoun token (hasFirstPerson returns a boolean today — add a sibling that returns the match, or re-run the same regex in validateDigest), and the quotation detail the n-gram length and position, never the text. The token is a pronoun, not message content, so the no-raw-log-content rule is satisfied. Pin with a sweep unit test asserting the warn fields on a validator rejection and a validation test asserting the token in detail.
Acceptance: a billed rejection on dev produces one warn line naming the pair, the class, and the token, readable via pnpm ops logs --filter digest without a DB read.
<!-- SECTION:DESCRIPTION:END -->
