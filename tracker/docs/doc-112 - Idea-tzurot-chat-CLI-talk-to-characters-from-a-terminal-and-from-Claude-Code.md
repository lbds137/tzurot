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

## Owner rulings (2026-10-13)

1. **Dev vs prod is not a distinguishing axis**: both environments spend money and write memory. Environment is a normal per-invocation choice, not a scope limit.
2. **The agent gets its own special user, not the owner's.** Its memories land in its own space, so suppression is not required by default. Where wanted, suppression is per user, and the existing Incognito mode already does it: a session with `personalityId: 'all'` and `duration: 'forever'` disables memory writing for that user (`packages/common-types/src/types/memory-modes.ts`). Build implication: `User.discordId` is a required `VarChar(20)`, so the special user needs a synthetic snowflake until `doc-79` Phase 2 lands platform-neutral identity.
3. **No lane restriction.** Tzurot characters already run on z.ai models in production, so a z.ai-lane Claude Code session seeing character chat adds no new exposure. (The shared-memory no-Chinese-models rule covers non-code Claude Code sessions in other projects, not Tzurot's own model routing.)
