# Qdrant CLI - Comprehensive Memory Management Tool

A powerful command-line tool for managing Qdrant vector memories in Tzurot v3.

## Overview

The Qdrant CLI consolidates all vector memory management operations into a single, flexible tool. It's designed to be extended into user-facing slash commands in the future.

## Installation

The CLI is already available via pnpm:

```bash
pnpm qdrant <command> [args]
```

## Commands

### Collection Management

#### `list`
List all collections with grouping by type (persona, legacy, personality).

```bash
pnpm qdrant list
```

Shows:
- Persona collections (v3 format: `persona-{uuid}`)
- Legacy collections (shapes.inc imports: `persona-legacy-{uuid}`)
- Personality collections (old format: `personality-{uuid}`)
- Total collections and point counts

#### `inspect <collection>`
Show detailed information about a collection including vector config, payload schema, and indexing status.

```bash
pnpm qdrant inspect persona-3bd86394-20d8-5992-8201-e621856e9087
```

#### `count <collection>`
Quickly count points in a collection.

```bash
pnpm qdrant count persona-782be8b4-9fd9-5005-9358-5605f63ead99
```

#### `stats <collection>`
Show comprehensive statistics including personality breakdown and time ranges.

```bash
pnpm qdrant stats persona-782be8b4-9fd9-5005-9358-5605f63ead99
```

Sample output:
```
📊 Statistics for persona-782be8b4-9fd9-5005-9358-5605f63ead99
═══════════════════════════════════════════════════════════════
Total points: 724
Indexed vectors: 0
Segments: 2

Personalities:
  c296b337-4e67-5337-99a3-4ca105cbbd68: 92 points
  8610b8f5-a567-43f7-a4bb-1840458b18e2: 4 points

Time range:
  Earliest: 2024-07-26T16:03:14.021Z
  Latest: 2025-10-27T04:50:36.903Z
```

#### `sample <collection> [limit]`
View sample points from a collection (default: 5).

```bash
pnpm qdrant sample persona-782be8b4-9fd9-5005-9358-5605f63ead99 3
```

#### `vacuum [--dry-run]`
Remove empty collections to clean up the database.

```bash
# Preview what would be deleted
pnpm qdrant vacuum --dry-run

# Actually delete empty collections
pnpm qdrant vacuum
```

#### `delete <collection> --force`
**⚠️ DANGEROUS**: Delete an entire collection. Requires `--force` flag.

```bash
pnpm qdrant delete personality-old-uuid --force
```

### Point Operations

#### `search <collection> <query> [limit]`
Search for points by text content (default: 10 results).

```bash
pnpm qdrant search persona-782be8b4-9fd9-5005-9358-5605f63ead99 "coding"
pnpm qdrant search persona-782be8b4-9fd9-5005-9358-5605f63ead99 "typescript" 20
```

#### `delete-points <collection> [options]`
Delete specific points by filters. **Always use `--dry-run` first!**

**Options:**
- `--personality-id <uuid>` - Filter by personality
- `--start-time <ISO timestamp>` - Filter by start time
- `--end-time <ISO timestamp>` - Filter by end time
- `--dry-run` - Preview deletions without executing

**Example: Clean up problematic conversation**
```bash
# Step 1: Preview what will be deleted
pnpm qdrant delete-points persona-782be8b4-9fd9-5005-9358-5605f63ead99 \
  --personality-id c296b337-4e67-5337-99a3-4ca105cbbd68 \
  --start-time "2025-10-27T05:00:00Z" \
  --end-time "2025-10-27T06:00:00Z" \
  --dry-run

# Step 2: Actually delete (remove --dry-run)
pnpm qdrant delete-points persona-782be8b4-9fd9-5005-9358-5605f63ead99 \
  --personality-id c296b337-4e67-5337-99a3-4ca105cbbd68 \
  --start-time "2025-10-27T05:00:00Z" \
  --end-time "2025-10-27T06:00:00Z"
```

