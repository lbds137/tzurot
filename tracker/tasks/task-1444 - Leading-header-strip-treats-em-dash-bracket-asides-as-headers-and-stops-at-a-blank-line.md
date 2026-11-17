---
id: TASK-1444
title: >-
  Leading-header strip treats em-dash bracket asides as headers and stops at a
  blank line
status: To Do
assignee: []
created_date: '2026-11-17T21:02:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1444000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2761 pre-push review. leadingHeaderLineMatcher (services/ai-worker/src/services/context/RealMessagesBuilder.ts:281) matches any whole-line bracket with an em-dash, so a reply that is only an in-character aside like [smiles — warmly] is stripped as a header (and, since #2761, makes the regurgitated-turn blank guard skip the cut, leaving the echo in place; before #2761 the same input produced an empty reply). Separately the matchers anchor at ^[ \t]* and do not skip blank lines, so in [Bob — t1]\nx\n\n[Lila — t2]\n\n[Bob — t3] a stray [Bob — t3] survives both the guard and the strip.

What: tighten the header shape to the real header form (name, em-dash, timestamp) or skip blank lines between stacked headers, keeping the guard and the strip on one definition (stripLeadingHeaderLines in responseArtifacts.ts).

Acceptance: cases for both inputs in responseArtifacts.test.ts; an aside-only reply survives; the stray header is stripped.
<!-- SECTION:DESCRIPTION:END -->
