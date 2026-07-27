# System Model

> **STATUS: DRAFT SKELETON — awaiting the owner interview + owner edit.** Lines marked
> `OWNER:` are questions only the owner can answer; the mechanical claims below them are
> evidence, not conclusions. Hard budget: ~150 lines. This page is the narrative map —
> completeness lives in the generated indexes (`pnpm ops xray`, route manifests), not here.

## 1. The four services, as characters

- **bot-client** — the face. Owns everything Discord: slash commands + dashboards, the
  message-processor chain, webhook delivery of character replies, DM workers (release
  notes, retention notices). If it dies: the bot goes silent — jobs still finish, replies
  strand until restart re-listens.
- **api-gateway** — the source of truth. Owns Postgres, all auth tiers (internal / admin /
  user), the config cascade, and job submission. Everything bot-client knows, it asked the
  gateway for. If it dies: every command and reply errors immediately.
- **ai-worker** — the brain. Consumes AI jobs: assembles context (persona + memories +
  facts + history), calls the LLM through the BYOK/provider cascade, extracts facts,
  and runs the cron cleanups. If it dies: messages are accepted but no replies come;
  the queue backs up and stall-recovery redelivers after restart.
- **voice-engine** — the mouth and ears. Self-hosted Python STT/TTS with zero-shot voice
  cloning. If it dies: voice messages go untranscribed and self-hosted voices are silent;
  BYOK TTS providers keep working.
  <!-- OWNER: why is this a separate service (and Python)? Cost isolation, ecosystem, GPU? -->

## 2. The flows (routes only mean something inside one)

~190 HTTP handlers, 5 queues, 16 job types collapse into eight flows:

1. **A message becomes a character reply** (the spine). MessageCreate → filter gates
   (bot/denylist/empty) → trigger match (reply-to-webhook · activated channel · @tags ·
   DM session · /chat-random-chime) → one consolidated routing-context read (provisions
   the user on first contact) → persist the user turn → enqueue `llm-generation` (with
   `audio-transcription`/`image-description` as dependency jobs) → ai-worker assembles
   context and invokes the model → result lands via Redis → bot-client delivers through
   a per-character webhook → confirm-delivery → persist the assistant turn.
2. **Voice, in and out.** A voice attachment auto-transcribes (voice-engine or BYOK STT)
   and joins flow 1; the reply resolves a voice through the TTS cascade and ships audio.
3. **Characters and personas.** Character CRUD via dashboards (Redis-sessioned modals) →
   user routes → pub/sub cache invalidation; avatars and voice references are served by
   the gateway. Personas are the _speaker's_ identity — per-personality pinnable.
4. **Memory.** Delivered turns become episodes → a cron embeds them (pgvector) →
   retrieval at chat time → background fact extraction distills semantic facts →
   `/memory` + facts surfaces browse/edit/lock/forget; incognito gates writes, fresh
   gates retrieval.
5. **Config resolution.** Five tiers — hardcoded → admin default → user default →
   user-per-personality → channel — resolved per message; presets are the UI over it.
6. **Data rights.** Self-serve export (token link, 24h) and token-gated self-delete;
   the retention lifecycle (activity stamps → preview → warning DMs → 30-day grace →
   operator purge → audit ledger) for inactive accounts. Everything destructive is
   operator-driven with previews and circuit breakers.
7. **Release comms.** GitHub release webhook → broadcast queue → bot-client DM worker →
   per-recipient delivery ledger; an hourly reconcile sweep catches missed releases.
8. **Shapes.inc migration.** BYOK auth → async import of a character + its memories →
   export back out.

## 3. Invariants, and why they hold (the layer no generator can produce)

- **bot-client never touches Prisma.** The gateway is the single source of truth; the
  bot is a renderer. <!-- OWNER: confirm the origin story — v2 lesson? -->
- **Ack Discord within 3 seconds; all async work after the ack.** The budget is
  indivisible — a "fast" Redis read today is a slow one under load.
- **Nothing user-visible is synchronous.** Every AI call is a queued job; delivery is
  at-least-once with spend-idempotent retries (partial completion shrinks payloads,
  zero-spend failures refund, usage rows write only past the point of no return).
