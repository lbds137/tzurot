---
id: TASK-372
title: >-
  PROD: quoted <thinking> tag mid-response truncates the visible reply and
  inflates reasoning
status: Done
assignee: []
created_date: '2026-07-31 01:19'
updated_date: '2026-07-31 04:12'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 372000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**PROD BUG, runtime-confirmed 2026-07-30 21:14 (owner-reported, evidence in hand).** User-visible data loss: a character reply was cut off mid-sentence and ~4k of it was misfiled as reasoning.

**Trigger**: the model QUOTES a reasoning delimiter inside its visible response. Lila was discussing screenshots of Claude thinking blocks and wrote the literal text `` `<thinking>\nI am a\n???` `` as a quotation.

**Mechanism** (`services/ai-worker/src/utils/thinkingExtraction.ts`):
- `UNCLOSED_TAG_PATTERN = /<(TAG_ALT)>([\s\S]*)$/gi` matched the QUOTED opening tag and captured everything to end-of-string as thinking.
- `extractUnclosedTag` HAS a guard for this class — "if extraction would leave visible content empty, this is likely a model glitch … keep content visible" — but it only fires when `cleaned.trim().length === 0`. Here ~2/3 of the reply preceded the quoted tag, so `cleaned` was non-empty, the guard passed, and the remainder was consumed.
- **The guard catches an opening tag at position 0. It cannot catch one quoted mid-response.**

**Evidence**:
- Discord reply truncated exactly at the backtick preceding the quoted tag: _"…the entire user message was just the fragment `"_
- The reasoning attachment carries a `=== Additional Inline Reasoning ===` section that begins _"\nI am a\n???`. That's not a question. That's not a prompt…"_ — the exact continuation of the visible reply, ~4k of user-facing prose filed as reasoning.
- `View Reasoning (10.0k)` = ~6k genuine reasoning + ~4k misclassified response. The owner's read ("thinking block detection was tripped up, that's probably why it ended up so big") is correct.
- Model: glm-5.2, effort=medium.

**Not exotic for this product**: the bot hosts AI characters and users routinely discuss model internals. Any reply quoting `<think>`/`<thinking>`/any TAG_ALT member triggers it.

**Candidate fixes (pick with evidence, do not stack)**:
1. **Position heuristic** — genuine unclosed reasoning is a PREFIX phenomenon (the model opened a block and never closed it). Require the unclosed opening tag to appear at/near the start, or that no substantial visible prose precedes it. A quoted tag appears mid-text by definition. Probably the strongest single discriminator.
2. **Backtick/code-fence awareness** — do not treat a tag inside inline code or a fenced block as a delimiter. Narrower, and composes with (1).
3. Tighten the existing guard from "would leave visible content EMPTY" to "would consume more than N% of the response".

**Test to add regardless**: a response that quotes a reasoning delimiter mid-prose must survive intact — visible content unchanged, nothing moved into reasoning. Verify RED against current code first.

**Related**: GLM-family reasoning-tag vocabulary drifts per revision, so the TAG_ALT list will keep growing — which makes the false-positive surface grow with it. That argues for a structural discriminator (1) over enumerating more tags.
<!-- SECTION:DESCRIPTION:END -->
