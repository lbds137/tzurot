# Discord Interaction State Patterns

**Applies to**: all button, select-menu, and modal interactions in bot-client.

Discord interactions arrive as separate events from the command that produced
them, so any state the follow-up needs must be carried somewhere. Two patterns
carry it, and a routing rule governs how the follow-up reaches your code at all.

## Pattern summary

| Pattern              | Carries                                   | Where it lives            | Capacity              | Lifetime        |
| -------------------- | ----------------------------------------- | ------------------------- | --------------------- | --------------- |
| **Custom ID params** | Entity ids, action names, page/filter     | The component's custom id | 100 chars (Discord)   | Permanent       |
| **SessionManager**   | Multi-step dashboard state, unsaved edits | Redis                     | Practically unlimited | 15 min, sliding |

Choosing between them:

- The follow-up only needs to know _which entity_ and _which action_ → custom id.
- The user edits data across several screens before saving, or the state doesn't
  fit in 100 characters → SessionManager.

## Routing rule: no collectors as the primary handler

Component interactions **must** be routed through `CommandHandler` by exporting
`handleButton` / `handleSelectMenu` / `handleModal` from `defineCommand()`.
`createMessageComponentCollector` and `awaitMessageComponent` must not be the
primary handler — collectors die on restart, don't work across replicas, and
race with the global interaction handler. The constraint and its narrow
in-handler exception live in `.claude/rules/04-discord.md` § Component
Interaction Routing; today the only remaining collector in the codebase is the
sanctioned secondary use inside `commands/memory/batchDelete.ts`.

The practical consequence for this document: state cannot live in a closure.
It goes in the custom id or in a session.

## Pattern 1: custom ID params

`::` is the delimiter everywhere (`CUSTOM_ID_DELIMITER`). Never split on it by
hand — use the centralized builders and parsers.

### Settings dashboards

```typescript
import { buildSettingsCustomId, parseSettingsCustomId } from '../utils/dashboard/settings/types.js';

buildSettingsCustomId('channel-settings', 'select', channelId);
// 'channel-settings::select::123456789012345678'

buildSettingsCustomId('admin-settings', 'set', 'global', 'enabled:true');
// 'admin-settings::set::global::enabled:true'

parseSettingsCustomId('channel-settings::select::123456789012345678');
// { entityType, action, entityId, extra? } — or null if fewer than 3 segments
```

### Per-domain helpers

`services/bot-client/src/utils/customIds.ts` exports one const-object of
builders/parsers per command domain: `CharacterCustomIds`, `PersonaCustomIds`,
`PresetCustomIds`, `ChannelCustomIds`, `ApikeyCustomIds`, `ShapesCustomIds`, and
`DestructiveCustomIds`. `getCommandFromCustomId` extracts the owning command
from any of them.

### Browse pagination

Browse commands don't hand-roll their custom ids — `createBrowseCustomIdHelpers`
(`utils/browse/customIdFactory.ts`) generates a typed builder/parser pair per
resource:

```
{prefix}::browse::{page}::{filter}[::{sort}]::{query}
{prefix}::browse-select::{page}::{filter}[::{sort}]::{query}
{prefix}::browse::info
```

The `sort` segment is present only when the helper is created with
`includeSort` left at its default; `includeSort: false` strips it from both the
format and the parse result's type. A resource with a non-default sort union
must pass a matching `validSorts` — the overloads make omitting it a compile
error rather than a silent fall-back to `'name'`. The trailing query segment is
truncated to stay inside Discord's 100-character limit.

### Guidelines

1. Always use the centralized builders/parsers — never `customId.split('::')`.
2. Hyphenate entity types: `channel-settings`, not `channel_settings`.
3. Keep the whole id under 100 characters; put anything larger in a session or
   an embed field.
4. No sensitive data — custom ids are visible client-side.

## Pattern 2: SessionManager

`DashboardSessionManager` (`utils/dashboard/SessionManager.ts`) is
**Redis-backed**, not an in-memory map — sessions survive a restart and work
across replicas. Every method is async.

