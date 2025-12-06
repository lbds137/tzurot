# Slash Command Implementation Standards

> **Purpose**: Technical standards for implementing Discord slash commands in Tzurot v3.
> For UX guidelines, see [SLASH_COMMAND_UX.md](./SLASH_COMMAND_UX.md).

## Critical Rules (from Production Incidents)

### 🚨 Rule 1: ALWAYS Use Gateway Clients

**NEVER use direct `fetch()` calls to the API gateway.** This has caused production outages.

**Available Clients** (in `bot-client/src/utils/`):

| Client                             | Purpose                     | When to Use              |
| ---------------------------------- | --------------------------- | ------------------------ |
| `callGatewayApi()`                 | User-authenticated requests | Any `/user/*` endpoint   |
| `adminFetch()` / `adminPostJson()` | Admin-only requests         | Any `/admin/*` endpoint  |
| `GatewayClient`                    | Internal service requests   | Service-to-service calls |

**Correct Pattern:**

```typescript
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const result = await callGatewayApi<PersonalityResponse>('/user/personality', {
  userId: interaction.user.id,
  method: 'POST',
  body: { name, slug },
});

if (!result.ok) {
  // Handle error
}
```

**Wrong Pattern (caused production bug):**

```typescript
// ❌ NEVER DO THIS
const response = await fetch(`${config.GATEWAY_URL}/user/personality`, {
  headers: {
    'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
    'X-Discord-User-Id': userId, // WRONG HEADER NAME!
  },
});
```

**Why This Matters:**

- Gateway clients set correct headers (`X-User-Id` not `X-Discord-User-Id`)
- Gateway clients handle errors consistently
- Gateway clients are tested and trusted

---

### 🚨 Rule 2: Export ALL Interactive Handlers

Commands with interactive components (buttons, select menus) **MUST** export handlers.

**Required Exports:**

```typescript
// commands/mycommand/index.ts
export const data = new SlashCommandBuilder()...
export async function execute(interaction: ChatInputCommandInteraction) {...}

// REQUIRED if using autocomplete
export async function autocomplete(interaction: AutocompleteInteraction) {...}

// REQUIRED if using select menus
export async function handleSelectMenu(interaction: StringSelectMenuInteraction) {...}

// REQUIRED if using buttons
export async function handleButton(interaction: ButtonInteraction) {...}
```

**Why This Matters:**

- `CommandHandler.ts` collects these exports when loading commands
- Missing exports = silent failures when users click buttons/menus
- This has caused production bugs where dashboard interactions failed

---

### 🚨 Rule 3: Use Constants for Discord Limits

**Import Discord limits from `@tzurot/common-types`:**

```typescript
import { DISCORD_LIMITS, DISCORD_COLORS, TEXT_LIMITS } from '@tzurot/common-types';

// ✅ Correct
const modal = new ModalBuilder()...
field.setMaxLength(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);

// ❌ Wrong - magic number
field.setMaxLength(4000);
```

**Available Constants:**

| Constant                                  | Value | Use For                  |
| ----------------------------------------- | ----- | ------------------------ |
| `DISCORD_LIMITS.MESSAGE_LENGTH`           | 2000  | Message content limit    |
| `DISCORD_LIMITS.EMBED_DESCRIPTION`        | 4096  | Embed description limit  |
| `DISCORD_LIMITS.EMBED_FIELD`              | 1024  | Embed field value limit  |
| `DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES` | 25    | Max autocomplete results |
| `DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH`   | 4000  | Modal text input max     |
| `DISCORD_LIMITS.MODAL_TITLE_MAX_LENGTH`   | 45    | Modal title limit        |
| `DISCORD_COLORS.BLURPLE`                  | hex   | Discord brand color      |
| `DISCORD_COLORS.SUCCESS/WARNING/ERROR`    | hex   | Status colors            |

---

## File Structure

### 🚨 Rule 4: One Subcommand Per File

**Each subcommand handler MUST be in its own file.** This is a strict pattern for maintainability.

```
commands/
├── mycommand/
│   ├── index.ts          # Command definition + routing (minimal logic)
│   ├── list.ts           # /mycommand list handler
│   ├── create.ts         # /mycommand create handler
│   ├── edit.ts           # /mycommand edit handler
│   ├── delete.ts         # /mycommand delete handler
│   ├── config.ts         # Shared configuration (if needed)
│   ├── autocomplete.ts   # Autocomplete handler (if needed)
│   ├── list.test.ts      # Tests colocated with handler
│   ├── create.test.ts
│   └── index.test.ts     # Tests for routing/integration
```

**Why This Pattern:**

- **Discoverability**: Easy to find the code for any subcommand
- **Single Responsibility**: Each file handles one subcommand
- **Testability**: Tests are colocated and focused
- **Maintainability**: Changes to one subcommand don't risk breaking others
- **Parallel Development**: Multiple subcommands can be worked on simultaneously

**`index.ts` Should Be Thin:**

```typescript
// ✅ CORRECT: index.ts is routing only
import { handleList } from './list.js';
import { handleCreate } from './create.js';

const router = createSubcommandRouter({
  list: handleList,
  create: (i) => handleCreate(i, config),
});

export async function execute(interaction) {
  await router(interaction);
}
```

```typescript
// ❌ WRONG: index.ts contains all handler logic
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'list':
      // 100+ lines of list logic here
      break;
    case 'create':
      // 100+ lines of create logic here
      break;
  }
}
```

**File Responsibilities:**

| File              | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `index.ts`        | `data`, `execute` (routing), `handleSelectMenu?`, `handleButton?` |
| `{subcommand}.ts` | Handler function for that subcommand                      |
| `config.ts`       | Dashboard configuration, shared types, constants          |
| `autocomplete.ts` | `handleAutocomplete` if complex/reused across subcommands |

