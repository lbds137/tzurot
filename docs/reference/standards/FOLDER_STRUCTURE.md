# Folder Structure Standards

> **Last Updated**: 2025-11-07
>
> **Purpose**: Maintain consistent, navigable folder structure across all packages and services in the Tzurot v3 monorepo.

## Core Principles

1. **Avoid Root Bloat**: Keep root directories clean with ≤5 files
2. **No Single-File Folders**: Don't create folders for just 1 file (unless expected to grow, like `routes/`)
3. **Consistent Naming**: Follow established patterns across the entire project
4. **Logical Grouping**: Group related files by purpose, not arbitrary categories

## Standard Folder Structure

### All Packages and Services

```
src/
├── index.ts                    # Entry point / barrel export (ALWAYS)
├── [config files]              # redis.ts, queue.ts, types.ts (OK in root)
├── services/                   # Service classes, business logic
├── utils/                      # Utility functions, helpers
└── [domain folders]/           # Domain-specific: jobs/, routes/, commands/, etc.
```

**Root Directory Rules:**

- ✅ `index.ts` - Entry point / barrel export
- ✅ Config files: `redis.ts`, `queue.ts`, `types.ts`
- ❌ Everything else goes in a subdirectory
- 📏 **Maximum**: ~5 files in root

### packages/common-types

Shared types, utilities, and services used across all services.

```
src/
├── index.ts                    # Barrel export
├── config/                     # Configuration
│   ├── config.ts              # Environment config
│   ├── constants.ts           # Constants (no functions!)
│   └── modelDefaults.ts       # Default model configuration
├── services/                   # Shared services
│   ├── ConversationHistoryService.ts
│   ├── PersonalityService.ts
│   ├── UserService.ts
│   └── prisma.ts
├── types/                      # Type definitions
│   ├── ai.ts                  # AI-related types
│   ├── api-types.ts           # API types
│   ├── discord.ts             # Discord types
│   └── schemas.ts             # Zod schemas
└── utils/                      # Utility functions
    ├── circuit-breaker.ts
    ├── dateFormatting.ts
    ├── deterministic-uuid.ts
    ├── discord.ts             # Discord utilities
    ├── logger.ts
    ├── redis.ts               # Redis utilities
    └── timeout.ts             # Timeout calculations
```

**Key Rules:**

- **No functions in `config/constants.ts`** - only constant values
- Utility functions go in `utils/`, not in root with `-utils.ts` suffix
- Type definitions go in `types/`, not scattered in root

### services/ai-worker

AI processing service with job queue, memory, and LLM integration.

```
src/
├── index.ts                    # Entry point
├── redis.ts                    # Redis config
├── jobs/                       # BullMQ job processors
│   ├── AIJobProcessor.ts
│   └── PendingMemoryProcessor.ts
├── services/                   # Core services
│   ├── ConversationalRAGService.ts
│   ├── LLMInvoker.ts
│   ├── LongTermMemoryService.ts
│   ├── MemoryRetriever.ts
│   ├── ModelFactory.ts
│   ├── MultimodalFormatter.ts
│   ├── MultimodalProcessor.ts
│   ├── PgvectorMemoryAdapter.ts
│   ├── PromptBuilder.ts
│   └── ReferencedMessageFormatter.ts
└── utils/                      # Utilities
    ├── errorHandling.ts
    ├── promptPlaceholders.ts
    ├── responseCleanup.ts
    └── retryService.ts
```

**Note**: `PgvectorMemoryAdapter.ts` moved from `memory/` to `services/` (no single-file folders).

### services/api-gateway

HTTP API and job queue management.

```
src/
├── index.ts                    # Entry point
├── queue.ts                    # BullMQ queue config
├── types.ts                    # Type definitions
├── routes/                     # HTTP route handlers
│   ├── admin.ts
│   └── ai.ts
├── services/                   # Services
│   ├── AuthMiddleware.ts      # Moved from middleware/
│   └── DatabaseSyncService.ts
└── utils/                      # Utilities
    ├── errorResponses.ts
    ├── imageProcessor.ts
    ├── requestDeduplication.ts
    └── tempAttachmentStorage.ts
```

**Note**: `AuthMiddleware.ts` moved from `middleware/` to `services/` (no single-file folders).

### services/bot-client

Discord bot client with webhook management.

```
src/
├── index.ts                    # Entry point
├── redis.ts                    # Redis config
├── types.ts                    # Type definitions
├── commands/                   # Discord slash commands (see below)
├── handlers/                   # Event handlers
│   ├── CommandHandler.ts
│   ├── MessageHandler.ts
│   └── MessageReferenceExtractor.ts  # Moved from context/
└── utils/                      # Utilities
    ├── GatewayClient.ts               # Moved from gateway/
    ├── WebhookManager.ts              # Moved from webhooks/
    ├── attachmentExtractor.ts
    ├── attachmentPlaceholders.ts
    ├── deployCommands.ts
    ├── discordContext.ts
    ├── embedImageExtractor.ts
    ├── EmbedParser.ts
    ├── MessageLinkParser.ts
    └── personalityMentionParser.ts
```

