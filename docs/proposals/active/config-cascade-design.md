# Unified Configuration Cascade

## Context

Configuration settings are scattered across multiple systems with inconsistent tiering:

- **LlmConfig** bundles LLM-specific params (temperature, model) with non-LLM settings (maxMessages, memoryLimit, contextWindowTokens) in one heavyweight object
- Users must create a full named `LlmConfig` preset just to tweak one setting
- No admin-configurable global defaults (`AdminSettings` is an empty singleton)
- Voice/image settings have no user-level overrides
- Focus mode exists only at user+character level

Goal: a clean 4-tier cascade (admin -> character -> user -> user+character) applied consistently, with LlmConfig slimmed to only LLM-provider settings and a new lightweight overlay system for everything else.

## Completed Work (Phase 1)

### Phase 1a: Remove `maxReferencedMessages` dead field

Removed dead config field that was never consumed at runtime. Cleaned from: Prisma schema, API schemas, service layer, preset UI, import/export, tests.

### Phase 1b: Model Validation & Context Window Enforcement

- `OpenRouterModelCache.getModelById()` for validation lookups
- Server-side model validation on create/update (user + admin routes)
- Context window cap enforcement (50% of model's `context_length`)
- `enrichWithModelContext()` enriches API responses with `modelContextLength` and `contextWindowCap`
- Preset dashboard shows context window cap info in preview (`ctx=65K / 200K` or `ctx=131K (max 64K)`)

## Field Classification

### Currently in LlmConfig -- Sent to OpenRouter (KEEP in LlmConfig)

`model`, `visionModel`, `provider`, `temperature`, `topP`, `topK`, `frequencyPenalty`, `presencePenalty`, `repetitionPenalty`, `minP`, `topA`, `seed`, `maxTokens`, `stop`, `logitBias`, `responseFormat`, `showThinking`, `reasoning`, `transforms`, `route`, `verbosity`

### Currently in LlmConfig -- NOT sent to OpenRouter (MOVE OUT)

| Field                  | What it controls                   |
| ---------------------- | ---------------------------------- |
| `maxMessages`          | Extended context history window    |
| `maxAge`               | Extended context time cutoff       |
| `maxImages`            | Extended context image count       |
| `memoryScoreThreshold` | RAG retrieval similarity threshold |
| `memoryLimit`          | RAG retrieval count                |

### Stays in LlmConfig (model-coupled)

| Field                 | Why                                                                             |
| --------------------- | ------------------------------------------------------------------------------- |
| `contextWindowTokens` | Tied to model's actual context limit; capped at 50% of model's `context_length` |

### Not in LlmConfig -- Also need cascade support

| Field              | Current location        | Current tier(s)     |
| ------------------ | ----------------------- | ------------------- |
| `focusModeEnabled` | `UserPersonalityConfig` | user+character only |
| `voiceEnabled`     | `Personality`           | character only      |
| `imageEnabled`     | `Personality`           | character only      |

## Design

### New Concept: `ConfigOverrides` (JSONB overlay)

A **partial configuration object** stored as JSONB at each tier. Only fields that are explicitly set are present -- everything else inherits from lower tiers.

```typescript
// Zod schema in common-types/src/schemas/api/configOverrides.ts
const ConfigOverridesSchema = z
  .object({
    // Context settings (moved from LlmConfig)
    maxMessages: z.number().int().min(1).max(100).optional(),
    maxAge: z.number().int().min(0).nullable().optional(),
    maxImages: z.number().int().min(0).max(20).optional(),
    // Memory settings (moved from LlmConfig)
    memoryScoreThreshold: z.number().min(0).max(1).optional(),
    memoryLimit: z.number().int().min(0).optional(),

    // Feature toggles
    focusModeEnabled: z.boolean().optional(),

    // Inline LLM param tweaks (layered ON TOP of whichever LlmConfig is selected)
    llmOverrides: z
      .object({
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).optional(),
        // ... other AdvancedParams fields (reuses AdvancedParamsSchema, all optional)
      })
      .optional(),
  })
  .strict();
```

**Important:** `llmConfigId` is NOT part of ConfigOverrides. LLM preset selection remains a separate explicit choice on `UserPersonalityConfig.llmConfigId`, `User.defaultLlmConfigId`, and `PersonalityDefaultConfig.llmConfigId`. ConfigOverrides is purely additive customization layered on top of the selected preset.

### Where it's stored (4 tiers)

| Tier              | Table                   | Column                    | Set by            |
| ----------------- | ----------------------- | ------------------------- | ----------------- |
| 1. Global         | `AdminSettings`         | `configDefaults` (JSONB)  | Bot admin         |
| 2. Character      | `Personality`           | `configDefaults` (JSONB)  | Character creator |
| 3. User           | `User`                  | `configDefaults` (JSONB)  | Individual user   |
| 4. User+Character | `UserPersonalityConfig` | `configOverrides` (JSONB) | Individual user   |

### Resolution Algorithm

```
Effective config = deepMerge(
  HARDCODED_DEFAULTS,                          // Fallback
  AdminSettings.configDefaults,                // Tier 1
  Personality.configDefaults,                  // Tier 2
  User.configDefaults,                         // Tier 3
  UserPersonalityConfig.configOverrides        // Tier 4 (highest priority)
)
```

Each tier only overrides fields it explicitly sets. `undefined` = "inherit from below".

For `llmOverrides`, all tiers' overrides merge (higher tier wins per-field).

### Two parallel cascades

**1. LLM Config selection** (existing system, unchanged):

```
UserPersonalityConfig.llmConfigId -> User.defaultLlmConfigId -> PersonalityDefaultConfig.llmConfigId
```

User picks a preset. This determines the base model, temperature, sampling params, etc.

**2. ConfigOverrides** (new system):

```
deepMerge(HARDCODED_DEFAULTS, AdminSettings.configDefaults, Personality.configDefaults,
          User.configDefaults, UserPersonalityConfig.configOverrides)
```

Additive customization: context, memory, feature toggles, plus optional inline LLM param tweaks.

**At generation time**, the resolved LlmConfig (from cascade 1) is the base. Then `llmOverrides` from the resolved ConfigOverrides (cascade 2) are applied on top. This means a user can say "use the Creative Writing preset for this character, but bump temperature to 1.5" -- the preset comes from cascade 1, the temperature tweak from cascade 2.

## Remaining Phases

### Phase 2: Config Cascade Schema & Foundation

1. **Define `ConfigOverridesSchema`** in `common-types/src/schemas/api/configOverrides.ts`
   - Zod schema for validation
   - TypeScript type for runtime use
   - Shared between all services

2. **Add JSONB columns** via Prisma migration
   - `AdminSettings.configDefaults Json?`
   - `Personality.configDefaults Json?`
   - `User.configDefaults Json?`
   - `UserPersonalityConfig.configOverrides Json?`

3. **Implement `ConfigCascadeResolver`** in `common-types/src/services/`
   - New resolver that loads all 4 tiers and deep-merges
   - Returns `ResolvedConfig` with per-field source tracking
   - Caching (similar pattern to existing `LlmConfigResolver`)

4. **Wire into `ConfigStep`** in the AI worker pipeline
   - Replace current `LlmConfigResolver.resolveConfig()` usage
   - New resolver handles both LLM config and context/memory settings

5. **Unify `MAX_REFERENCED_MESSAGES` into `maxMessages`**
   - Currently `MAX_REFERENCED_MESSAGES` (hardcoded to 20 in `ReferenceExtractor.ts`) is a separate limit independent of `maxMessages`
   - This means the real context window can grow to `maxMessages + MAX_REFERENCED_MESSAGES` (up to 70 messages), which is unintuitive and hard to reason about
   - **New behavior:** `maxMessages` is the total conversation budget. Referenced messages consume slots from this budget. If a user sets `maxMessages=50` and there are 5 referenced messages, only 45 chat history messages are fetched
   - **Implementation:**
     - Remove `MAX_REFERENCED_MESSAGES` constant from `common-types/constants/ai.ts`
     - `ReferenceExtractor` takes `maxMessages` from resolved config instead of a hardcoded limit
     - `ContextBuilder` (or wherever history+references are assembled) enforces the total: `historySlots = maxMessages - referencedMessageCount`
     - References are always prioritized over history (they're explicitly cited by the user)
   - **Migration:** No data migration needed -- just runtime behavior change. Users who had `maxMessages=50` were effectively getting up to 70; now they get exactly 50

### Phase 3: LlmConfig Cleanup

1. **Soft-deprecate** non-LLM fields on `LlmConfig` (keep in DB, stop reading from them in the resolver)
2. **Migrate existing data**: copy `maxMessages`, `memoryLimit`, etc. from each `LlmConfig` into the corresponding `Personality.configDefaults` or `UserPersonalityConfig.configOverrides`
3. **Update preset dashboard** to show context/memory settings under a "Config" tab that writes to `configOverrides` instead of LlmConfig fields
4. **Drop columns** from LlmConfig in a later migration once no code reads them

### Phase 4: Admin & User UX

1. **Admin settings UI**: `/admin settings` command to configure global defaults
2. **User config UI**: `/settings config` or inline overrides on `/character edit` dashboard
3. **Per-field source indicators**: Show users where each setting comes from ("using character default", "your override", etc.)

### Phase 5: Extended Cascade

1. **Voice/image overrides** at user and user+character tiers
2. **Move `focusModeEnabled`** from standalone `UserPersonalityConfig` boolean into `configOverrides`

## Key Files (Phase 2+)

| File                                                                    | Role                                   |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `packages/common-types/src/schemas/api/configOverrides.ts`              | NEW -- Zod schema                      |
| `packages/common-types/src/services/ConfigCascadeResolver.ts`           | NEW -- 4-tier merge resolver           |
| `packages/common-types/src/services/LlmConfigResolver.ts`               | MODIFY -- delegate to cascade resolver |
| `packages/common-types/src/services/personality/PersonalityDefaults.ts` | MODIFY -- read from configDefaults     |
| `prisma/schema.prisma`                                                  | MODIFY -- add JSONB columns            |
| `services/ai-worker/src/jobs/handlers/pipeline/steps/ConfigStep.ts`     | MODIFY -- use new resolver             |
| `services/api-gateway/src/routes/user/config-overrides.ts`              | NEW -- CRUD endpoints                  |
| `services/api-gateway/src/routes/admin/settings.ts`                     | MODIFY -- admin config defaults        |

## Resolved Design Decisions

### Q1: `Personality.configDefaults` vs `PersonalityDefaultConfig`

**Answer: They coexist -- different concerns.**

`PersonalityDefaultConfig.llmConfigId` handles LLM preset selection (cascade 1 -- unchanged). `Personality.configDefaults` handles everything else (cascade 2 -- new). No need to merge them since `llmConfigId` is explicitly NOT part of ConfigOverrides. `PersonalityDefaultConfig` stays as-is.

### Q2: Cache invalidation for 4-tier merge

**Answer: Tier-scoped invalidation via existing Redis pub/sub pattern.**

| Change at tier   | Invalidation scope                                                                                            | Frequency                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Admin global     | Clear ALL cached results                                                                                      | Rare (admin-only, acceptable cost) |
| Personality      | Invalidate all entries keyed with that `personalityId`                                                        | Uncommon (character creator edits) |
| User default     | Invalidate all entries keyed with that `userId` (existing pattern in `LlmConfigResolver.invalidateUserCache`) | Occasional                         |
| User+personality | Invalidate single `userId-personalityId` cache entry                                                          | Common (fine-grained, cheap)       |

The existing `CacheInvalidationService` and `LlmConfigCacheInvalidationService` already use Redis pub/sub for cross-instance cache invalidation. The new `ConfigCascadeResolver` follows the same pattern -- publish invalidation events on config change, subscribers clear their local caches. No new infrastructure needed.

### Q3: `llmOverrides` schema

**Answer: Reuse `AdvancedParamsSchema` with all fields optional.**

`llmOverrides` uses the same Zod schema as `LlmConfig.advancedParameters` (the `AdvancedParamsSchema` from `common-types/src/schemas/llmAdvancedParams.ts`) plus `model` and `visionModel`. All fields are `.optional()` since it's a sparse overlay. This guarantees validation consistency -- the same constraints apply whether the value comes from a preset or an inline override. The `advancedParamsToConfigFormat()` converter already handles partial objects.
