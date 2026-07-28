---
id: doc-34
title: >-
  Idea: Inline `reply_to=` on `<chat_log>` messages — dissolve
  `<contextual_references>` for in-window targets
type: other
created_date: '2026-07-28 11:11'
---

## Inline `reply_to=` on `<chat_log>` messages — dissolve `<contextual_references>` for in-window targets

**Problem**: the system prompt renders reply-targets in a SEPARATE `<contextual_references>` section as `<quote>` stubs. When a user replies to a message already in `<chat_log>`, the target is deduplicated to a marker-only/preview stub — but the separate section is the structural root of the self-reply continuation risk: a quote of the bot's own prior line, detached from its timeline position, reads as a fragment to continue. PR #1317 mitigated this (role attribute on quotes, marker-only bot stubs, an anti-continuation output-constraint), but the cause remains — a reply-target in history is rendered twice (once in its timeline, once as an isolated quote).

**Action** (Kimi-K2.7 "ideal architecture", council 2026-06-23): tag the reply inline in `<chat_log>` — add a `reply_to="<messageId>"` attribute to the replying `<message>`, leaving the target in its original timeline position with its own `role`. Drop `<contextual_references>` entirely for targets already in the history window; keep a compact `<contextual_references>` only for OUT-OF-WINDOW targets (resolved links to old messages). Eliminates the duplicate-rendering + self-quote-continuation risk at the source.

**Why icebox**: cross-cutting prompt-architecture change (touches the history serializer, the reference enrichment/dedup pipeline, and the `<chat_log>` message shape) — wants its own design + council pass + careful snapshot review. The #1317 mitigations make it non-urgent. **ABSORBED 2026-07-05** by [`docs/proposals/backlog/prompt-assembly-architecture.md`](../../docs/proposals/backlog/prompt-assembly-architecture.md) §2.4 — adapted to the real-messages shape (`<chat_log>` dissolves): in-window targets get a one-line inline pointer in the replying message; `<contextual_references>` survives only for out-of-window targets, in the volatile user-message tail. Ships with that design's Phase 2. Entry retained as requirement record until then. Surfaced 2026-06-23 (council on the self-reply confusion fix).

#### ✨ Safety watcher model (adversarial background monitor)

Ingested 2026-07-05 (notes-Discord cleanup; owner note predates the design boulders). A lightweight "watcher" model lurking with an adversarial prompt, looking for signs of user delusion or risky parasocial dynamics in conversations; on suspicion, injects a corrective steer into the main model's next prompt. Owner's own recorded caveats: false positives would poison UX; a free watcher model is itself error-prone. Related surface: the memory design's eval harness could host offline evaluation of watcher prompts before any live wiring. **Promote when**: before the project "graduates" from beta (owner's stated gate) — a pre-GA safety workstream, not a feature.

#### ✨ Guild-shared BYOK pool / server API-key sharing

Ingested 2026-07-05 (notes-Discord cleanup; originates from a real user question — "the model I chose with my API key isn't working for everyone"). Let a user volunteer their API key for use by others in a specific server (quota-capped, revocable, usage-visible). Security-sensitive: spend attribution, abuse limits, revocation UX. Demand evidence also strengthens the config-cascade design's deferred guild-preset trigger (server-wide model defaults). **Promote when**: a second real ask, or alongside the guild-preset phase of `config-cascade-semantics.md`.

#### ✨ Persona avatar vision summary (auto-refreshed)

Ingested 2026-07-05 (notes-Discord cleanup). New persona field storing a vision-model summary of the user's profile picture so characters can "see" who they're talking to; recompute only on avatar change (Discord avatar hash is exposed on the user object — key off it, no checksumming needed). Small, self-contained; vision cost is one call per avatar change. **Promote when**: post memory Phase 1 (participants section is where it would render).

#### ✨ Top-probability (logprobs) display

Ingested 2026-07-05 (notes-Discord cleanup). Expose token top-probabilities in `/inspect` for the curious-power-user tier. OpenRouter logprobs support is provider-dependent; display shape unclear (per-token UI doesn't fit Discord well). Smallest honest version: logprobs of the FIRST token or a perplexity-style aggregate in the inspect Config view. **Promote when**: someone actually asks, or an inspect overhaul touches the area.