**Notes**:

- `MessageReferenceExtractor.ts` moved from `context/` to `handlers/` (related to message handling)
- `GatewayClient.ts` moved from `gateway/` to `utils/` (no single-file folders)
- `WebhookManager.ts` moved from `webhooks/` to `utils/` (no single-file folders)

### Discord Slash Command Folder Structure

Commands with subcommand groups follow a hierarchical folder structure that mirrors the command structure itself. This maintains both **SRP** (Single Responsibility Principle) and **DRY** (Don't Repeat Yourself).

#### Core Principles

1. **One file per subcommand** - Each subcommand handler lives in its own file
2. **Subcommand groups get subfolders** - Groups with multiple subcommands become folders
3. **Shared logic in utils/** - Common helpers used across subcommands go in a shared `utils/` folder
4. **Types stay DRY** - Shared types go in `types.ts` or common-types package
5. **Index.ts for routing** - Main index.ts handles command registration and routing only

#### Example: Complex Command with Subcommands

For a command like `/persona` with multiple subcommands:

```
commands/persona/
├── index.ts                    # Command registration & routing (SlashCommandBuilder)
├── index.test.ts               # Tests for routing logic
├── autocomplete.ts             # Shared autocomplete handlers
├── autocomplete.test.ts
├── view.ts                     # /persona view
├── view.test.ts
├── edit.ts                     # /persona edit
├── edit.test.ts
├── create.ts                   # /persona create
├── create.test.ts
├── browse.ts                   # /persona browse
├── browse.test.ts
├── default.ts                  # /persona default
├── default.test.ts
├── share-ltm.ts                # /persona share-ltm
├── share-ltm.test.ts
├── override/                   # /persona override <subcommand>
│   ├── set.ts                  # /persona override set
│   ├── set.test.ts
│   ├── clear.ts                # /persona override clear
│   └── clear.test.ts
├── config.ts                   # Dashboard config
├── types.ts                    # Shared types
└── utils/                      # Shared profile utilities (DRY)
    └── modalBuilder.ts         # Modal building logic used by create/edit
```

For a command like `/settings` with subcommand groups:

```
commands/settings/
├── index.ts                    # Command registration & routing
├── index.test.ts
├── timezone/                   # /settings timezone <subcommand>
│   ├── set.ts                  # /settings timezone set
│   ├── set.test.ts
│   ├── view.ts                 # /settings timezone view
│   └── view.test.ts
├── apikey/                     # /settings apikey <subcommand>
│   ├── set.ts                  # /settings apikey set
│   └── remove.ts               # /settings apikey remove
└── defaults/                   # /settings defaults <subcommand>
    └── edit.ts                 # /settings defaults edit
```

#### Anti-Patterns to Avoid

```
❌ BAD: Multiple handlers in one file
// override.ts
export function handleOverrideSet() { ... }
export function handleOverrideClear() { ... }  // Separate responsibilities!

✅ GOOD: One handler per file
// override-set.ts
export function handleOverrideSet() { ... }

// override-clear.ts
export function handleOverrideClear() { ... }
```

```
❌ BAD: Duplicated logic across files
// set.ts
function formatTimezone(tz: string) { ... }  // Duplicated!

// get.ts
function formatTimezone(tz: string) { ... }  // Duplicated!

✅ GOOD: Shared logic in utils
// utils.ts
export function formatTimezone(tz: string) { ... }

// set.ts
import { formatTimezone } from './utils.js';

// get.ts
import { formatTimezone } from './utils.js';
```

#### When to Create a Subfolder

- **≥2 subcommands** in a group → Create a subfolder
- **1 subcommand** → Keep in parent directory (no single-file folders)
- **Shared utilities** used by ≥2 files → Create `utils/` folder within the group

## File Naming Conventions

### Classes and Services

**Format**: PascalCase

✅ **Good Examples:**

- `UserService.ts`
- `LLMInvoker.ts`
- `MessageHandler.ts`
- `ConversationalRAGService.ts`

### Utilities and Helpers

**Format**: camelCase

✅ **Good Examples:**

- `errorHandling.ts`
- `deployCommands.ts`
- `promptPlaceholders.ts`
- `imageProcessor.ts`

### Type Definitions

**Format**: kebab-case file names, for `packages/common-types/src/types/` only (lint-enforced by `structure.test.ts`, which checks the file name, not the directory path; existing camelCase files there are grandfathered by name, not renamed). Other `types/` directories follow the conventions of the sections above.

✅ **Good Examples:**

- `api-types.ts`
- `discord.ts`
- `gateway-context.ts`

### Test Files

**Format**: Co-located with source, `.test.ts` suffix

✅ **Good Examples:**

- `UserService.test.ts` (next to `UserService.ts`)
- `promptPlaceholders.test.ts` (next to `promptPlaceholders.ts`)
- `timeout.test.ts` (next to `timeout.ts`)

## Folder Naming Conventions

### Always Plural

Use plural names for folders containing multiple items of the same type.

✅ **Good Examples:**

- `services/`
- `utils/`
- `types/`
- `jobs/`
- `routes/`
- `commands/`
- `handlers/`

❌ **Bad Examples:**

- `service/`
- `util/`
- `type/`

### Domain-Specific Folders

Create folders for clear functional domains.

✅ **Good Examples:**

- `jobs/` - BullMQ job processors
- `routes/` - HTTP route handlers
- `commands/` - Discord commands
- `handlers/` - Event handlers
- `middleware/` - HTTP middleware (when you have 2+)

## Common Anti-Patterns to Avoid

### ❌ Single-File Folders

**Problem**: Creates unnecessary navigation depth

```
❌ BAD:
src/
├── memory/
│   └── PgvectorMemoryAdapter.ts    # Only 1 file!
└── gateway/
    └── GatewayClient.ts             # Only 1 file!

✅ GOOD:
src/
└── services/
    ├── PgvectorMemoryAdapter.ts
    └── GatewayClient.ts
```

**Exception**: Folders expected to grow (e.g., `routes/` with 2 files that will become 10).

### ❌ Root File Bloat

**Problem**: Too many files in root directory

```
❌ BAD (15 files in root!):
src/
├── index.ts
├── ai.ts
├── api-types.ts
├── circuit-breaker.ts
├── config.ts
├── constants.ts
├── dateFormatting.ts
├── discord.ts
├── discord-utils.ts
├── logger.ts
├── modelDefaults.ts
├── redis-utils.ts
├── schemas.ts
├── timeout-utils.ts
└── deterministic-uuid.ts

✅ GOOD (organized):
src/
├── index.ts
├── config/
│   ├── config.ts
│   ├── constants.ts
│   └── modelDefaults.ts
├── types/
│   ├── ai.ts
│   ├── api-types.ts
│   ├── discord.ts
│   └── schemas.ts
└── utils/
    ├── circuit-breaker.ts
    ├── dateFormatting.ts
    ├── deterministic-uuid.ts
    ├── discord.ts
    ├── logger.ts
    ├── redis.ts
    └── timeout.ts
```

### ❌ Inconsistent -utils.ts Suffix

**Problem**: Mix of approaches

```
❌ BAD:
packages/common-types/src/
├── discord-utils.ts           # -utils suffix in root
├── redis-utils.ts             # -utils suffix in root
└── timeout-utils.ts           # -utils suffix in root

services/ai-worker/src/
└── utils/                     # utils/ folder
    ├── errorHandling.ts
    └── promptPlaceholders.ts

✅ GOOD (consistent):
packages/common-types/src/
└── utils/                     # Always use utils/ folder
    ├── discord.ts             # No -utils suffix
    ├── redis.ts
    └── timeout.ts

services/ai-worker/src/
└── utils/
    ├── errorHandling.ts
    └── promptPlaceholders.ts
```

### ❌ Functions in Constants Files

**Problem**: Constants files should only contain values

```
❌ BAD:
// constants.ts
export const TIMEOUT = 5000;

export function calculateTimeout(count: number) {  // ← Function!
  return TIMEOUT * count;
}

✅ GOOD:
// constants.ts
export const TIMEOUT = 5000;

// utils/timeout.ts
import { TIMEOUT } from '../config/constants.js';

export function calculateTimeout(count: number) {
  return TIMEOUT * count;
}
```

## Enforcement

These standards are enforced through:

1. **Code review** - All PRs checked for structure violations
2. **Documentation** - This file referenced in `CLAUDE.md`
3. **Linting** - Future: ESLint rules for imports and structure

## Migration Guide

When refactoring existing code to match these standards:

1. **Create new folders first** (e.g., `mkdir -p src/utils src/types src/config`)
2. **Move files** with git mv to preserve history: `git mv src/discord-utils.ts src/utils/discord.ts`
3. **Update imports** across the codebase
4. **Run build** to catch any import errors
5. **Run tests** to ensure everything works
6. **Commit with descriptive message** explaining the refactoring

## Questions or Concerns?

If you encounter edge cases or have questions about these standards:

1. Check existing patterns in the codebase
2. Ask for clarification in code review
3. Update this document with the decision for future reference
