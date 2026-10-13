---
id: doc-112
title: >-
  Idea: tzurot chat CLI - talk to characters from a terminal, and from Claude
  Code
type: other
created_date: '2026-10-13 04:02'
---

_Owner idea 2026-10-13, raised while thinking about the platform-portable UX epic (`doc-14`). Not scheduled; this doc records the idea and the grounding done when it was raised._

## The idea

A terminal client for talking to characters, invocable by the owner directly and by Claude Code (plain Bash, or wrapped as an MCP server).

## Where it fits

- **`doc-79` Phase 1** wants a "solo web fallback" to prove the job pipeline is platform-free. A CLI is a cheaper first client for the same proof: one user, fresh conversations, no browser.
- **`doc-14` Phase 4** (second renderer) is trigger-gated on a concrete second platform. A text-only CLI would be the first real consumer of the catalog/render split.
- **`doc-109` takes the opposite strategy**: Machloket speaks Discord's protocol, so bot-client runs unchanged. A CLI does not speak Discord. It calls the gateway directly, which is the `doc-79` path. Both strategies can coexist.

## Grounding (code-reading 2026-10-13, not runtime-verified)

- `POST /api/internal/ai/generate` (`services/api-gateway/src/routes/ai/generate.ts`) returns 202 and enqueues. `GET /api/internal/ai/job/:jobId` (`jobStatus.ts`) gives status, so a CLI can poll; the result path bot-client uses was not traced.
- The request context must be `kind: 'envelope'` and is Discord-shaped (channel/guild ids, chat_log). Conversation history is keyed by channel id, so a CLI needs a synthetic conversation key until `doc-79` Phase 2 lands neutral keys.
- Identity is the trusted `X-User-Id` header (`AuthMiddleware.ts`). An owner-only CLI holding the internal service secret works without new auth, but that secret is all-powerful. Anything beyond the owner's machine needs `doc-79` Phase 0 first.

## Payoffs beyond chatting

- **Agent-driven smoke tests and prompt evals**: Claude Code could run the `needs-smoke` checklists and voice-drift checks (`doc-97`) instead of the owner on an alt account.
- **Transport-independence proof** for `doc-79`, with no browser and no frontend.

## Open questions (owner calls)

1. **Dev only, or prod too?** Prod means real spend and real memory writes from CLI turns.
2. **Do CLI conversations write long-term memory and facts?** Agent-driven test chats would pollute a character's memory unless they are flagged or isolated.
3. **Lane hygiene**: character content entering a Claude Code session is fine on Anthropic lanes. On a z.ai-lane session it would send character chats to a Chinese-hosted model, which the owner's no-Chinese-models rule for character content forbids. The MCP/Bash wrapper should refuse or warn on those lanes.
