# shapes.inc — state of the competitor (researched 2026-07-09)

_Open-source research (official docs/blog, press, community archives); [V] = verified against a primary source, [I] = inferred from secondary discussion. Full sourcing in the session that produced this; key links inline._

## Headline: they are gone from Discord, and not coming back

- **[V] Discord mass-terminated shapes.inc and ~100k of its user-hosted bots on 2025-05-01.** Cited violations: improper bot-token handling, unauthorized use of message content for AI training, failure to honor data-deletion requests, inadequate child-safety moderation. Shapes disputed; community investigation supported Discord's account.
- **[V] Pivoted to a standalone "multiplayer AI" group-chat app** (web/iOS/Android, humans + AIs in shared chats). Re-emerged 2026-04-29 with an $8M Lightspeed-led seed; 400k+ MAU (Mar 2026), 6× growth since January ([TechCrunch](https://techcrunch.com/2026/04/29/meet-shapes-the-app-bringing-humans-and-ai-into-the-same-group-chats/)).
- **[V] Their OpenAI-compatible persona API launched ~Apr 2025 and was discontinued Sept 2025**; repo archived June 2026. Developer-facing persona APIs were not where their traction was. **Tzurot history note (owner)**: that API is why Tzurot v1/v2 existed — v1/v2 were built on it, and its shutdown is what birthed v3 as a fully independent stack.
- **Implication: the Discord field is more open, not empty.** The #1 Discord persona platform was ejected and did not return — but successors exist: **Verba.ink**, **Aurinfer Labs**, and likely others (owner-known, 2026-07; not yet researched). Their ban reasons are our compliance checklist: token handling, no training on message content, data-deletion compliance, child-safety moderation. A follow-up competitive pass on the successor bots would be worth its own research session.

## Memory system (current, per [docs.shapes.inc/memory](https://docs.shapes.inc/memory))

- **[V] Two tiers**: STM (active chat) / LTM (persistent). User verbs: `/wack` (clear STM), `/sleep` (force STM→LTM consolidation), `/reset` (erase LTM per context).
- **[V] User-editable memories are table stakes**: per-shape "Memories" page to view/edit/delete generated summaries; per-message deletion from memory. (Validates tzurot's correction slice.)
- **[V] Memory scope is a USER choice**: per-chat isolated vs "Global Memory" shared across chats — privacy-vs-continuity explained to users in those terms. (Maps to tzurot Phase 3 pool/scoping.)
- **[V] "Total Recall" agentic memory skill**: conversational BROWSE (semantic search over memories), SUMMARY, explicit CREATE, HISTORY. Their post-2024 edge is _conversational_ memory management, beyond dashboard CRUD.

## Prompt/model knobs (the sidecar question)

- **[V] Both historical knobs survived the rebuild and grew**: completion-side custom prompts ("Presets" + per-chat "Custom Chat Instructions" + per-user name/pronoun preferences), AND the memory-side prompt — now "**LTM Engine Instructions**" with a separate "**LTM Engine Model**" selector (a distinct model choice just for memory generation).
- **Implication**: a per-personality memory-engine _model_ knob is the market bar (aligns with tzurot's planned `EXTRACTION_MODEL` work). Their memory _instructions_ are shape-owner-level free-form text over summary-shaped generation — tzurot's structured extraction (JSON contract, supersession indexes, eval-gated prompt) argues against free-form prompt editing; a bounded "extraction preferences" slot is the parity move if demand appears.
- **[V] No BYOK anywhere** (checked absence). Monetization: credits + earn-free rewards; per-shape premium subscriptions ($15/mo era) are **paused**. Free tier always available; frontier models metered by credits.

## Caveats

- shapes.inc mass-publishes AI-generated SEO/fandom pages on its own domain with fabricated timelines — treat `shapes.inc/fandom/*` as non-factual.
- Live engine roster (shapes.inc/engines) and current credit pricing were unverifiable without an account (403).
