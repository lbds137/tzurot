---
id: TASK-368
title: Load-bearing invariants live in docstrings where nothing executes them
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 368000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by TASK-364. Kimi K3's framing: "Every invariant currently living in a docstring or code comment is an unfiled bug report."**

Three instances found in ONE investigation, all in the reference/vision path:

1. `persistReferenceDescriptions`'s docstring states its purpose is to stop a quoted image rendering as "a bare `[image/type: name]` marker on replay" — it names the EXACT symptom of TASK-364. It was wired to one of two consumers. The invariant was known, written in prose, and unenforced.
2. The deduped stub renders `[Referenced message — full text in the chat log]`. That is a factual claim about another renderer's output, asserted in a string literal, never verified. It is FALSE for images — the chat-log copy carries bare `<embed><image url>` with no descriptions.
3. `buildDedupedReferenceStub`'s comment explains WHY markers are prepended and text capped, but nothing enforces that the field list stays complete.

**The class:** a comment that describes a cross-module contract is a test that never runs. Where a docstring asserts "X carries this so Y need not", that claim should be executable — GLM 5.2's concrete proposal: derive the deduped path's legitimate exclusion set from what the chat-log renderer ACTUALLY produces for the same message (`stubFields must contain fullFields minus logFields`), so the premise is checked rather than asserted.

**Action:** sweep the reference/prompt-assembly modules for docstrings making cross-module carriage claims; for each, either add an executable assertion or downgrade the wording so it stops reading as a guarantee. Not a broad doc audit — scoped to claims of the form "the other renderer/layer carries this."

## CONCRETE INSTANCE 2026-07-30 (#1877 final review) — the inverse case

#1877 shipped on the premise "the chat-log copy of a referenced message renders
its image as a URL, never a description, so the deduped stub must carry the
description." That premise is TRUE for the motivating case (a never-triggered
message someone replied to) and **FALSE for one case**: when the referenced
message was ITSELF a prior trigger message with attachments, its own history
entry already renders `<image_descriptions>` via `formatImageSection` — so the
stub now renders the same description a second time.

Token redundancy, not a correctness regression, and the erring direction is
deliberate: duplicating a description costs the model reading it twice, while
omitting it is the bug #1877 exists to fix. But it is exactly the shape this task
names — a cross-module carriage claim asserted in prose, true in the common case,
silently wrong in a case nobody enumerated.

**This is the concrete payoff for GLM 5.2's proposal above.** Deriving the stub's
exclusion set from what the chat-log renderer ACTUALLY produced for that message
resolves both directions at once: descriptions ride along when history lacks
them, and are excluded when history already carries them. Neither the current
unconditional-carry nor the previous unconditional-drop can be right, because the
correct answer depends on the other renderer's output — which is precisely why it
must be derived rather than asserted.

**Acceptance addition:** a deduped stub of a message whose own history entry
already renders `<image_descriptions>` must NOT repeat them.

## SCOPE WIDENED — owner 2026-07-30: _"we need to be broader in our surface audit to catch any other similar bug classes"_

Three instances surfaced in a single day, and the third does not fit the
original framing:

1. `persistReferenceDescriptions`'s docstring names the exact symptom of
   TASK-364 — cross-module carriage claim, the original scope.
2. The deduped stub's `[Referenced message — full text in the chat log]` marker —
   a factual claim about another renderer's output, asserted in a string literal.
3. **`buildReasoningView` (TASK-371)** — a docstring recording an explicit owner
   decision (_"reading text must never require a file download"_) contradicted by
   `maxChunks: 3` **thirty lines below it, in the same function**.

**So the sweep is NOT only cross-module carriage claims.** Widen to any
load-bearing claim that nothing executes, including:

- a docstring contradicted by its OWN function body (instance 3 — the cheapest
  to find and the easiest to have missed, because there is no module boundary to
  make anyone suspicious);
- a **recorded owner/design decision** in prose, which a later change can
  override without anyone noticing — instance 3 arrived that way (`00fb239ca`
  had a coherent rationale and simply did not know the decision existed);
- string literals making factual claims about what some other layer produced
  (instance 2).

**Method note**: enumerate deterministically rather than by reading around.
Candidate greps — `owner decision`, `always`, `never`, `must`, `guaranteed`,
`so X need not`, `is in the chat log` — across `services/**` and `packages/**`
docstrings and string literals, then judge each hit for whether anything
executes it. Sampling is what let three coexist.

**Sibling audit, different class**: TASK-372's failure (content that QUOTES our
own control syntax is indistinguishable from real control syntax) is not an
unenforced-invariant problem and should not be folded in here — it has its own
sweep.
<!-- SECTION:DESCRIPTION:END -->
