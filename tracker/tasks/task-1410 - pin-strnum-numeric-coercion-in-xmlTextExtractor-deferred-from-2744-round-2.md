---
id: TASK-1410
title: >-
  Pin strnum numeric coercion of bare tag values in xmlTextExtractor
  (deferred from PR #2744 round 2)
status: To Do
assignee: []
created_date: '2026-11-12T19:39:13Z'
labels:
  - area:ai-worker
  - size:S
  - state:observable
dependencies: []
priority: low
ordinal: 1400000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2744's round-2 review flagged that numeric coercion of bare tag values in `extractXmlTextContent` is unpinned: `parseTagValue` defaults true, so numeric-looking text coerces through strnum (fast-xml-parser's number helper, which moved 2.4.2 → 2.5.1 in the #2744 bump) and `collectTextValues` `String()`s it back. The existing suite never feeds a bare numeric tag value, so a strnum coercion change would land silently. Deferred at review time rather than applied: every implement lane sat at its start gate (lane-meters --for implement, 11-12: agy gemini 99%, agy 3p 99%, z.ai week 81% vs gate 75, anthropic 93% vs gate 75; the API credit held to the 11-18 grant) and the dispatch-posture gate blocks the 15-line inline edit.

What: one test in `services/ai-worker/src/utils/xmlTextExtractor.test.ts` pinning the shipped coercion, so a future strnum/fast-xml-parser move reddens here instead of landing silently.

Acceptance: this exact test (probe-verified against the installed fast-xml-parser 5.12.0 / strnum 2.5.1 with the extractor's own options — `ignoreAttributes: true, trimValues: true`; `parseTagValue` unset) passes after insertion into the existing `describe`, and `pnpm --filter @tzurot/ai-worker test --run src/utils/xmlTextExtractor.test.ts` reports 12 passed:

```ts
it('pins numeric coercion of bare tag values (guards the strnum ride-along bump)', () => {
  // parseTagValue defaults true, so numeric-looking text coerces through strnum
  // and collectTextValues String()s it back; this pins the shipped coercion
  // (observed against fast-xml-parser 5.12.0) so a future coercion change reddens here.
  const xml =
    '<root><a>007</a><b>1e3</b><c>0x1A</c><d>123abc</d><e>9007199254740993</e></root>';
  const result = extractXmlTextContent(xml);
  expect(result).toBe('7\n1000\n26\n123abc\n9007199254740993');
});
```

Observed arms: leading zeros strip (007→7), exponent coerces (1e3→1000), hex coerces (0x1A→26), mixed alphanumerics stay strings (123abc), beyond-MAX_SAFE_INTEGER stays a string.

Promote when: an implement lane reopens (z.ai below its 75 start-gate after the Wed 11-18 reset, or agy under its gates) — fold into beta.244, where the ride-along guard belongs anyway.
<!-- SECTION:DESCRIPTION:END -->
