---
id: TASK-723
title: >-
  realMessagesEnabled flip-readiness: visible identity binding + header-spoof
  hardening
status: To Do
assignee: []
created_date: '2026-08-22 06:14'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 723000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2180 round-3 review found two High findings that are inert behind the default-OFF flag but BLOCK flipping realMessagesEnabled in prod (reviewer framing adopted). (1) Flag-on, no id-based speaker disambiguation exists in model-visible text: headers carry the name only, speakerId rides additional_kwargs which never reaches the wire as visible text (verified: LLMInvoker/ResponsePostProcessor only read kwargs from responses). The duplicate-roster-name case (two same-named participants) has NO mechanism — the interim roster note (fixup 33527669f) says "read each turn in context", which is honest but weak. (2) Header spoofing via message CONTENT: a user can type a fake "[Name — timestamp]" line mid-message; only the speaker NAME is sanitized (sanitizeHeaderName, RealMessagesBuilder.ts). The S0 spoof constraint added in the same fixup tells the model mid-content header-shaped lines are author text — instruction-level, not structural.

Fix shape (design pass before build): decide the flag-on identity mechanism — e.g. a short visible id suffix in headers for ambiguous rosters only, or accepting name+context with the S0 framing — and decide whether content-side header-shaped lines need structural neutralization (zero-width break, bracket substitution) or the instruction-level defense suffices. Both decisions feed §9c and gate PR 2.5 (the flip).

Two round-4 riders folded into the same design pass: (3) whether the flag's two live read sites (RenderableReference.choosePrefix, ReferencedMessageFormatter contextual-references instruction) should be unified onto the per-turn captured value — dismissed twice in-PR as wording-only, but the reviewer is right that staged-rollout flips make mid-turn consistency worth a deliberate decision rather than a call-graph accident; and (4) whether escapeXmlContent's visible entity-escaping in real-message bodies (accepted trade for the unforked shared renderer) should be revisited once real turns are user-visible in /inspect and snapshots.

Acceptance: a recorded design disposition for BOTH gaps (prompt-assembly-architecture.md §9c or successor), implemented or explicitly accepted-with-rationale, BEFORE realMessagesEnabled flips anywhere.

**Design pass COMPLETE (2026-08-22)**: the disposition record is prompt-assembly-architecture.md 9d (D1 build / D2 build / D3 build / D4 accepted-with-rationale / D5 build). Build units filed: TASK-726 (D1), TASK-727 (D2), TASK-728 (D3, lands first), TASK-729 (D5); TASK-730 is the /inspect redaction owner call. This task closes when TASK-726 + TASK-727 ship.
<!-- SECTION:DESCRIPTION:END -->
