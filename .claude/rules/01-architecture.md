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

## Design Principles

1. **Simple, clean classes** - No DDD over-engineering
2. **Clear service boundaries** - Each service has single responsibility
3. **No circular dependencies** - Services can't import from each other
4. **Shared code in common-types** - Cross-service types, utils, services
5. **Constructor injection** - Simple dependency passing, no DI containers

## Anti-Patterns (DON'T DO)

| Pattern                                     | Why Not         | v3 Alternative               |
| ------------------------------------------- | --------------- | ---------------------------- |
| Generic `IRepository<T>`                    | Too abstract    | Concrete service methods     |
| DI containers                               | Over-engineered | Direct instantiation         |
| `Controller→UseCase→Service→Repository→ORM` | Too many layers | `Route→Service→Prisma`       |
| Complex event bus                           | Unnecessary     | Redis pub/sub for cache only |

## When to Extract a Service

**Extract when:** Shared across multiple microservices, complex business logic, stateful operations, easier testability needed

**Keep inline when:** Used in one place only, stateless utility function, very simple logic

## Autocomplete Utilities

**ALWAYS check for existing utilities before writing autocomplete handlers.**

Available in `bot-client/src/utils/autocomplete/`:

| Utility                         | Purpose                   |
| ------------------------------- | ------------------------- |
| `handlePersonalityAutocomplete` | Personality selection     |
| `handlePersonaAutocomplete`     | Profile/persona selection |

## Architecture Verification

Run `/tzurot-arch-audit` periodically to verify these rules programmatically.

Automated enforcement:

- `pnpm depcruise` — boundary violations (service imports, Prisma access, circular deps)
- `pnpm ops xray --summary` — package health (size, complexity, API surface)
- `pnpm knip` — dead code detection

**Watch for common-types bloat.** If it exceeds 50 exports or 3000 lines (xray thresholds), consider extracting domain-specific packages.
