# Architecture Rules

## Service Boundaries

| Service     | Prisma Access | Why                                               |
| ----------- | ------------- | ------------------------------------------------- |
| bot-client  | **NEVER**     | Use gateway APIs (`callGatewayApi`, `adminFetch`) |
| api-gateway | Yes           | Source of truth for data                          |
| ai-worker   | Yes           | Memory and AI operations                          |

### Anti-Patterns

- Direct `fetch()` to gateway → use typed clients
- Importing Prisma in bot-client → architectural violation
- Cross-service direct imports → use common-types

## Request Flow

```
Discord User → bot-client (Discord.js) → api-gateway (Express + BullMQ) → ai-worker (AI + pgvector) → OpenRouter/Gemini API
```

## Where Code Belongs

| Type                       | Location               |
| -------------------------- | ---------------------- |
| Webhook/message formatting | `bot-client/`          |
| Slash commands             | `bot-client/commands/` |
| HTTP endpoints             | `api-gateway/routes/`  |
| Job creation               | `api-gateway/queue.ts` |
| AI provider clients        | `ai-worker/providers/` |
| Memory/embeddings          | `ai-worker/services/`  |
| Shared types/constants     | `common-types/`        |
| Discord type guards        | `common-types/types/`  |

## Error Message Patterns

| Layer       | Pattern               | Example                                                    |
| ----------- | --------------------- | ---------------------------------------------------------- |
| api-gateway | Clean JSON, NO emojis | `{ "error": "NOT_FOUND", "message": "Persona not found" }` |
| bot-client  | ADD emojis for users  | `'❌ Profile not found.'`                                  |

## Request Enrichment (api-gateway middleware)

User-scoped routes run two auth-adjacent middlewares. Handlers read from `req` depending on which field they need:

| Middleware                 | Attaches                                                   | Field type               | When to use                                             |
| -------------------------- | ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `requireUserAuth()`        | `req.userId`                                               | Discord snowflake string | When you need the Discord ID (e.g., for `isBotOwner()`) |
| `requireProvisionedUser()` | `req.provisionedUserId`, `req.provisionedDefaultPersonaId` | Internal UUIDs           | When you need the internal user row (Phase 5c PR B on)  |

Mount order matters: `requireProvisionedUser` runs AFTER `requireUserAuth` and reads the Discord ID set by the first middleware. Both attach fields via local casting (`(req as ProvisionedRequest).provisionedUserId = ...`) — no global Express augmentation.

During the shadow-mode window (PR B → PR C), `provisionedUserId` is **optional** on the request type because the middleware degrades gracefully on missing headers or malformed URI encoding. PR C tightens the invariant once bot-client has been fully rolled out.

Handlers that need the internal UUID should prefer `req.provisionedUserId` (set by the middleware) over provisioning the user themselves.

## Design Principles

1. **Simple, clean classes** - No DDD over-engineering
2. **Clear service boundaries** - Each service has single responsibility
3. **No circular dependencies** - Services can't import from each other
4. **Shared code in common-types** - Cross-service types, utils, services
5. **Constructor injection** - Simple dependency passing, no DI containers
6. **`Route→Service→Prisma`** - the whole layering. No use-case/repository tiers, no generic `IRepository<T>`, no event bus (Redis pub/sub is for cache invalidation only).

## When to Extract a Service

**Extract when:** Shared across multiple microservices, complex business logic, stateful operations, easier testability needed

**Keep inline when:** Used in one place only, stateless utility function, very simple logic

## Architecture Verification

Run `/tzurot-arch-audit` periodically to verify these rules programmatically.

Automated enforcement:

- `pnpm depcruise` — boundary violations (service imports, Prisma access, circular deps)
- `pnpm ops xray --summary` — package health (size, complexity, API surface)
- `pnpm knip` — dead code detection

**Watch for common-types bloat.** If it exceeds 50 exports or 3000 lines (xray thresholds), consider extracting domain-specific packages.

## Deterministic UUIDs

Never use `uuid.v4()` - use generators from common-types for deterministic IDs.

## BullMQ Job Patterns

### Retryable vs Non-Retryable

**Retryable:** Network timeouts, rate limits (429), server errors (5xx)
**Non-retryable:** Validation errors (400), not found (404), auth (401)

### Spend-Idempotent Retries (money/budget/usage side effects)

A retried or requeued job re-executes its handler. Any job that bills a model
call, consumes a budget counter, or writes a usage row must stay correct
across that re-execution:

- **Partial completion shrinks the retry payload** — completed sub-units must
  not re-bill on every retry cycle (reference: fact-extraction's busy path
  carries `remainingMemoryIds` and `job.updateData` shrinks `sourceMemoryIds`).
- **Zero-spend failures are counter-neutral** — a rate-limit/busy failure that
  spent no tokens must not consume budget (consume-then-refund, and any
  exemption flag must gate consume and refund SYMMETRICALLY).
- **Usage rows write only past the point of no return** — after the response
  is in hand (parse failures still spent tokens; busy throws did not), never
  before a retryable throw.

### Queue Configuration

Queues set `defaultJobOptions` — bounded `attempts` with exponential `backoff`, and bounded `removeOnComplete`/`removeOnFail` history (live values: `services/api-gateway/src/queue.ts`).

### Timer Patterns

`setTimeout` is fine for request timeouts and one-time delays (an `AbortController` abort). A persistent `setInterval` is a scaling blocker — use a BullMQ repeatable job (`queue.add(name, {}, { repeat: { every } })`) instead.

## Observability

### Correlation IDs

bot-client generates a `requestId` (`randomUUID()`) and sends it as the `X-Request-ID` header; every service includes it in logs (`logger.info({ requestId, jobId }, 'Processing')`). When a whole call path should carry the id — especially when it hands a `logger` to a helper like `withRetry` that emits its own lines — bind once at the entry point (`const log = logger.child({ requestId })`) and thread the bound logger instead of adding `requestId` to every call site. Reference: `processAttachmentsParallel` in ai-worker's `AttachmentProcessor.ts`.

### Structured Logging

Structured data first, static message second (`logger.info({ personalityId, model }, 'Loaded personality')`) — never string interpolation, which loses structure.
