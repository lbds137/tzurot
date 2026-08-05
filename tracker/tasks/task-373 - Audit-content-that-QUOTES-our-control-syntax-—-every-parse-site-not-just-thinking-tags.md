---
id: TASK-373
title: >-
  Audit: content that QUOTES our control syntax — every parse site, not just
  thinking tags
status: Done
assignee: []
created_date: '2026-07-31 01:23'
updated_date: '2026-08-05 22:33'
labels:
  - 'area:ai-worker'
  - 'size:M'
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

## SWEEP RUN 2026-08-01 — the enumeration, and the rule that bounds it

**The finding that shrinks the rest of this task: escaping preserves, extraction
deletes — and only destructive sites need this discriminator.** `escapeXmlContent`
turns a quoted `</character>` into `&lt;/character&gt;`, which the model reads as
the literal text: the example survives, rendered inert, and a false positive
costs nothing. A destructive site cannot recover. So `promptSanitizer`,
`xmlBuilder`, and every other escaping path are out of scope ON PRINCIPLE rather
than one at a time — which answers the "verify rather than assume, and note WHY
it is safe" item in the site list above. Do not re-audit them per-tag.

Parse sites over model output, enumerated (not sampled):

| Site | Verdict |
| --- | --- |
| `thinkingExtraction.ts` | gated (#1880) |
| `responseArtifacts.ts` | gated (#1889) |
| `promptSanitizer` / `xmlBuilder` | escaping — structurally immune, see rule above |
| `extractJsonPayload` | not this class: unwraps a fence we asked for, on a JSON response, not prose |

**`responseArtifacts.ts` result, and the method worth copying.** A 5-family ×
2-quoting-shape table was written, then the gate was DISABLED and the table
re-run. Only the prompt-template-closing-tag family went red — it is the only
unanchored, global pattern in the file. The other four are protected by their
own `^`/`$` anchors, because a leading or trailing backtick already means no
match, so their rows pass with the gate off and are NOT gate coverage. They are
kept and relabelled as pinning the ANCHOR, so a later "make this catch
mid-response too" edit turns them red exactly when the gate becomes load-bearing
there. **Run the table against a disabled gate before believing it** — a
quoted-syntax table looks like coverage whether or not the site was ever
exposed.

Confirms result #2 above from a second site: the discriminator is per-site, and
here the answer was code markup for one pattern and the existing anchor for the
rest.

**Perf caveat discharged for this site**: `isInsideCodeSpan`'s scan-from-zero is
irrelevant over a single reply with few candidates. It remains open for
`promptSanitizer` — which the rule above now says we never need to wire it into,
so the caveat is likely moot rather than pending.

**Still open**: the `<action>`-tag leak handler (now.md Untriaged) is a FUTURE
parse site and must be designed against this class rather than retrofitted.

## THE UNFENCED-QUOTE GAP IS PERMANENT — resolved 2026-08-01, do not re-derive

TASK-375's evidence sweep came back the opposite way from the hoped-for answer,
and it closes an option this task was holding open.

The cheap structural answer on the table was: retire `extractOrphanClosingTag`,
and the unfenced-quote ambiguity disappears by construction, because it only
exists to serve that path. **That is now ruled out on runtime evidence.** A
10-deployment prod sweep (36,094 lines, 374 generations) found the path firing 6
times, every one from `glm-4.5-air` — an in-rotation free-tier model, not the
retired Kimi K2.5 the docstring credited — recovering reasoning bodies of
1256-2098 chars, three of them followed by healthy visible output.

So the path stays, and therefore so does its ambiguity: an UNFENCED mid-prose
`</think>` ("it just prints </think> before answering") is still consumed, and
no discriminator separates it from the real emission, because both are mid-line
mid-text prose with no code markup and no position signal. Recorded in
`extractOrphanClosingTag`'s docstring as a permanent known limit.

**Do not spend another design pass on a cleverer discriminator for this gap.**
The two candidates are already evidence-rejected: the proportion guard (result 1
above) and retirement-by-construction (here). What remains is the observability
answer — if a user ever reports it, the reply's text is recoverable from the
diagnostic log.

**Ridden in the same PR** (both members of this task, both now Done): TASK-377
gave `isInsideCodeSpan` run-based backtick delimiters, closing the
double-backtick gap noted in result 3 — which mattered more than its "not seen"
priority suggested, since the sweep shows the discriminator is load-bearing on a
live path rather than defensive. TASK-388 made `replaceOutsideCodeMarkup` the
single definition, discharging this task's reuse ownership.
<!-- SECTION:DESCRIPTION:END -->
