# Database Column Guidelines: JSONB vs Typed Columns

> **Decision**: Default to typed columns. Use JSONB only for specific scenarios.

## Quick Decision Matrix

| Scenario                                    | Use           |
| ------------------------------------------- | ------------- |
| Core business logic (IDs, limits, flags)    | Typed columns |
| Need to query/filter by field               | Typed columns |
| Need database-level defaults/constraints    | Typed columns |
| Flat, stable structure                      | Typed columns |
| Structure varies by row                     | JSONB         |
| Deeply nested data                          | JSONB         |
| High-velocity schema changes (prototyping)  | JSONB         |
| 3rd party metadata/raw API responses        | JSONB         |
| One tier's partial set of cascade overrides | JSONB         |

## Typed Columns (Default)

**Pros:**

- Prisma generates strict TypeScript types
- Database enforces constraints (`CHECK`, `NOT NULL`, `DEFAULT`)
- B-Tree indexes are fast and small
- Simple atomic updates: `data: { contextWindowTokens: 131072 }`
- Storage efficient (no key repetition)

**Cons:**

- Schema changes require migrations
- Less flexible for evolving structures

**When to use:**

- Configuration values with known, stable schema
- Fields you need to query or filter by
- Fields requiring defaults or constraints
- Any core business logic

## JSONB Columns

**Pros:**

- Add new keys without migrations
- Good for polymorphic data (varies by row)
- Handles deeply nested structures well

**Cons:**

- Prisma types as `Json` (effectively `any`) — no compile-time safety, so a Zod schema at the read/write boundary is mandatory, not optional
- No database-level type enforcement
- Updates require read-modify-write pattern (race condition risk)
- GIN indexes are larger and slower than B-Tree
- Stores keys for every row (storage overhead)

**When to use:**

- LLM API parameters (vary by model, change frequently)
- One tier's partial set of config-cascade overrides
- Plugin/extension configurations
- Raw 3rd party API responses for debugging
- Prototyping features that may be deleted

## The Prisma JSONB Gotcha

Prisma doesn't support partial JSONB updates. You must read-modify-write, which
opens a race window between the read and the write (illustrative shapes):

```typescript
// JSONB — read-modify-write; a concurrent writer's change is lost
const row = await prisma.channelSettings.findUnique({ where: { channelId } });
const current = ConfigOverridesSchema.parse(row?.configOverrides ?? {});
await prisma.channelSettings.update({
  where: { channelId },
  data: { configOverrides: { ...current, maxMessages: 100 } },
});

// Typed column — single atomic update, no window
await prisma.llmConfig.update({
  where: { id },
  data: { contextWindowTokens: 131072 },
});
```

This is the main reason to prefer a typed column whenever the field is genuinely
one stable value per row.

## Examples in This Codebase

### Good JSONB usage: `advancedParameters`

Provider parameters like `temperature`, `topP`, `topK` live in
`llm_configs.advanced_parameters` because:

- They vary by provider and model.
- New params appear as models evolve, faster than migrations are worth.
- They pass straight through to the external API rather than driving our logic.
- We never filter rows by an individual param.

They are still validated — `AdvancedParamsSchema` in common-types parses the
blob at the service boundary — which is the pattern to copy: JSONB in the
database, Zod at the edge.

### Good typed-column usage: `contextWindowTokens`

`llm_configs.context_window_tokens` is a typed `Int` with a database default
because it is stable per config, has a meaningful default, and is core
application logic rather than pass-through data.

### The third case: JSONB _because_ the value is a cascade override

Context/memory settings — `maxMessages`, `maxAge`, `maxImages`, `memoryLimit`,
`memoryScoreThreshold` and friends — are **not** columns on `llm_configs`. They
are per-field overrides resolved through a five-tier cascade
(`packages/config-resolver/src/ConfigCascadeResolver.ts`), lowest to highest:

1. `admin_settings.config_defaults` (admin)
2. `personalities.config_defaults` (personality)
3. `channel_settings.config_overrides` (channel)
4. `users.config_defaults` (user default)
5. `user_personality_configs.config_overrides` (user + personality)

Each tier stores a JSONB blob, and every tier may set any subset of fields —
that partial, per-field, per-tier shape is exactly the "structure varies by row"
case JSONB exists for. A typed column per field per tier would be five columns
per setting, all nullable, with no way to express "this tier says nothing about
this field."

The type-safety cost is paid back with `ConfigOverridesSchema`
(`packages/common-types/src/schemas/api/configOverrides.ts`), which validates
every blob and pins each field's range. It also encodes something a plain column
could not: **absence and stored `null` mean different things** — key absent =
inherit from the tier below, stored `null` = an explicit OFF that terminates the
cascade. Preserve that distinction in any code that reads or writes these blobs.

## Schema Pattern

```prisma
model LlmConfig {
  id                  String @id @db.Uuid
  name                String @db.Citext
  model               String @db.VarChar(255)

  // Typed column: stable, has a meaningful default
  contextWindowTokens Int    @default(131072) @map("context_window_tokens")

  // JSONB: provider-specific pass-through params, validated by AdvancedParamsSchema
  advancedParameters  Json?  @map("advanced_parameters")
}

model ChannelSettings {
  id        String @id @db.Uuid
  channelId String @unique @map("channel_id") @db.VarChar(20)

  // JSONB: one cascade tier's partial override set, validated by ConfigOverridesSchema
  configOverrides Json? @map("config_overrides")
}
```

`prisma/schema.prisma` is the source of truth for both models; the snippets
above are illustrative excerpts, not the full definitions.

## Migration Checklist

When adding new configuration fields, ask:

1. **Will this be sent to an external API?** → Consider JSONB
2. **Does it vary by provider/model?** → JSONB
3. **Is it core application logic?** → Typed column
4. **Do I need a database default?** → Typed column
5. **Will I query/filter by it?** → Typed column
6. **Is the structure deeply nested?** → JSONB
7. **Am I prototyping and might delete this?** → JSONB

## References

- [Prisma JSON field docs](https://www.prisma.io/docs/concepts/components/prisma-schema/data-model#json)
- [PostgreSQL JSONB docs](https://www.postgresql.org/docs/current/datatype-json.html)
