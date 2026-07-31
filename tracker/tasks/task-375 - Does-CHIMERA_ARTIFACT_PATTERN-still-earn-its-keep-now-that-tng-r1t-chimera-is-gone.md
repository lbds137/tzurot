---
id: TASK-375
title: >-
  Does CHIMERA_ARTIFACT_PATTERN still earn its keep now that tng-r1t-chimera is
  gone?
status: To Do
assignee: []
created_date: '2026-07-31 02:17'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 375000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced during PR #1880 (quoted-control-syntax fix). The pattern in services/ai-worker/src/utils/thinkingExtraction.ts targets a stutter shape observed in the merged tng-r1t-chimera model. Owner note during that review: "the Chimera model is dead to me now that it is gone from the OpenRouter Free tier."

Why this is a question and not a deletion: the pattern runs on EVERY response, not only chimera ones, so its cost is model-independent even though its benefit is model-specific. #1880 confirmed a real false positive at runtime - a quoted `token. </tag>` fragment at the start of a line was eaten, leaving a dangling backtick and a mangled sentence - and gated it on isInsideCodeSpan. That closes the observed corruption; it does not answer whether the pass is still buying anything.

What to check before removing: whether any model currently in rotation emits the stutter shape (short token + period immediately before an orphan closing tag). Evidence source is prod logs plus the /inspect raw-content diagnostics, not reasoning about which models we think we run. 00-critical is explicit that "this seems unnecessary" is a reason to verify, not to delete, and the KEEP-list lesson applies: wired-in is not the same as live.

Outcome is one of: (a) remove the pattern and its three tests with the evidence recorded in the removing commit, or (b) keep it and note in its docstring which live model justifies it, so the next reader does not re-ask.

Note the shape of the risk if removed wrongly: the stutter leaks a garbage fragment into a user-visible reply. Cosmetic, recoverable, low blast radius - which is why this is worth resolving rather than carrying forever.

## WIDENED — the same question owns `extractOrphanClosingTag` (Kimi K2.5)

Surfaced by #1880's round-2 review, which flagged the remaining unfenced-quote
gap as "the most likely source of a future bug report": a reply saying
_"...and then it just prints `</think>` before answering"_ **without** backticks
still loses everything before the tag. #1880 pinned that as a KNOWN LIMIT
because no signal separates it from the real Kimi K2.5 shape (reasoning, then a
bare `</think>`, then the answer) — both are mid-line, mid-text prose.

But that framing assumes the Kimi K2.5 path still has to exist. It is the
**same lifecycle question as the chimera pattern, one model later**: a
model-specific extraction whose cost (eating a user's prose) is
model-independent. If nothing in rotation still emits a bare orphan closing tag,
retiring `extractOrphanClosingTag` **closes the unfenced-quote gap by
construction** — no discriminator needed, because the ambiguity only exists to
serve a path nobody needs.

So resolve both together, on the same evidence sweep:

- Does any live model emit the chimera stutter shape?
- Does any live model emit a bare orphan `</think>` with no opening tag?

Both answers come from prod logs + `/inspect` raw content, not from reasoning
about the model list. A "no" on the second is worth materially more than a "no"
on the first: it deletes an ambiguity this codebase currently cannot resolve.

Order note: this is the cheap structural answer to a gap TASK-373 would
otherwise try to solve with a cleverer discriminator. Check the lifecycle
question BEFORE designing one.
<!-- SECTION:DESCRIPTION:END -->