---

## Command Definition Pattern

```typescript
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

export const data = new SlashCommandBuilder()
  .setName('mycommand')
  .setDescription('Clear description of what this does')
  .addSubcommand(sub => sub.setName('list').setDescription('List all items'))
  .addSubcommand(sub =>
    sub
      .setName('create')
      .setDescription('Create a new item')
      .addStringOption(opt =>
        opt.setName('name').setDescription('Item name').setRequired(true).setAutocomplete(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'list':
      await handleList(interaction);
      break;
    case 'create':
      await handleCreate(interaction);
      break;
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  // Handle autocomplete
}
```

---

## API Communication Patterns

### User-Authenticated Requests

```typescript
import { callGatewayApi, type GatewayResponse } from '../../utils/userGatewayClient.js';

interface MyResponse {
  items: Item[];
}

const result = await callGatewayApi<MyResponse>('/user/myendpoint', {
  userId: interaction.user.id,
  method: 'GET', // or 'POST', 'PUT', 'DELETE'
  body: {
    /* payload for POST/PUT */
  },
});

if (!result.ok) {
  await interaction.reply({
    content: `❌ ${result.error ?? 'Request failed'}`,
    flags: MessageFlags.Ephemeral,
  });
  return;
}

// Use result.data
const items = result.data.items;
```

### Admin Requests

```typescript
import { adminFetch, adminPostJson } from '../../utils/adminApiClient.js';

// GET request
const response = await adminFetch('/admin/endpoint', {
  headers: { 'X-Owner-Id': ownerId },
});

// POST request
const response = await adminPostJson('/admin/endpoint', payload, {
  headers: { 'X-Owner-Id': ownerId },
});
```

---

## Interactive Components

### Custom ID Format

Use this format for component custom IDs:

```
{commandName}-{action}-{entityId}
```

**Examples:**

- `character-section-abc123` - Character section select
- `wallet-confirm-delete` - Wallet delete confirmation
- `dashboard-refresh-xyz789` - Dashboard refresh button

**Why:**

- `CommandHandler.ts` extracts command name from first segment
- Allows routing to correct handler
- Entity ID enables stateless handling

### Select Menu Handler

```typescript
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const [commandName, action, entityId] = interaction.customId.split('-');
  const selectedValue = interaction.values[0];

  switch (action) {
    case 'section':
      await handleSectionSelect(interaction, entityId, selectedValue);
      break;
    // ... other actions
  }
}
```

### Button Handler

```typescript
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [commandName, action, entityId] = interaction.customId.split('-');

  switch (action) {
    case 'confirm':
      await handleConfirm(interaction, entityId);
      break;
    case 'cancel':
      await handleCancel(interaction);
      break;
  }
}
```

---

## Error Handling

### Standard Error Response

```typescript
// User-friendly error with guidance
await interaction.reply({
  content: `❌ Character not found.\n\nUse \`/character list\` to see available characters.`,
  flags: MessageFlags.Ephemeral,
});
```

### API Error Handling

```typescript
const result = await callGatewayApi<Response>('/user/endpoint', {
  userId: interaction.user.id,
});

if (!result.ok) {
  // result.status contains HTTP status code
  // result.error contains error message
  const message = getErrorMessage(result.status, result.error);
  await interaction.reply({
    content: `❌ ${message}`,
    flags: MessageFlags.Ephemeral,
  });
  return;
}
```

---

## Testing Standards

### What to Test

1. **Command execution** - Each subcommand path
2. **API calls** - Verify correct endpoints and headers
3. **Error handling** - API failures, validation errors
4. **Interactive components** - Button/select menu handlers
5. **Autocomplete** - Search, filtering, limit enforcement

### Mocking Pattern

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

import { callGatewayApi } from '../../utils/userGatewayClient.js';
const mockCallGatewayApi = vi.mocked(callGatewayApi);

describe('mycommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call correct API endpoint', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { items: [] },
    });

    await execute(mockInteraction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/myendpoint', {
      userId: 'user-123',
      method: 'GET',
    });
  });
});
```

### Testing Interactive Components

```typescript
describe('handleSelectMenu', () => {
  it('should handle section selection', async () => {
    const interaction = createMockSelectMenuInteraction({
      customId: 'character-section-abc123',
      values: ['background'],
    });

    await handleSelectMenu(interaction);

    expect(interaction.showModal).toHaveBeenCalled();
  });
});
```

---

## Checklist for New Commands

### Before Implementation

- [ ] Review existing commands - does this fit an existing one?
- [ ] Plan subcommands and options
- [ ] Identify if Dashboard pattern is needed
- [ ] Identify API endpoints needed

### During Implementation

- [ ] Use `callGatewayApi` or `adminFetch` - NOT direct `fetch()`
- [ ] Import Discord limits from `@tzurot/common-types`
- [ ] Export all handlers (execute, autocomplete, handleSelectMenu, handleButton)
- [ ] Use correct custom ID format for components
- [ ] Handle all error cases with user-friendly messages
- [ ] Use ephemeral responses for user-specific data

### Before Merging

- [ ] Tests for all execution paths
- [ ] Tests for API communication
- [ ] Tests for error handling
- [ ] Tests for interactive components (if any)
- [ ] All tests passing: `pnpm test`
- [ ] TypeScript compiles: `pnpm typecheck`
- [ ] Linting passes: `pnpm lint`

---

## Related Documentation

- [SLASH_COMMAND_UX.md](./SLASH_COMMAND_UX.md) - UX patterns and naming conventions
- [CLAUDE.md](../../CLAUDE.md) - Gateway client usage rules
- `bot-client/src/utils/dashboard/` - Dashboard pattern implementation
