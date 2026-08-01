---
id: TASK-388
title: >-
  Extract the code-markup-gated replace so thinkingExtraction stops indexing
  offsets positionally
status: To Do
assignee: []
created_date: '2026-08-01 14:02'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 388000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced by #1889's review.** TASK-373 owns the isInsideCodeSpan reuse, so this is a member of it.

`responseArtifacts.replaceOutsideCodeMarkup` finds the replace offset BY TYPE — `args.find(a => typeof a === "number")` — because `String.replace` passes exactly one number to a replacer and everything else is string/undefined/object. That is immune to any future capture group, named or not.

`thinkingExtraction.ts` has ~4 inline instances of the same "skip matches inside code markup" shape written positionally, e.g. `(match: string, _tagName: string, offset: number)`.

**Correction to the review's framing, which called it "the exact fragility":** the two are different fragilities and only one is what my docstring described.
- BACK-indexed (`args[args.length - 2]`, what #1889 removed) breaks when a pattern gains a NAMED group, because `groups` is appended last.
- FRONT-indexed (thinkingExtraction today) is unaffected by a named group — those append at the end — but breaks when a pattern gains an EXTRA CAPTURE GROUP, which shifts `offset` rightward.

Both are "correct only for the patterns that exist today". Find-by-type is immune to both. So the suggestion stands; the reason needed restating.

**Not currently broken.** thinkingExtraction's signatures are typed and correct for its present patterns. This is hardening, not a bug fix — which is why it was not ridden into #1889.

**Why not done in #1889:** it touches the highest-consequence parse file in the system (the one that ate user text in prod, #1880) on a PR about a different file. That change deserves its own review surface.

**Fix shape:** extract to a shared helper — `codeSpanDetection.ts` in common-types is the natural home since it already owns `isInsideCodeSpan` — then adopt it at thinkingExtraction's call sites. Keep the existing table-driven KNOWN_THINKING_TAGS guard green; it is the regression net.

**Acceptance:** one definition of "replace outside code markup" in the codebase; no positional offset indexing at any isInsideCodeSpan call site; thinkingExtraction's tag-x-quoting-shape table still passes unchanged.

**Also noted in the same review:** `responseArtifacts.ts` is at 385/400 max-lines. The next pattern or helper added there forces a split — and moving this helper out buys some of that back.
<!-- SECTION:DESCRIPTION:END -->
