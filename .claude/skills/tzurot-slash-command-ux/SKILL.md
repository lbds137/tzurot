---
name: tzurot-slash-command-ux
description: Use when implementing Discord slash commands, building list/browse UX, adding buttons or pagination, or creating dashboard patterns. Covers standard naming, shared utilities, and confirmation flows.
lastUpdated: '2026-01-18'
---

# Slash Command UX Patterns

**Use this skill when:**

- Implementing a new slash command or subcommand
- Adding list/browse functionality with pagination
- Creating button-based interactions (confirm, navigate)
- Building dashboard-style editors

## Quick Reference

### Standard Subcommand Names

| Subcommand | Purpose            | Example                 |
| ---------- | ------------------ | ----------------------- |
| `list`     | Show all items     | `/memory list`          |
| `view`     | Single item detail | `/character view`       |
| `create`   | Create new item    | `/preset create`        |
| `edit`     | Modify item        | `/character edit`       |
| `delete`   | Remove item        | `/preset delete`        |
| `set`      | Set a value        | `/me settings timezone` |
| `clear`    | Remove/reset value | `/me overrides clear`   |

### Key Files

| File                                               | Purpose                             |
| -------------------------------------------------- | ----------------------------------- |
| `src/utils/listSorting.ts`                         | Shared sorting comparators          |
| `src/utils/paginationBuilder.ts`                   | Shared pagination buttons (TODO)    |
| `src/utils/customIds.ts`                           | Custom ID parsing/generation        |
| `src/utils/dashboard/settings/types.ts`            | Settings custom ID builders/parsers |
| `docs/reference/standards/SLASH_COMMAND_UX.md`     | Full UX documentation               |
| `docs/reference/standards/INTERACTION_PATTERNS.md` | State passing patterns guide        |

## Pagination Pattern

### Button Layout

```
[◀ Previous] [Page 1 of 5] [Next ▶] [🔤 Sort A-Z]
```

### Custom ID Format

```typescript
// Custom IDs encode action, page, and sort type
const customId = `${prefix}:page:${pageNum}:${sortType}`;
// Example: "memory:page:2:date" or "character:sort:0:name"
```

### Implementation Pattern

```typescript
// 1. Define constants
const ITEMS_PER_PAGE = 15;
const DEFAULT_SORT: ListSortType = 'date';

// 2. Use shared comparator from listSorting.ts
import { createListComparator } from '../../utils/listSorting.js';
const comparator = createListComparator<ItemType>(
  item => item.name, // name accessor for A-Z sort
  item => item.createdAt // date accessor for chronological
);

// 3. Build pagination buttons
function buildButtons(page: number, totalPages: number, sort: ListSortType) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`prefix:page:${page - 1}:${sort}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0)
    // ... page indicator, next button, sort toggle
  );
}

// 4. Handle button clicks
collector.on('collect', (interaction: ButtonInteraction) => {
  const parsed = parseCustomId(interaction.customId);
  // Re-fetch data, re-sort, update embed
  await interaction.update({ embeds: [newEmbed], components: [newButtons] });
});
```

## Dashboard Pattern

Use for entities with **6+ editable fields** that don't fit in a single modal.

### Flow

```
1. /command create → Minimal seed modal (3-4 required fields)
2. Entity created → Dashboard embed with section menu
3. User selects section → Section modal (max 5 fields)
4. Submit → Dashboard refreshes
```

### Status Indicators

| Status   | Emoji | Meaning             |
| -------- | ----- | ------------------- |
| Complete | ✅    | All required filled |
| Partial  | ⚠️    | Some optional empty |
| Empty    | ❌    | Required missing    |

**Example:** `/character edit` uses this pattern for personality settings.

## Confirmation Patterns

### Destructive Actions

```typescript
// Level 1: Simple button confirm (single item)
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId(`delete:${itemId}`)
    .setLabel('Delete')
    .setStyle(ButtonStyle.Danger) // Red button for destructive
);
```

```typescript
// Level 2: Typed confirmation (bulk operations)
const modal = new ModalBuilder()
  .setCustomId(`purge-confirm:${entityId}`)
  .setTitle('Confirm Deletion')
  .addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('confirmation')
        .setLabel('Type "DELETE ALL" to confirm')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );
```

## Response Types

### When to Use Ephemeral

```typescript
// ✅ Use ephemeral for:
await interaction.reply({
  content: 'Settings updated',
  flags: MessageFlags.Ephemeral, // Private to user
});
// - User settings/preferences
// - Error messages
// - Dashboard interactions
// - Sensitive data (API keys, stats)

// ✅ Use public for:
// - Character/personality displays others might want to see
// - Help text (optional - can be ephemeral too)
```

### Defer for Slow Operations

```typescript
// If operation takes >3 seconds
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
// ... slow database/API call ...
await interaction.editReply({ content: 'Done!' });
```

## Error Handling

```typescript
// ❌ BAD - Vague error
await interaction.reply({ content: '❌ Error', flags: MessageFlags.Ephemeral });

// ✅ GOOD - Actionable error
await interaction.reply({
  content: '❌ Character not found.\n\nUse `/character list` to see available characters.',
  flags: MessageFlags.Ephemeral,
});
```

## Autocomplete

Use for **entity selection** (characters, presets, personalities) and **large lists** (>10 items).

```typescript
export async function autocomplete(interaction: AutocompleteInteraction) {
  const query = interaction.options.getFocused().toLowerCase();

  const results = allItems.filter(item => item.name.toLowerCase().includes(query)).slice(0, 25); // Discord limit

  await interaction.respond(
    results.map(item => ({
      name: item.displayName, // What user sees
      value: item.id, // What gets submitted
    }))
  );
}
```

## Anti-Patterns

| ❌ Don't                                 | ✅ Do                                |
| ---------------------------------------- | ------------------------------------ |
| Expose internal concepts (`/llm-config`) | Use user-friendly names (`/preset`)  |
| Duplicate pagination code                | Use shared `paginationBuilder.ts`    |
| Delete without confirmation              | Always confirm destructive actions   |
| Show sensitive data publicly             | Use ephemeral for user-specific data |
| Inconsistent naming (`add` vs `create`)  | Use standard subcommand names        |

## Related Skills

- **tzurot-architecture** - Service boundaries for command handlers
- **tzurot-testing** - Testing button interactions and collectors
- **tzurot-types** - Shared response types and Zod schemas

## References

- Full UX documentation: `docs/reference/standards/SLASH_COMMAND_UX.md`
- **State passing patterns**: `docs/reference/standards/INTERACTION_PATTERNS.md`
- Features & implementation: `docs/reference/features/SLASH_COMMAND_UX_FEATURES.md`
- Character list example: `services/bot-client/src/commands/character/list.ts`
- Channel list example: `services/bot-client/src/commands/channel/list.ts`
- Shared sorting: `services/bot-client/src/utils/listSorting.ts`