Initialize once at startup with `initSessionManager(redis)`, then reach it via
`getSessionManager()`.

```typescript
import { getSessionManager } from '../utils/dashboard/SessionManager.js';

await getSessionManager().set({
  userId,
  entityType: 'character',
  entityId: characterSlug,
  data: { name: 'Original Name', unsavedChanges: false },
  messageId: message.id,
  channelId: interaction.channelId,
});

await getSessionManager().update(userId, 'character', characterSlug, {
  name: 'New Name',
  unsavedChanges: true,
});

const session = await getSessionManager().get(userId, 'character', characterSlug);
if (session?.data.unsavedChanges === true) {
  // prompt to save or discard
}
```

Beyond `set` / `get` / `update` / `delete`, the manager offers `touch` (extend
without changing data), `findByMessageId` (a message→session index is written
alongside every session with the same TTL), `getUserSessions`, and
`getSessionCount`.

### Lifetime

15 minutes, refreshed on `set`, `update`, and `touch` — so an active dashboard
doesn't expire under the user. `get` on an expired session returns `null`.

### Guidelines

1. **Always null-check.** Sessions expire; a stale button click is normal, not
   exceptional.
2. **Store only JSON-serializable data.** Sessions round-trip through
   `JSON.stringify` and are validated by a Zod schema on read. Functions become
   `undefined` on rehydration — a dev-mode guard
   (`assertSessionDataIsSerializable`) fails loudly on `set` rather than letting
   that reach a confusing runtime error.
3. **Corrupt data self-heals**: a parse or schema failure on read deletes the
   key and returns `null`.
4. **Clean up on completion** so an abandoned key doesn't linger for its full
   TTL.

## Combining the two

The settings dashboard uses both: the custom id identifies the channel and the
setting being touched, while the session holds the current view and the working
copy of the data. Browse-to-dashboard flows do the same — the browse select
menu's value is the entity id (custom id), and opening the detail view creates
the session the dashboard then reads.

## Autocomplete formatting

All autocomplete goes through `formatAutocompleteOption`
(`packages/common-types/src/utils/autocompleteFormat.ts`), which produces:

```
[scopeBadge][statusBadges…] Name (identifier) · metadata
```

Badges render with no space between them and one space before the name;
`identifier` and `metadata` are both optional. At most **2** status badges are
emitted (extras are dropped). The result is truncated to Discord's option-name
limit, preferring to shorten the name and preserve the metadata suffix.

```typescript
import {
  formatAutocompleteOption,
  AUTOCOMPLETE_BADGES,
} from '@tzurot/common-types/utils/autocompleteFormat';

formatAutocompleteOption({
  name: 'Global Default',
  value: 'config-id-123',
  scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
  statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT],
  metadata: 'claude-sonnet-4',
});
// { name: '🌐⭐ Global Default · claude-sonnet-4', value: 'config-id-123' }
```

Badges are split into **scope** (mutually exclusive — pick one: `GLOBAL`,
`OWNED`, `PUBLIC`, `OWNED_BY_OTHER`) and **status** (combinable — `DEFAULT`,
`ACTIVE`, `FREE`, `LOCKED`, `NEEDS_KEY`, `VISION`, and others). The full set
lives in the `AUTOCOMPLETE_BADGES` constant with a doc comment per entry; read
it there rather than trusting a copy — it grows with the feature set.

Domain-level autocomplete helpers (`handlePersonalityAutocomplete`,
`handlePersonaAutocomplete`) live in
`services/bot-client/src/utils/autocomplete/` and should be reused rather than
reimplemented.

## Related files

- `services/bot-client/src/utils/customIds.ts` — per-domain custom id helpers
- `services/bot-client/src/utils/dashboard/settings/types.ts` — settings custom id builder/parser
- `services/bot-client/src/utils/dashboard/SessionManager.ts` — Redis-backed sessions
- `services/bot-client/src/utils/browse/customIdFactory.ts` — browse custom id factory
- `packages/common-types/src/utils/autocompleteFormat.ts` — autocomplete formatting
- `.claude/rules/04-discord.md` — the routing constraint and the shared-utility table
