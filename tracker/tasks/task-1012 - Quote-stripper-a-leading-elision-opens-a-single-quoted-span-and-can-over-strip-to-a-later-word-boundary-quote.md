---
id: TASK-1012
title: >-
  Quote stripper: a leading elision opens a single-quoted span and can
  over-strip to a later word-boundary quote
status: To Do
assignee: []
created_date: '2026-09-18 12:19'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1008000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after PR #2449 the shared stripQuotedSpans (services/ai-worker/src/services/archiveSummary/archiveSummaryValidation.ts) treats any straight single quote at the start of text or after whitespace, an opening bracket, or a dash as a span opener. A leading elision such as til, Tis, or em written with an apostrophe satisfies that condition, so the body then runs to the next quote sitting at a closer boundary; if one exists later in the digest (a plural possessive, a real closing quote), the text between is stripped and a first-person leak inside it would be hidden. Rare in a third-person digest, and no dry run has shown it; flagged by the round-2 review of #2449 and declined there because the fix is an elision word list inside the regex.
Fix shape: either exclude a known-elision set after the opener (til, tis, em, cause, n) via a negative lookahead, or require the character after the opener to be followed by a closer-boundary quote within N characters; add a test that the elision sentence is left unstripped and a real leak after it still flags; keep the no-super-linear-move lint rule green.
Scope widened at the #2449 round-3 review: the CURLY form has the same exposure with no boundary check at all (a typographic left single quotation mark before an elision, as in rock n roll set with curly marks), so the fix covers both opener forms. Two coverage fixtures ride along: a single-quoted span at the very start of the text (the caret branch of the straight opener) and the closer set exercised through comma, semicolon, colon, and a closing bracket, not only a dash, space, or period.
Acceptance: the elision fixture is unstripped in both quote styles, the two coverage fixtures pass, every existing stripQuotedSpans and hasFirstPerson assertion unchanged, ai-worker lint green.
<!-- SECTION:DESCRIPTION:END -->
