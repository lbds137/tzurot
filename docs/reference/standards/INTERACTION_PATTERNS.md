# Discord Interaction State Patterns

**Status**: Standard
**Applies to**: All button, select menu, and modal interactions in Tzurot

## Overview

Discord interactions require state to be passed between the initial command and subsequent button/modal interactions. This document describes the three patterns used in Tzurot and when to use each.

## Pattern Summary

| Pattern               | Use Case                             | State Location      | Capacity   | Persistence       |
| --------------------- | ------------------------------------ | ------------------- | ---------- | ----------------- |
| **Custom ID Params**  | Entity IDs, action types             | In the component ID | <100 chars | Permanent         |
| **SessionManager**    | Multi-step dashboards, unsaved edits | In-memory Map       | Unlimited  | 15min auto-expire |
| **Active Collectors** | Single-message flows, pagination     | Collector closure   | Unlimited  | Until timeout     |

## Decision Matrix

```
┌──────────────────────────────────────────────────────────────────┐
│                  Which Pattern Should I Use?                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Is the state just an entity ID or action type?                  │
│  └─ YES → Custom ID Params                                       │
│  └─ NO  ↓                                                        │
│                                                                   │
│  Does the user edit data before saving?                          │
│  └─ YES → SessionManager                                         │
│  └─ NO  ↓                                                        │
│                                                                   │
│  Is this a single-message flow (pagination, list selection)?     │
│  └─ YES → Active Collector                                       │
│  └─ NO  → SessionManager                                         │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Pattern 1: Custom ID Params

**Best for**: Small, stateless data that can fit in 100 characters.

### Format

```
{entityType}::{action}::{entityId}[::{extra}]
```

### Examples

```typescript
// Building custom IDs
import { buildSettingsCustomId } from '../utils/dashboard/settings/index.js';

const customId = buildSettingsCustomId('channel-settings', 'select', channelId);
// Result: 'channel-settings::select::123456789012345678'

const customIdWithExtra = buildSettingsCustomId('admin-settings', 'set', 'global', 'enabled:true');
// Result: 'admin-settings::set::global::enabled:true'
```

```typescript
// Parsing custom IDs
import { parseSettingsCustomId } from '../utils/dashboard/settings/index.js';

const parsed = parseSettingsCustomId('channel-settings::select::123456789012345678');
// Result: { entityType: 'channel-settings', action: 'select', entityId: '123456789012345678' }
```

### When to Use

- ✅ Passing channel IDs, user IDs, personality slugs
- ✅ Identifying which action was triggered (select, set, back, close)
- ✅ Stateless operations (the same ID always means the same thing)
- ❌ Large data (>100 chars total)
- ❌ Data that changes during the interaction flow

### Current Implementations

| Component          | Entity Type          | Parser                  |
| ------------------ | -------------------- | ----------------------- |
| Channel Settings   | `channel-settings`   | `parseSettingsCustomId` |
| Character Settings | `character-settings` | `parseSettingsCustomId` |
| Admin Settings     | `admin-settings`     | `parseSettingsCustomId` |
| Settings API Key   | `settings`           | `ApikeyCustomIds`       |
| Character Commands | `character`          | `CharacterCustomIds`    |
| Persona Commands   | `persona`            | `PersonaCustomIds`      |

## Pattern 2: SessionManager

**Best for**: Multi-step flows where users edit data before saving.

### How It Works

1. User opens a dashboard → Session created with initial data
2. User makes changes → Session data updated (not yet saved)
3. User clicks Save → Changes persisted to database, session cleared
4. Session expires → After 15 minutes of inactivity

### Example Usage

```typescript
import { getSessionManager, type DashboardSession } from '../utils/dashboard/index.js';

// Create session when dashboard opens
const session = getSessionManager().set({
  userId,
  entityType: 'character',
  entityId: characterSlug,
  data: { name: 'Original Name', unsavedChanges: false },
  messageId: message.id,
  channelId: interaction.channelId,
});

