---
id: TASK-371
title: >-
  Reasoning chunk cap (maxChunks: 3) contradicts the recorded owner decision in
  its own docstring
status: Done
assignee: []
created_date: '2026-07-31 01:17'
updated_date: '2026-08-04 18:15'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 371000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30** by the owner hitting it in prod: _"aw man we're not showing the full thinking output. I guess there's a cap on chunks?"_

`buildReasoningView` (`services/bot-client/src/commands/inspect/views.ts:208`) opens with a docstring recording an explicit owner decision:

> "Reasoning content, always inline — chunked across ephemeral messages when long (**owner decision: reading text must never require a file download**)."

…and ~30 lines later sets `maxChunks: 3` with `overflowFilename: 'reasoning-full.txt'`, which does exactly what that decision forbids. The two intents sit in the same function and contradict each other.

**Provenance**: the cap arrived with `00fb239ca` (UX epic PR-8b), which capped Reasoning, Input, AND Post-Processing at 3 inline chunks each. Its rationale is coherent on its own terms ("the COMPLETE content as a text file, so the reader never stitches messages") — it simply overrode a recorded decision already written above it, and nobody noticed because nothing executes a docstring.

**Observed**: glm-5.2 at `effort=medium` produced ~10k of reasoning. At ~1900 usable chars/chunk that is ~6 chunks against a cap of 3, so half rendered inline and the rest arrived as `reasoning-full.txt` (9.75 KB). Nothing is LOST — the overflow tail carries complete, self-contained content — but the reading experience is the one the owner ruled out.

**Fix shape (owner picks the number)**: raise the reasoning cap rather than remove it. Unbounded means a pathological 50k dump becomes ~26 ephemeral messages; ~10 chunks (~19k inline) honors the decision for every realistic reasoning size while keeping the attachment as a genuine-outlier path. Whatever lands, **fix the docstring so it describes what the code does** — a stale invariant claim is what produced this.

**Also decide**: Input and Post-Processing share the `maxChunks: 3` cap. Input carries the full user message plus referenced-message content and can run long too.

**Class**: same as TASK-368 — a load-bearing invariant living in prose where nothing executes it, contradicted by code in the same file. Third instance found on 2026-07-30. Worth adding to 368's sweep scope: the sweep should catch a docstring contradicted by its OWN function body, not only cross-module carriage claims.

## OWNER DECISION 2026-07-30 — cap 10, scheduled AFTER the fast follow

_"10 is plenty. this was not really 6 chunks of reasoning, just a bug. so in practice I think it's unlikely we'll ever hit 10. it can come after the fast follow."_

**`maxChunks: 10`.** The sharpening matters and should survive into the build: the
observed 10k was **inflated by TASK-372** — roughly 4k of it was user-facing prose
misfiled as reasoning by the quoted-delimiter bug. Genuine reasoning at
`effort=medium` is materially smaller, so once 372 lands the cap may never bind
at all. That is the reason this is low-urgency rather than a reason to skip it:
the docstring/code contradiction still needs resolving either way, and a cap
that never fires is the correct end state, not evidence the work is pointless.

Ordering: **after the fast follow** (365 → 367 → 370 → 368). Do NOT ship the cap
change before 372 — measuring "is 10 enough?" against bug-inflated reasoning
sizes would calibrate against noise.

Still open at build time: whether Input and Post-Processing move to 10 as well,
or keep 3. Input carries the full user message plus referenced content, so it has
a real case; Post-Processing is a two-version diff and probably does not.
<!-- SECTION:DESCRIPTION:END -->
