# Discord Rules

## 3-Second Rule (CRITICAL)

Discord requires response within 3 seconds. AI calls take longer.

```typescript
// MUST defer IMMEDIATELY, then process
await interaction.deferReply();

const response = await fetch(`${GATEWAY_URL}/ai/generate`, { ... });
await interaction.editReply({ content: result.content });
```

## Deterministic UUIDs

Never use `uuid.v4()` - use generators from common-types for deterministic IDs.

## Slash Command Standards

### Subcommand Names

| Subcommand | Purpose            | Notes                              |
| ---------- | ------------------ | ---------------------------------- |
| `browse`   | Paginated list     | **Preferred** - has select menu    |
| `list`     | Simple list        | Legacy - use `browse` for new cmds |
| `view`     | Single item detail |                                    |
| `create`   | Create new item    |                                    |
| `edit`     | Modify item        | Opens dashboard                    |
| `delete`   | Remove item        | Must confirm                       |

### Response Types

```typescript
// ✅ Ephemeral for: settings, errors, dashboards, sensitive data
await interaction.reply({ content: '...', flags: MessageFlags.Ephemeral });

// ✅ Public for: displays others might want to see
await interaction.reply({ content: '...' });
```

### Button Emoji Pattern

**ALWAYS use `.setEmoji()` separately from `.setLabel()`** for consistent sizing:

```typescript
// ❌ WRONG - Buttons look skinny
new ButtonBuilder().setLabel('◀️ Back');

// ✅ CORRECT - Consistent sizing
new ButtonBuilder().setLabel('Back').setEmoji('◀️');
```

### Standard Button Order

1. Primary actions (Edit, Lock/Unlock)
2. View actions
3. Navigation (Back to List)
4. Destructive (Delete - always last, `ButtonStyle.Danger`)

## Shared Utilities

**ALWAYS check for existing utilities before implementing:**

| Pattern            | Shared Utility                  | Location                            |
| ------------------ | ------------------------------- | ----------------------------------- |
| Browse pagination  | `createBrowseCustomIdHelpers`   | `utils/browse/customIdFactory.ts`   |
| Browse buttons     | `buildBrowseButtons`            | `utils/browse/buttonBuilder.ts`     |
| Dashboard messages | `DASHBOARD_MESSAGES`            | `utils/dashboard/messages.ts`       |
| Session management | `fetchOrCreateSession`          | `utils/dashboard/sessionHelpers.ts` |
| Autocomplete       | `handlePersonalityAutocomplete` | `utils/autocomplete/`               |
| List sorting       | `createListComparator`          | `utils/listSorting.ts`              |

**Never reimplement these patterns locally.**

## Autocomplete Formatting

```typescript
import { formatAutocompleteOption, AUTOCOMPLETE_BADGES } from '@tzurot/common-types';

const choices = items.map(item =>
  formatAutocompleteOption({
    name: item.name,
    value: item.id,
    scopeBadge: item.isGlobal ? AUTOCOMPLETE_BADGES.GLOBAL : AUTOCOMPLETE_BADGES.OWNED,
    statusBadges: item.isDefault ? [AUTOCOMPLETE_BADGES.DEFAULT] : undefined,
  })
);
// Result: "🌐⭐ Global Default · claude-sonnet-4"
```

## BullMQ Job Patterns

### Retryable vs Non-Retryable

**Retryable:** Network timeouts, rate limits (429), server errors (5xx)
**Non-retryable:** Validation errors (400), not found (404), auth (401)

### Queue Configuration

```typescript
const aiQueue = new Queue('ai-jobs', {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 10, age: 24 * 3600 },
    removeOnFail: { count: 50, age: 7 * 24 * 3600 },
  },
});
```

### Timer Patterns

```typescript
// ✅ OK - Request timeouts, one-time delays
const controller = new AbortController();
setTimeout(() => controller.abort(), 30000);

// ❌ Scaling Blocker - Persistent intervals
setInterval(() => this.cleanup(), 60000);

// ✅ Alternative - BullMQ repeatable jobs
await queue.add('cleanup-cache', {}, { repeat: { every: 60000 } });
```

## Observability

### Correlation IDs

```typescript
// bot-client: Generate and include in request
const requestId = randomUUID();
await fetch(url, { headers: { 'X-Request-ID': requestId } });

// All services: Include in logs
logger.info({ requestId, jobId }, 'Processing');
```

### Structured Logging

```typescript
// ✅ GOOD - Structured data first, then message
logger.info({ personalityId, model }, 'Loaded personality');

// ❌ BAD - String interpolation loses structure
logger.info(`Loaded personality ${personalityId}`);
```
