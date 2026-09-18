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
Acceptance: the elision fixture is unstripped, every existing stripQuotedSpans and hasFirstPerson assertion unchanged, ai-worker lint green.
<!-- SECTION:DESCRIPTION:END -->
