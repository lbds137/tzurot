---
id: TASK-392
title: >-
  contextual_references is rendered twice per request — system prompt AND user
  message
status: To Do
assignee: []
created_date: '2026-08-01 18:05'
labels:
  - 'size:M'
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 392000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Runtime-confirmed 2026-08-01** from a prod /inspect capture (req `456ec221-120e-4822-bcc3-c12e08c2ea78`, Lilith, glm-5.2).

**Observed**: the `<contextual_references>` block is **byte-identical in both assembled messages** — 7,713 chars in the system message and the same 7,713 chars in the user message. It accounted for 7,713 of the user message total 9,405 chars (82%). At this request size that is roughly **1,900 tokens duplicated**, on every request that carries references.

The same two media payloads therefore ship twice: a 1,713-char image description (Owl House embed thumbnail) and a 1,421-char voice transcript.

**Confirmed in code — one flow, two renders.** `ContentBudgetManager.buildBaseComponents` passes the SAME string to both:
- `promptBuilder.buildHumanMessage(..., { referencedMessagesDescriptions })` which appends it to the USER message (`PromptBuilder.ts` around line 157)
- `promptBuilder.buildFullSystemPrompt({ referencedMessagesFormatted: referencedMessagesDescriptions })` which renders it as system section 5 (`PromptBuilder.ts` around line 286)

Both return values are sent. `ContentBudgetManager` lines 284 and 351 are the two hand-offs.

**This is NOT an accounting bug.** The budget counts both copies, which is why the estimate tracked the billed number to 0.4 percent (47,613 vs 47,820). The duplication is real, correctly measured spend.

**Distinct from TASK-387**, which is about one description appearing in both `<contextual_references>` and `<chat_log>` WITHIN the system prompt. This is the whole block duplicated across the two MESSAGES. Same family, different instance.

**Open question before fixing — is it deliberate?** No rationale was found in code or docs. The system-prompt slot has a documented section-ordering argument (the Sandwich Method comment on buildFullSystemPrompt); the user-message append carries only a comment about escaping ORDER, not about why it exists. A recency-bias argument for keeping references adjacent to the user turn is plausible and would be a legitimate reason to keep both. **Owner call**, since it affects prompt behaviour and not just cost.

**Acceptance**: either one render site, or a comment at both sites stating why two are intended.

## ANSWERED 2026-08-01 — absorbed by doc-17; do NOT fix standalone

The open question above (is the dual placement deliberate?) is already settled, and in the
direction that is NOT obvious: **keep the USER-MESSAGE copy, delete the SYSTEM-PROMPT one.**

Source: `docs/proposals/backlog/prompt-assembly-architecture.md` §2.2, the design ACCEPTED
2026-07-05 (council trio + fact-check) under theme doc-17 (Provider Prompt Caching). Verbatim:
_"The references duplication dies here: `<contextual_references>` lives ONLY in the user message,
and ONLY for out-of-window targets."_

**Why that direction.** The system message is the cacheable prefix. Anything volatile in it
breaks prefix caching for everything after it, and references change every turn. §2.1 puts
references in the V tier, which §2.2 renders inside the final user message. Deleting the
user-message copy — the intuitive read, and the one this task originally leaned toward — would
be exactly backwards: it would keep volatile content in the prefix.

**§2.4 goes further**: references should carry only OUT-OF-WINDOW targets. An in-window reply
gets a one-line pointer, because the full text is already in the history array.

**Disposition: do not fix this as a standalone dedup.** It falls out of doc-17's Phase-1 V-tier
hoist (measured 2026-08-01: 10,341 tokens of volatile content to move, of which this is 1,866).
A standalone fix would either duplicate that work or do it backwards. This task stays open as
the tracked instance of the waste, and closes when Phase 1 lands.

The measurement that sizes it, plus the corrected phase sequencing, is recorded in doc-17.
<!-- SECTION:DESCRIPTION:END -->
