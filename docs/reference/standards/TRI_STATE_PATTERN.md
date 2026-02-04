# Tri-State Boolean Pattern

**Status**: Standard
**Applies to**: All cascading/hierarchical settings in Tzurot

## Overview

The tri-state boolean pattern uses `Boolean?` (nullable boolean) to represent settings that can be explicitly set or inherit from a parent/default.

## Values

| Value   | Display | Meaning                         |
| ------- | ------- | ------------------------------- |
| `null`  | Auto    | Inherit from parent/default     |
| `true`  | On      | Force enable, ignore hierarchy  |
| `false` | Off     | Force disable, ignore hierarchy |

## Database Schema

```prisma
// Entity-level setting (e.g., Personality)
extendedContext Boolean? @map("extended_context")

// Channel-level setting
extendedContext Boolean? @map("extended_context")

// Global default (always has a value, never null)
// Stored in AdminSettings with typed columns (e.g., extendedContextDefault)
```

## TypeScript Type

```typescript
type TriStateBoolean = boolean | null;
```

## Resolution Logic

Settings cascade from most specific to most general. The first non-null value wins.

```typescript
function resolveTriState(
  entityValue: boolean | null,
  channelValue: boolean | null,
  globalDefault: boolean
): { enabled: boolean; source: 'entity' | 'channel' | 'global' } {
  if (entityValue !== null) {
    return { enabled: entityValue, source: 'entity' };
  }
  if (channelValue !== null) {
    return { enabled: channelValue, source: 'channel' };
  }
  return { enabled: globalDefault, source: 'global' };
}
```

## Naming Conventions

| Layer                | Field Pattern       | Example                    |
| -------------------- | ------------------- | -------------------------- |
| Entity (Personality) | `{feature}`         | `extendedContext`          |
| Channel              | `{feature}`         | `extendedContext`          |
| Global default       | `{feature}_default` | `extended_context_default` |

## Command Actions

Commands managing tri-state settings should use these action names:

| Action          | Value Sent  | Description                         |
| --------------- | ----------- | ----------------------------------- |
| `enable`        | `true`      | Force enable                        |
| `disable`       | `false`     | Force disable                       |
| `auto`          | `null`      | Follow hierarchy                    |
| `status`/`show` | (read-only) | Display current and effective value |

## Status Display Format

When showing status, display both the setting value and its effective result:

```
Setting: **{Auto|On|Off}**
Effective: **{enabled|disabled}** (from {entity|channel|global})
```

## Current Implementations

| Feature          | Entity Field                  | Channel Field                     | Global Key                 |
| ---------------- | ----------------------------- | --------------------------------- | -------------------------- |
| Extended Context | `Personality.extendedContext` | `ChannelSettings.extendedContext` | `extended_context_default` |

## Adding New Tri-State Settings

1. Add field to Prisma schema with `Boolean?` type
2. Add global default column to AdminSettings (if applicable)
3. Create resolver following the cascade pattern
4. Add command actions: `enable`, `disable`, `auto`, `status`
5. Use shared helpers from `triStateHelpers.ts` for message formatting
6. Add tests for all 9 combinations (3 entity × 3 channel states)
7. Update this table with the new setting

## Related Files

- `services/bot-client/src/utils/triStateHelpers.ts` - Shared formatting helpers
- `services/bot-client/src/commands/channel/context.ts` - Channel command example
- `services/bot-client/src/commands/character/settings.ts` - Entity command example
