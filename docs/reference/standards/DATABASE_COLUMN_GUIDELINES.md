# Database Column Guidelines: JSONB vs Typed Columns

> **Decision**: Default to typed columns. Use JSONB only for specific scenarios.

## Quick Decision Matrix

| Scenario                                   | Use           |
| ------------------------------------------ | ------------- |
| Core business logic (IDs, limits, flags)   | Typed columns |
| Need to query/filter by field              | Typed columns |
| Need database-level defaults/constraints   | Typed columns |
| Flat, stable structure                     | Typed columns |
| Structure varies by row                    | JSONB         |
| Deeply nested data                         | JSONB         |
| High-velocity schema changes (prototyping) | JSONB         |
| 3rd party metadata/raw API responses       | JSONB         |

## Typed Columns (Default)

**Pros:**

- Prisma generates strict TypeScript types
- Database enforces constraints (`CHECK`, `NOT NULL`, `DEFAULT`)
- B-Tree indexes are fast and small
- Simple atomic updates: `data: { maxMessages: 100 }`
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

- Prisma types as `Json` (effectively `any`) - no compile-time safety
- No database-level type enforcement
- Updates require read-modify-write pattern (race condition risk)
- GIN indexes are larger and slower than B-Tree
- Stores keys for every row (storage overhead)

**When to use:**

- LLM API parameters (vary by model, change frequently)
- Plugin/extension configurations
- Raw 3rd party API responses for debugging
- Prototyping features that may be deleted

## The Prisma JSONB Gotcha

Prisma doesn't support partial JSONB updates. You must read-modify-write:

```typescript
// JSONB - Risky read-modify-write pattern
const config = await prisma.config.findUnique({ where: { id } });
const current = config.settings as Record<string, unknown>;
await prisma.config.update({
  where: { id },
  data: {
    settings: { ...current, maxMessages: 100 }, // Race condition!
  },
});

// Typed column - Clean atomic update
await prisma.config.update({
  where: { id },
  data: { maxMessages: 100 }, // Safe
});
```

## Examples in This Codebase

### Good JSONB Usage: `advancedParameters`

LLM API parameters like `temperature`, `top_p`, `frequency_penalty` are stored in JSONB because:

- They vary by model (Claude vs GPT vs Gemini have different params)
- New params are added frequently as models evolve
- They're passed through to external API (not core business logic)
- We rarely query/filter by individual params

### Good Typed Column Usage: Context Settings

Settings like `maxMessages`, `maxAge`, `maxImages` should be typed columns because:

- They're stable configuration (won't change frequently)
- We need database defaults (e.g., `DEFAULT 50`)
- We might filter by them (e.g., find configs with high limits)
- They're core application logic, not pass-through data

## Schema Pattern

```prisma
model LlmConfig {
  id                  String @id @default(uuid())
  name                String
  model               String

  // Typed columns for stable config
  maxMessages         Int    @default(50) @map("max_messages")
  maxAge              Int?   @map("max_age")  // null = no limit
  maxImages           Int    @default(10) @map("max_images")
  memoryLimit         Int?   @map("memory_limit")
  memoryScoreThreshold Float? @map("memory_score_threshold")
  contextWindowTokens Int?   @map("context_window_tokens")

  // JSONB for variable LLM API params
  advancedParameters  Json?  @map("advanced_parameters")
}
```

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
