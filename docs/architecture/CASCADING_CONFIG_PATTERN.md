# Cascading Configuration Pattern

## Overview

The Cascading Configuration Pattern is used throughout Tzurot v3 for user-configurable settings that need multiple levels of override capability. This pattern provides a consistent way to resolve configuration values through a priority hierarchy.

## Resolution Hierarchy

Configuration values are resolved in this priority order (highest to lowest):

1. **Context Override** - Per-personality override from `UserPersonalityConfig`
2. **User Default** - User's global default setting from `User.*`
3. **System Default** - Fallback when user has no settings

```
┌─────────────────────────────────────────────────────────────┐
│                    Resolution Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Request arrives with (userId, personalityId)              │
│                          │                                  │
│                          ▼                                  │
│   ┌─────────────────────────────────────┐                  │
│   │ Check: Context Override exists?     │                  │
│   │ (UserPersonalityConfig.configId)    │                  │
│   └─────────────────────────────────────┘                  │
│              │                    │                        │
│           YES │                   │ NO                     │
│              ▼                    ▼                        │
│   ┌──────────────────┐   ┌─────────────────────────┐       │
│   │ Return override  │   │ Check: User Default?    │       │
│   │ source: context  │   │ (User.defaultConfigId)  │       │
│   └──────────────────┘   └─────────────────────────┘       │
│                                  │           │             │
│                               YES │           │ NO         │
│                                  ▼           ▼            │
│                      ┌──────────────────┐  ┌───────────┐  │
│                      │ Return default   │  │ Auto-     │  │
│                      │ source: user     │  │ default?  │  │
│                      └──────────────────┘  └───────────┘  │
│                                                │    │     │
│                                             YES│    │NO   │
│                                                ▼    ▼     │
│                             ┌──────────────┐ ┌──────────┐ │
│                             │ Set first    │ │ Return   │ │
│                             │ owned as     │ │ system   │ │
│                             │ default      │ │ default  │ │
│                             └──────────────┘ └──────────┘ │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

## Implementations

### PersonaResolver

Resolves user personas for memory operations and prompts.

```typescript
import { PersonaResolver } from './resolvers/index.js';

const resolver = new PersonaResolver(prismaClient);

// Full resolution with all persona details
const result = await resolver.resolve(discordUserId, personalityId);
// result.source: 'context-override' | 'user-default' | 'system-default'
// result.config: { personaId, preferredName, pronouns, content, shareLtmAcrossPersonalities }

// Lightweight resolution for memory queries
const memoryInfo = await resolver.resolveForMemory(discordUserId, personalityId);
// memoryInfo: { personaId, shareLtmAcrossPersonalities } | null

// Get formatted persona content for prompts
const content = await resolver.getPersonaContentForPrompt(personaId);
// "Name: Alice\nPronouns: she/her\nA friendly person..."
```

**Database Schema:**

- User default: `User.defaultPersonaId` (direct FK)
- Context override: `UserPersonalityConfig.personaId` (per-personality)

### LlmConfigResolver

Resolves LLM configuration (model, temperature, tokens) for AI requests.

```typescript
import { LlmConfigResolver } from './resolvers/index.js';

const resolver = new LlmConfigResolver(prismaClient);

// Resolve with merge strategy
const result = await resolver.resolve(discordUserId, personalityId);
// result.source: 'context-override' | 'user-default' | 'system-default'
// result.config: { model, temperature, maxTokens, ... }
```

**Database Schema:**

- User default: `User.defaultLlmConfigId` (direct FK)
- Context override: `UserPersonalityConfig.llmConfigId` (per-personality)

## Resolution Strategies

### Switch Strategy (Personas)

The entire configuration object is replaced at each level:

```
User has:
  - Default persona: { name: "Alice", pronouns: "she/her" }
  - Override for BotA: { name: "Gaming Alice", pronouns: "she/her" }

Resolution:
  - Talking to BotA → Returns "Gaming Alice" (full override)
  - Talking to BotB → Returns "Alice" (full default)