// Update session when user makes changes
getSessionManager().update(userId, 'character', characterSlug, {
  name: 'New Name',
  unsavedChanges: true,
});

// Retrieve session on button click
const session = getSessionManager().get(userId, 'character', characterSlug);
if (session?.data.unsavedChanges) {
  // Prompt to save or discard
}
```

### When to Use

- ✅ Dashboard patterns with multiple screens
- ✅ Edit flows where changes aren't immediately saved
- ✅ Data too large for custom IDs
- ✅ Multi-step wizards
- ❌ Simple stateless interactions
- ❌ Cross-instance scenarios (scaling)

### Scaling Note

The current `DashboardSessionManager` uses an in-memory Map. For horizontal scaling across multiple bot instances, this would need to be replaced with Redis-backed storage. The interface is designed for this migration.

## Pattern 3: Active Collectors

**Best for**: Single-message interaction flows with pagination or selection.

### How It Works

1. Command sends a message with components
2. `createMessageComponentCollector` listens for interactions on that specific message
3. Collector handles all button/select interactions
4. Collector times out or is explicitly stopped

### Example Usage

```typescript
import {
  registerActiveCollector,
  deregisterActiveCollector,
} from '../utils/activeCollectorRegistry.js';

const collector = message.createMessageComponentCollector({
  time: COLLECTOR_TIMEOUT_MS,
});

// Register to prevent duplicate collectors
registerActiveCollector(message.id, collector);

collector.on('collect', async interaction => {
  // Handle button/select interaction
  // State is in closure scope - no need to pass via custom ID
});

collector.on('end', () => {
  deregisterActiveCollector(message.id);
  // Disable buttons
});
```

### When to Use

- ✅ Pagination (next/prev buttons)
- ✅ List selection followed by detail view
- ✅ Flows contained to a single message
- ❌ Interactions that span multiple messages
- ❌ Long-lived flows (collectors timeout)

### Registry Pattern

The `activeCollectorRegistry` prevents duplicate collectors when a message is re-created:

```typescript
// Check for existing collector before creating new one
const existing = getActiveCollector(messageId);
if (existing) {
  existing.stop('replaced');
}

// Create and register new collector
const collector = message.createMessageComponentCollector({ ... });
registerActiveCollector(messageId, collector);
```

## Combining Patterns

Many features use multiple patterns together:

### Settings Dashboard Example

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User runs /channel settings                                  │
│    → Custom ID params store: channelId                          │
│    → SessionManager stores: current view, setting data          │
│                                                                  │
│ 2. User clicks setting button                                   │
│    → Custom ID identifies: which setting (via extra param)      │
│    → SessionManager provides: current data to display           │
│                                                                  │
│ 3. User changes value via modal                                 │
│    → Custom ID identifies: setting being changed                │
│    → API call persists change immediately                       │
│    → SessionManager updated with new data                       │
└─────────────────────────────────────────────────────────────────┘
```

### Memory List Example

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User runs /memory list                                       │
│    → Active Collector handles all button interactions           │
│    → State (page, filter) stored in collector closure           │
│                                                                  │
│ 2. User clicks Next Page                                        │
│    → Collector receives interaction                             │
│    → Fetches next page from API                                 │
│    → Updates message with new data                              │
│                                                                  │
│ 3. User clicks memory to view details                           │
│    → Collector handles selection                                │
│    → Memory ID passed via custom ID                             │
│    → Detail view rendered                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Browse Pattern: Select Menu → Dashboard

**New in v3**: The browse pattern provides a standardized way to navigate from a list to a detail view.

### Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User runs /preset browse                                     │
│    → Paginated list with select menu and buttons                │
│                                                                  │
│ 2. User selects item from dropdown                              │
│    → Select menu value is entity ID                             │
│    → Dashboard opens for selected item                          │
│    → SessionManager tracks dashboard state                      │
│                                                                  │
│ 3. User interacts with dashboard                                │
│    → Same dashboard behavior as /preset edit                    │
│    → Can edit, delete, refresh, close                           │
└─────────────────────────────────────────────────────────────────┘
```

### Components

1. **Paginated Embed** - Shows list items with emojis/badges
2. **Select Menu** - Allows picking any item on current page
3. **Pagination Buttons** - Next/Previous/Sort toggle
4. **Dashboard Integration** - Same dashboard as edit command

### Custom ID Format

```
// Browse pagination
{resource}::browse::{page}::{filter}::{query}

// Browse select menu (static - value is the entity ID)
{resource}::browse-select
```

### Implementation Files

- `services/bot-client/src/commands/preset/browse.ts` - Reference implementation
- `services/bot-client/src/commands/character/browse.ts` - Similar pattern

## Autocomplete Formatting Standard

All autocomplete across the bot uses the shared `formatAutocompleteOption` utility for consistency.

### Format

```
[ScopeBadge][StatusBadges] Name (identifier) · metadata
```

### Badges

| Badge | Constant                        | Meaning                             |
| ----- | ------------------------------- | ----------------------------------- |
| 🌐    | `AUTOCOMPLETE_BADGES.GLOBAL`    | System-provided resource            |
| 🔒    | `AUTOCOMPLETE_BADGES.OWNED`     | User-created, only visible to owner |
| 🌍    | `AUTOCOMPLETE_BADGES.PUBLIC`    | User-created but shared publicly    |
| 📖    | `AUTOCOMPLETE_BADGES.READ_ONLY` | Visible but not editable            |
| ⭐    | `AUTOCOMPLETE_BADGES.DEFAULT`   | Currently active/default            |
| 🆓    | `AUTOCOMPLETE_BADGES.FREE`      | Uses free tier model                |
| 🔐    | `AUTOCOMPLETE_BADGES.LOCKED`    | Admin-locked                        |

### Example Usage

```typescript
import {
  formatAutocompleteOption,
  AUTOCOMPLETE_BADGES,
} from '@tzurot/common-types/utils/autocompleteFormat';

const choice = formatAutocompleteOption({
  name: 'Global Default',
  value: 'config-id-123',
  scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
  statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT],
  metadata: 'claude-sonnet-4',
});
// Result: { name: "🌐⭐ Global Default · claude-sonnet-4", value: "config-id-123" }
```

### Implementation Files

- `packages/common-types/src/utils/autocompleteFormat.ts` - Utility implementation
- `services/bot-client/src/utils/autocomplete/personalityAutocomplete.ts` - Main personality autocomplete
- `services/bot-client/src/commands/preset/autocomplete.ts` - Preset autocomplete

## Best Practices

### Custom ID Guidelines

1. **Always use centralized builders/parsers** - Never manually split on `::`
2. **Use hyphen-separated entity types** - `channel-settings` not `channel_settings`
3. **Keep total length under 100 chars** - Discord limit
4. **No sensitive data in custom IDs** - They're visible in network requests

### Session Guidelines

1. **Always check for null** - Sessions can expire
2. **Touch sessions on activity** - Prevents premature expiration
3. **Clean up on completion** - Delete sessions when done
4. **Design for Redis migration** - Avoid storing non-serializable data

### Collector Guidelines

1. **Always register collectors** - Prevents duplicates on message update
2. **Clean up on end** - Deregister and disable components
3. **Use reasonable timeouts** - Default 5 minutes for most flows
4. **Handle errors gracefully** - Collectors can fail silently

## Related Files

- `services/bot-client/src/utils/dashboard/settings/types.ts` - Custom ID builders/parsers
- `services/bot-client/src/utils/dashboard/SessionManager.ts` - Session management
- `services/bot-client/src/utils/activeCollectorRegistry.ts` - Collector registry
- `services/bot-client/src/utils/paginationBuilder.ts` - Pagination custom IDs
- `services/bot-client/src/utils/customIds.ts` - Domain-specific custom ID helpers