- **One queue per purpose.** Release DMs, retention notices, and AI jobs never share a
  queue — the at-least-once reasoning depends on single-purpose queues.
- **Deterministic UUIDs everywhere** (never `uuid.v4`) — dev↔prod sync and idempotent
  re-runs depend on stable identity.
- **Sync-tracked tables get raw SQL for non-semantic writes.** `updated_at` is the
  dev↔prod last-write-wins resolver; a casual stamp would clobber real edits.
- **Single-predicate modules.** Eligibility, cross-user reach, DM-failure classification
  each live in exactly one module consumed by every surface — report and action can
  never disagree.
- **Discord error codes are doctrine:** 50278/50007 = user unreachable, 10013 = account
  gone, 20026 = _our_ bot is quarantined (never a user signal).
- **One canonical snowflake shape** (17–20 digits) drives the app pattern, the API
  schema, and the DB CHECK; user provisioning refuses malformed ids at the choke point.
- **Characters speak through webhooks**, one webhook identity per character per channel.
  <!-- OWNER: the product story for webhooks-over-bot-account — what did it unlock? -->
- **Manual-approval-first for destructive automation.** Purges and blasts ship as
  operator CLIs with previews and breakers first; autonomy is earned later, if ever.
- **Prod is the soak environment.** Dev has no organic traffic; a green dev deploy
  proves boot, not behavior.
- <!-- OWNER: why personas AND personalities as separate concepts? -->
- <!-- OWNER: the BYOK-first economics — what's the money story that shaped the wallet
  design and free-tier fair-share? -->
- <!-- OWNER: anything on this list that ISN'T load-bearing anymore? -->

## 4. Known lies and drift (listing them is what keeps the map trusted)

- The `/ai/*` bare routes are a legacy dual-mount of the internal AI four; one mount is
  supposed to die.
- `packages/clients/src/routes/internal.ts` carries stale "the cutover relocates this"
  comments for routes whose cutover already happened; `admin.ts` has the `cleanup`
  docblock sitting above the `broadcast` route.
- `ResponseOrderingService` is single-replica by design (flagged in-code) — a known
  horizontal-scaling blocker.
- `ContextAssembler`'s `userName ?? userId` fallback would crash first-provision for a
  nameless envelope (tracked in `cold/follow-ups.md`; unreachable while bot-client
  always sends `userName`).
- The system-model theme file said "122 routes"; reality is ~190 handlers.
- <!-- OWNER: where does this page disagree with the system you actually experience? -->

## 5. Concept → location (bridging words to code; the generated index has the rest)

| You say…                  | It lives…                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| character                 | `personalities` table · `bot-client/commands/character` · `/api/user/personality/*`                    |
| persona (speaker)         | `personas` table · `bot-client/commands/persona` · `/api/user/persona/*`                               |
| the reply pipeline        | `bot-client/handlers` + `composition.ts` → `api-gateway/queue.ts` → `ai-worker/jobs/handlers/pipeline` |
| memory / episode          | `memories` (pgvector) · `ai-worker/services/context` · `/api/user/memory/*`                            |
| fact                      | `memory_facts` · `ai-worker/services/extraction` · fact routes                                         |
| preset / cascade          | `llm_configs`/`tts_configs` · `packages/config-resolver` · `/api/user/config-overrides/*`              |
| voice                     | `voice-engine/server.py` · `ai-worker/services/voice` · `bot-client/commands/voice`                    |
| dashboard                 | `bot-client/utils/dashboard` (sessions in Redis, modals, truncation gate)                              |
| inspect / flight recorder | `diagnostic_logs` · `bot-client/commands/inspect` · `/api/user/diagnostic/*`                           |
| retention / purge         | `api-gateway/services/retention` (single-predicate `eligibility.ts`) · `retention:*` CLIs              |
| release DMs               | `api-gateway/routes/webhooks` + `releaseBroadcast` · `bot-client/services/releaseDm`                   |
| dev↔prod sync             | `api-gateway/services/sync` (`syncTables.ts` = the manifest)                                           |
| the ops CLI               | `packages/tooling` (`pnpm ops …`)                                                                      |
| the website               | `services/website` (renders `docs/commands.md`, `/privacy`, `/terms` live)                             |