```

### Merge Strategy (LLM Configs)

Individual fields are merged with defaults:

```
User has:
  - Default config: { model: "claude-3", temperature: 0.7, maxTokens: 4096 }
  - Override for BotA: { temperature: 0.9 } // Only overrides temperature

Resolution:
  - Talking to BotA → { model: "claude-3", temperature: 0.9, maxTokens: 4096 }
  - Talking to BotB → { model: "claude-3", temperature: 0.7, maxTokens: 4096 }
```

## Lazy Initialization (Auto-Default)

When a user has no default set but owns at least one configuration:

1. First owned item is automatically selected as the default
2. This selection is **persisted** to the database
3. Future requests use the persisted default (no repeated auto-selection)

```typescript
// PersonaResolver auto-default logic
if (!user.defaultPersonaId && user.ownedPersonas.length > 0) {
  const firstPersona = user.ownedPersonas[0];

  // Persist for future requests
  await prisma.user.update({
    where: { id: user.id },
    data: { defaultPersonaId: firstPersona.id },
  });

  return {
    config: firstPersona,
    source: 'user-default',
    sourceName: 'auto-default',
  };
}
```

## Base Class: BaseConfigResolver

All resolvers extend `BaseConfigResolver<T>` which provides:

- **In-memory caching** with configurable TTL (default: 5 minutes)
- **Cache key generation** from userId + personalityId
- **Cache invalidation** per user or full clear
- **Cleanup interval** for expired entries

```typescript
abstract class BaseConfigResolver<T> {
  // Subclasses implement this
  protected abstract doResolve(
    userId: string | undefined,
    personalityId?: string
  ): Promise<ResolutionResult<T>>;

  // Public API
  async resolve(userId: string | undefined, personalityId?: string): Promise<ResolutionResult<T>>;
  invalidateUserCache(userId: string): void;
  clearCache(): void;
  stopCleanup(): void;
}
```

## Design Decisions

### Why Direct FK Instead of Join Table?

**Before (v2 pattern):**

```prisma
model UserDefaultPersona {
  userId    String @unique
  personaId String
  user      User   @relation(...)
  persona   Persona @relation(...)
}
```

**After (v3 pattern):**

```prisma
model User {
  defaultPersonaId String?
  defaultPersona   Persona? @relation(...)
}
```

**Rationale:**

1. **Simpler queries** - One fewer join for common operations
2. **Consistency** - Same pattern as `defaultLlmConfigId`
3. **No orphan rows** - FK ensures referential integrity
4. **Better caching** - User record already loaded in most flows

### Why Separate Resolvers?

Instead of one generic resolver, we have specialized resolvers because:

1. **Different return shapes** - Personas need content formatting, LLM configs need merging
2. **Different query patterns** - Persona resolution needs `ownedPersonas` for auto-default
3. **Type safety** - Each resolver returns its specific config type
4. **Single responsibility** - Each resolver handles one domain

### Why Cache at Resolver Level?

1. **Request deduplication** - Same user+personality in same session
2. **Reduced DB load** - High-frequency memory operations don't need fresh queries
3. **Configurable TTL** - Balance freshness vs. performance
4. **Explicit invalidation** - Clear cache when user updates settings

## Testing

Resolver tests mock the Prisma client to verify:

1. **Priority ordering** - Override beats default beats system
2. **Cache behavior** - Subsequent calls use cache
3. **Auto-default persistence** - First owned item is saved
4. **Error handling** - Graceful fallback to system default
5. **Edge cases** - Anonymous users, missing users, empty configs

See:

- `services/ai-worker/src/services/resolvers/PersonaResolver.test.ts`
- `services/ai-worker/src/services/resolvers/LlmConfigResolver.test.ts`

## Usage Guidelines

### When to Use This Pattern

- User-configurable settings with multiple override levels
- Settings that benefit from caching
- Settings with sensible system defaults

### When NOT to Use This Pattern

- One-off settings with no override capability
- Settings that must always be fresh (no caching)
- Settings without a meaningful system default

## Related Documentation

- [Architecture Decisions](./ARCHITECTURE_DECISIONS.md)
- [Database Schema](../../prisma/schema.prisma)
- [Memory System](../features/memory-system.md)
