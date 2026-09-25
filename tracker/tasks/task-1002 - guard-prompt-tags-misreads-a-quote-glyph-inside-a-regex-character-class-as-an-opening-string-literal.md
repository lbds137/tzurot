---
id: TASK-1002
title: >-
  guard:prompt-tags misreads a quote glyph inside a regex character class as an
  opening string literal
status: Done
assignee: []
created_date: '2026-09-17 22:05'
updated_date: '2026-09-25 18:29'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 998000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the guard string-literal scanner is a quote-pairing regex, not a tokenizer. A straight or curly quote inside a /[...]/ character class reads as an opening string that then hunts for a close quote through unrelated code below, and the guard reports a phantom structural tag. Measured cost: the recent-days digest validator (services/ai-worker/src/services/recentDaysDigest/recentDaysDigestValidation.ts) had to build its punctuation class from String.fromCharCode codes to keep the guard quiet, with a comment explaining the workaround. Any future file with a quote in a character class hits the same wall.
Fix shape: in packages/tooling/src/dev/check-prompt-tags.ts, make the literal scanner skip regex literals (or strip them before quote pairing) - the same class of fix a real tokenizer gives; then revert the digest validator to a plain character class and confirm the guard stays green. Add a fixture with a quote inside a character class to the guard test as the canary.
<!-- SECTION:DESCRIPTION:END -->