**Example: Delete all memories with a specific personality**
```bash
pnpm qdrant delete-points persona-782be8b4-9fd9-5005-9358-5605f63ead99 \
  --personality-id c296b337-4e67-5337-99a3-4ca105cbbd68 \
  --dry-run
```

## Common Use Cases

### 1. Cleaning up a problematic conversation

When a conversation goes wrong and needs to be removed from memory:

```bash
# Find the exact time range from PostgreSQL conversation_history
# Then delete the corresponding Qdrant memories

pnpm qdrant delete-points <persona-collection> \
  --personality-id <personality-uuid> \
  --start-time "2025-10-27T05:04:00Z" \
  --end-time "2025-10-27T05:12:00Z" \
  --dry-run

# If the preview looks correct, run again without --dry-run
```

### 2. Checking memory usage

See how many memories exist for a user across different personalities:

```bash
pnpm qdrant stats persona-<user-persona-id>
```

### 3. Finding specific conversations

Search for keywords in a user's memories:

```bash
pnpm qdrant search persona-<user-persona-id> "keyword"
```

### 4. Database maintenance

Remove empty collections to keep Qdrant clean:

```bash
pnpm qdrant vacuum --dry-run
pnpm qdrant vacuum
```

## Safety Features

- **Dry-run mode**: All destructive operations support `--dry-run` to preview changes
- **Force flags**: Dangerous operations like deleting entire collections require `--force`
- **Preview before delete**: `delete-points` always shows what will be deleted before executing
- **Detailed logging**: Clear output shows exactly what's happening

## Future: Slash Command Integration

This CLI is designed to eventually be exposed as Discord slash commands:

```
/qdrant stats                    → Show your memory statistics
/qdrant search <query>           → Search your memories
/qdrant cleanup [time-range]     → Request memory cleanup (admin only)
```

The clean separation of commands makes it easy to map CLI operations to slash command handlers.

## Environment Variables

Required environment variables (automatically loaded from `.env`):

```bash
QDRANT_URL=https://your-qdrant-cluster.cloud.qdrant.io:6333
QDRANT_API_KEY=your-api-key
```

## Technical Notes

### Collection Naming

- **Persona collections**: `persona-{personaId}` - v3 format, stores memories per user persona
- **Legacy collections**: `persona-legacy-{shapesIncUserId}` - imported from shapes.inc backups
- **Personality collections**: `personality-{personalityId}` - old format, being phased out

### Point Payload Structure

```typescript
{
  personalityId: string;      // Which personality this memory is from
  personalityName: string;    // Display name of personality
  content: string;            // The actual memory text
  userId: string;             // User UUID (v3 format)
  personaId: string;          // Persona UUID (v3 format)
  canonScope: string;         // "personal" | "global" | "session"
  summaryType: string;        // "conversation" | "event" | etc
  createdAt: number;          // Unix timestamp in milliseconds
  channelId: string;          // Discord channel ID
  guildId?: string;           // Discord guild ID (if in server)
}
```

### Timestamp Handling

All timestamps in Qdrant are stored as Unix timestamps in **milliseconds** (JavaScript `Date.now()` format).

When filtering by time:
- Use ISO 8601 format: `"2025-10-27T05:04:00Z"`
- The CLI automatically converts to milliseconds
- Times are interpreted in UTC

## Troubleshooting

### "Collection not found"

Make sure you're using the correct collection name format. Use `pnpm qdrant list` to see all available collections.

### "No matching points found"

Check your filters:
- Verify the personality ID is correct (use `stats` to see which personalities exist)
- Ensure your time range includes the timestamps (use `sample` to see example timestamps)
- Remember: times are in UTC

### "Must provide at least one filter"

The `delete-points` command requires either:
- A personality ID, OR
- A time range (start-time and end-time), OR
- Both

This prevents accidentally deleting all points in a collection.

## Contributing

When adding new commands:

1. Add the function implementation
2. Add the switch case in `main()`
3. Update the help text
4. Update this documentation
5. Consider future slash command integration

Keep commands focused and composable - each command should do one thing well.
