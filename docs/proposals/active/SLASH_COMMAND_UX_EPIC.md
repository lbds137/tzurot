# Slash Command UX Improvement Epic

> **Status**: Complete ✅
> **Created**: 2026-01-23
> **Priority**: High (UX consistency)
> **Estimated Sessions**: 4-6

## Executive Summary

This epic standardizes CRUD UX patterns across all slash commands. Commands become **gateways** to rich UI experiences (dashboards), not actions themselves.

### Key Principles

1. **Commands are Gateways**: `/preset new` opens a modal, not a form with 10 options
2. **Dashboards are Command Centers**: All editing, viewing, and deletion happens in dashboards
3. **Browse Combines List + Search**: One command `/resource browse [query?]` replaces separate list/search
4. **Autocomplete is Consistent**: Same emoji patterns, same metadata format across all commands

### Resources Covered

| Resource      | New Command         | Browse Command           | Status      |
| ------------- | ------------------- | ------------------------ | ----------- |
| **Preset**    | `/preset create`    | `/preset browse [query]` | ⬅️ FIRST    |
| **Character** | `/character create` | `/character browse`      | Planned     |
| **Persona**   | `/persona new`      | `/persona browse`        | Planned     |
| **Memory**    | N/A (auto-created)  | `/memory search`         | ✅ Complete |

---

## Table of Contents

