---
id: TASK-373
title: >-
  Audit: content that QUOTES our control syntax — every parse site, not just
  thinking tags
status: To Do
assignee: []
created_date: '2026-07-31 01:23'
labels:
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 373000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Owner-requested 2026-07-30**, generalizing from TASK-372: _"it sounds like we need to be broader in our surface audit to catch any other similar bug classes."_ Sibling to TASK-368 but a DIFFERENT class — 368 is unenforced prose invariants; this is control-syntax-vs-content confusion.

**The class**: anywhere we scan model output (or user input) for control syntax, a QUOTED or discussed instance of that syntax is indistinguishable from a real one. TASK-372 is the proven instance: a reply quoting `` `<thinking>` `` had everything after it eaten as reasoning, truncating the user-visible message. The trigger was ordinary — the conversation was ABOUT thinking blocks.

**Why it will recur**: this product hosts AI characters, so users and models discuss model internals routinely, and the tag vocabularies we scan for keep growing (GLM ships new reasoning-tag names per revision). The false-positive surface grows with every tag added.

**Sites to enumerate (deterministically — grep the parse sites, do not sample)**:
- `services/ai-worker/src/utils/thinkingExtraction.ts` — reasoning tags. TASK-372 covers the unclosed-tag path; check the OTHER paths too (orphan closing tag, the Pass-2 generic extractors) for the same quoted-syntax exposure.
- The Chain-of-Extractors generally — every extractor that pattern-matches on tag shapes.
- `promptSanitizer` PROTECTED_TAGS / `neutralizeWrapperClosingTags` — the escaping side. Different direction (we escape content so it cannot break OUT), so it may already be correct; verify rather than assume, and note WHY it is safe if it is, since that reasoning is exactly what 368 says should be executable.
- The `<action>`-tag leak item (now.md Untriaged) — its proposed generic unknown-wrapper handler would be a NEW parse site, so it must be designed against this class from the start rather than retrofitted.
- Anywhere else that regexes model output for angle-bracket or fence-delimited structure.

**Test shape (applies to every site found)**: feed content that QUOTES the delimiter mid-prose and assert the output is unchanged — nothing extracted, nothing truncated. Verify RED where the site is actually broken.

**Discriminators worth evaluating once, then applying consistently** (rather than per-site ad hoc): position heuristics (real control syntax is a prefix/suffix phenomenon; quoted syntax is mid-text), code-fence and inline-backtick awareness, and proportion guards (refuse an extraction that would consume most of the response).

## SCOPE UPDATE — what #1880 closed, and what it settled for the rest of the sweep

**Correction to an earlier version of this section.** It claimed
`thinkingExtraction.ts` was "done" while **Pass 2 — the primary extractor, for
complete `<tag>…</tag>` pairs — was still ungated**, in the same file. The claim
was written from the list of paths I had fixed rather than from the list of
paths that exist, which is the completion-overclaim failure `00-critical.md`
names. #1880's review caught it; the gap was runtime-confirmed (a reply
demonstrating the syntax lost its example entirely) and fixed before merge.

Recording it because the lesson generalises to this task: **enumerate the parse
sites in a file before declaring the file swept.** The reasoning that hid it was
also wrong in a specific, repeatable way — Pass 2 was scoped out on the grounds
that "a quoted complete pair is indistinguishable from a real one," which is
false for exactly the same reason it was false on the orphan path: a BACKTICKED
pair is distinguishable. Watch for that argument at the remaining sites; it is
seductive and it was wrong both times.

`thinkingExtraction.ts` is **now** done: the unclosed-tag path (position anchor),
the orphan-closing-tag path (code markup), Pass 2's complete pairs (code markup,
gated on both the collection and removal sides), `hasThinkingBlocks`, and the
`ORPHAN_CLOSING_TAG_CLEANUP` + `CHIMERA_ARTIFACT_PATTERN` erasure passes are all
gated — with a table-driven guard over `KNOWN_THINKING_TAGS` × quoting shape ×
{opening, closing, complete pair} so a new tag inherits coverage in all three
forms.

Three results that carry to every remaining site, so they are not re-derived:

1. **The proportion guard is evidence-rejected. Do not re-propose it.** The
   production reply had ~2/3 of its text before the quoted tag, so extraction
   consumed only ~1/3 — no threshold loose enough to spare genuine truncation
   would have fired.
2. **The discriminator is per-site by necessity, not by sloppiness.** Position
   works only where the real signal is a prefix/suffix phenomenon; where the
   real shape is mid-text (the Kimi K2.5 orphan tag), code markup is the ONLY
   separator. Expect to pick per site and justify the pick from that site's own
   observed real cases.
3. **`isInsideCodeSpan` exists** (`packages/common-types/src/utils/codeSpanDetection.ts`)
   — inline backticks + fenced blocks, single left-to-right scan. Reuse it;
   do not write a second one. Two known gaps, both documented at the source:
   fence detection is not line-anchored (fails toward preserving content, so
   tolerable), and double-backtick spans are not modelled (fails toward
   extracting — the wrong direction; TASK-377).

**Perf caveat, from #1880's round-2 review — a member of this task, since this
task owns the reuse.** `isInsideCodeSpan` re-scans from offset 0 on every call,
so a caller that invokes it once per candidate match is O(n·m). Irrelevant at
Discord reply lengths (low thousands of chars, few candidates), which is why
#1880 left it alone. It stops being irrelevant at the sites THIS task targets —
`promptSanitizer` runs over the full assembled prompt, not one reply. Before
wiring it into a whole-prompt path, either hoist the scan (compute code-span
ranges once per string and binary-search offsets) or confirm the call count is
bounded. Measure at the site; do not optimize blind.

**Check TASK-375 before designing a discriminator for the unfenced-quote gap.**
The remaining gap (an unfenced `</think>` mid-prose is still consumed) exists
ONLY to keep the Kimi K2.5 orphan path working. If that model is out of
rotation, deleting the path closes the gap by construction — a cheaper and more
honest answer than a cleverer heuristic.
<!-- SECTION:DESCRIPTION:END -->