1. [Gateway & Dashboard Pattern](#gateway--dashboard-pattern)
2. [Browse Command Pattern](#browse-command-pattern)
3. [Autocomplete Standardization](#autocomplete-standardization)
4. [Dashboard Integration](#dashboard-integration)
5. [Implementation Phases](#implementation-phases)
6. [Migration Strategy](#migration-strategy)
7. [Bug Fixes](#bug-fixes)

---

## Gateway & Dashboard Pattern

### Philosophy

Commands should be **gateways** to UI, not CLI actions with many flags. Discord's slash command interface is limited - modals, buttons, and embeds are powerful.

```
Traditional CLI Thinking (BAD):
/preset create --name "My Preset" --model "claude-3" --temperature 0.8 --topP 0.9 ...

Gateway Thinking (GOOD):
/preset create → Modal (name only) → Dashboard (all settings)
```

### Command Flow

```
┌─────────────────┐
│ /preset create  │ ────► Modal (name, optional seed) ────► Dashboard
└─────────────────┘

┌─────────────────────────┐
│ /preset browse [query?] │ ────► Paginated List ────► Select ────► Dashboard
└─────────────────────────┘
```

### Dashboard Responsibilities

The dashboard is the **single source of truth** for resource management:

| Action     | UI Element      | Confirmation Required |
| ---------- | --------------- | --------------------- |
| View       | Embed fields    | No                    |
| Edit       | "Edit" button   | No (modal is safe)    |
| Delete     | "Delete" button | Yes (danger button)   |
| Duplicate  | "Clone" button  | No                    |
| Set Active | "Use" button    | No                    |

### Dashboard Button Layout

```
┌──────────────────────────────────────────────────────────┐
│  📋 Preset: My Claude Config                             │
│  ─────────────────────────────────────────────────────── │
│  Model: anthropic/claude-sonnet-4                        │
│  Temperature: 0.8                                        │
│  Max Tokens: 4000                                        │
│  ...                                                     │
├──────────────────────────────────────────────────────────┤
│  [✏️ Edit]  [📋 Clone]  [✓ Use]  [🗑️ Delete]            │
└──────────────────────────────────────────────────────────┘
```

---

## Browse Command Pattern

### Naming Decision

**Use `/resource browse`** (not "list", "library", or "search").

Rationale:

- "browse" implies exploration, which can include search
- "list" is too simplistic (doesn't convey search capability)
- "library" is awkward as a verb ("library my presets?")
- "search" implies you need to know what you're looking for

### Command Signature

```
/preset browse [query] [filter]
             │        │
             │        └── Optional: scope filter (mine, global, all)
             └── Optional: text/semantic search query
```

### Behavior

| Invocation                   | Result                                 |
| ---------------------------- | -------------------------------------- |
| `/preset browse`             | Show all presets, paginated            |
| `/preset browse claude`      | Search for "claude" in name/model      |
| `/preset browse filter:mine` | Show only user's presets               |
| `/preset browse claude mine` | Search "claude" in user's presets only |

### Pagination UI

```
┌──────────────────────────────────────────────────────────┐
│  📚 Presets (Page 1/3)                                   │
│  ─────────────────────────────────────────────────────── │
│  🌍 Global Default · claude-sonnet-4 · temp 0.7         │
│  🌍 Fast & Free · meta-llama/llama-3.3-70b · temp 0.8   │
│  👤 My Creative · claude-sonnet-4 · temp 1.2            │
│  🔒 Locked Preset · gemini-2.5-pro · (locked)           │
│  ...                                                     │
├──────────────────────────────────────────────────────────┤
│  [◀ Prev]  Page 1 of 3  [Next ▶]                        │
│  [Select: ▼ Choose a preset to view...]                 │
└──────────────────────────────────────────────────────────┘
```

---

## Autocomplete Standardization

### Current State (Inconsistent)

| Command           | Format                              | Emojis |
| ----------------- | ----------------------------------- | ------ |
| `/me preset set`  | `{name} (slug)` or just `{name}`    | None   |
| `/character chat` | `🌐 Name (slug)` / `🔒 Name (slug)` | Yes    |
| `/memory list`    | `{personality.name}`                | None   |
| `/preset edit`    | `{name}`                            | None   |

### Target Format

```
[Scope Emoji] [Name] · [Short Metadata]
```

Examples:

```
🌍 Global Default · claude-sonnet-4
👤 My Creative Config · claude-sonnet-4, temp 1.2
🔒 Server Locked · gemini-2.5-pro (locked)
🌐 Aria · public personality
📖 My Custom Char · private
```

### Emoji Semantics

| Emoji | Meaning                         | Use When                          |
| ----- | ------------------------------- | --------------------------------- |
| 🌍    | Global (system-provided)        | Built-in presets, global defaults |
| 👤    | Personal (user-owned)           | User-created resources            |
| 🔒    | Locked (server-restricted)      | Admin-locked settings             |
| 🌐    | Public (discoverable)           | Public personalities              |
| 📖    | Private (only visible to owner) | Private personalities             |

### Implementation: Shared Utility

```typescript
// packages/common-types/src/utils/autocompleteFormat.ts

export interface AutocompleteFormatOptions {
  name: string;
  scope: 'global' | 'personal' | 'locked' | 'public' | 'private';
  metadata?: string; // e.g., "claude-sonnet-4" or "temp 1.2"
}

const SCOPE_EMOJIS = {
  global: '🌍',
  personal: '👤',
  locked: '🔒',
  public: '🌐',
  private: '📖',
} as const;

export function formatAutocompleteOption(options: AutocompleteFormatOptions): string {
  const { name, scope, metadata } = options;
  const emoji = SCOPE_EMOJIS[scope];

  if (metadata) {
    return `${emoji} ${name} · ${metadata}`;
  }
  return `${emoji} ${name}`;
}
```

### Autocomplete Performance

For commands with potentially many options (personalities, presets):

1. **Limit to 25 results** (Discord's max)
2. **Prioritize user's own resources** (show first)
3. **Use fuzzy matching** on name + metadata
4. **Cache autocomplete data** (short TTL, ~30s)

---

## Dashboard Integration

### Deletion Flow

Deletion lives in the dashboard, not as a separate command.

```
User clicks [🗑️ Delete] button
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  ⚠️ Delete Preset?                                       │
│  ─────────────────────────────────────────────────────── │
│  Are you sure you want to delete "My Creative Config"?   │
│  This action cannot be undone.                           │
├──────────────────────────────────────────────────────────┤
│  [Cancel]                              [🗑️ Delete]       │
│                                        (Danger style)    │
└──────────────────────────────────────────────────────────┘
```

### Edit Flow

Edit opens a modal pre-filled with current values:

```
User clicks [✏️ Edit] button
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  Edit Preset: My Creative Config                         │
├──────────────────────────────────────────────────────────┤
│  Name: [My Creative Config________________]              │
│  Model: [Select model...___________▼]                    │
│  Temperature: [1.2____]                                  │
│  ...                                                     │
├──────────────────────────────────────────────────────────┤
│  [Cancel]                              [💾 Save]         │
└──────────────────────────────────────────────────────────┘
```

### Session Management

Dashboards use Redis sessions (already implemented in PR #483):

```typescript
// DashboardSessionManager pattern
const session = await sessionManager.create({
  userId: interaction.user.id,
  resourceType: 'preset',
  resourceId: preset.id,
  messageId: reply.id,
});

// Button handler retrieves session
const session = await sessionManager.getByMessageId(interaction.message.id);
```

---

## Implementation Phases

### Phase 1: `/preset browse` Prototype (FIRST) ✅

Implement the full pattern on presets first:

- [x] Create `/preset browse [query] [filter]` command
- [x] Implement paginated list with emoji formatting
- [x] Add select menu → dashboard flow
- [x] Move deletion into dashboard
- [x] Add "Clone" functionality
- [x] Audit and fix autocomplete in `/me preset`

### Phase 2: Autocomplete Utility ✅

- [x] Create `formatAutocompleteOption()` in common-types (already existed)
- [x] Update `personaAutocomplete.ts` to use standard utility
- [x] Update `modelAutocomplete.ts` to use standard utility (now shows 🆓 for free models)
- [x] Verify all handlers use consistent formatting via shared utilities
- [x] Standardize emoji usage across commands (AUTOCOMPLETE_BADGES)

### Phase 3: Character Commands ✅

- [x] Create `/character browse [query]` (already existed)
- [x] Add select menu → dashboard flow
- [x] Integrate deletion into character dashboard (already existed)
- [x] Standardize character autocomplete (uses visibility icons)

### Phase 4: Persona/Profile Commands ✅

- [x] Convert `/me profile edit` to dashboard pattern
- [x] Integrate deletion into profile dashboard
- [x] Profile autocomplete working

### Phase 5: Documentation & Cleanup ✅

- [x] Update INTERACTION_PATTERNS.md with new patterns
- [x] Remove deprecated list/search commands (none needed)
- [x] Update tzurot-slash-command-ux skill

---

## Migration Strategy

### Hard Cut (Beta Phase)

Since we're in public beta with few users:

- **No deprecation warnings** - just replace commands
- **No dual command period** - old commands removed immediately
- **Changelog communication** - document breaking changes in release notes

### Command Renames

| Old Command       | New Command            | Action  |
| ----------------- | ---------------------- | ------- |
| `/preset list`    | `/preset browse`       | Rename  |
| `/preset search`  | `/preset browse query` | Merge   |
| `/preset edit`    | Keep (opens dashboard) | Enhance |
| `/preset delete`  | Remove (use dashboard) | Remove  |
| `/character list` | `/character browse`    | Rename  |

---

## Bug Fixes

### Global Free Default Not Filtering to Free Models

**Location**: `services/bot-client/src/utils/modelAutocomplete.ts`

**Problem**: When user selects "Global Free Default" preset, the model autocomplete doesn't filter to only show free models.

**Fix**: Add `freeOnly` option to model autocomplete:

```typescript
interface ModelAutocompleteOptions {
  query: string;
  freeOnly?: boolean; // Filter to free models only
}

async function getModelAutocomplete(options: ModelAutocompleteOptions) {
  const { query, freeOnly } = options;

  let models = await fetchAvailableModels();

  if (freeOnly) {
    models = models.filter(m => m.pricing?.prompt === '0' || m.isFree);
  }

  // ... rest of autocomplete logic
}
```

**Related**: This fix should be part of Phase 2 (Autocomplete Utility).

---

## References

- [INTERACTION_PATTERNS.md](../../reference/standards/INTERACTION_PATTERNS.md) - Current button/modal patterns
- [Memory Management Commands](MEMORY_MANAGEMENT_COMMANDS.md) - Example of dashboard pattern
- [MCP Council Discussion](N/A) - Gateway pattern recommendation
- [Redis Session Manager](../../../services/bot-client/src/utils/dashboardSessionManager.ts) - Session management

---

## Success Criteria

1. **Consistency**: All CRUD operations follow the same UX pattern
2. **Discoverability**: Users can browse resources without knowing exact names
3. **Safety**: Destructive operations require confirmation in dashboards
4. **Performance**: Autocomplete responds in <100ms with cached data
5. **Accessibility**: Emoji usage is semantic and consistent
