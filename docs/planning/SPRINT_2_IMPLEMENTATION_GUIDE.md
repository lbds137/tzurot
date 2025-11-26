# Sprint 2: BYOK Implementation Guide

> **Created**: 2025-11-25
> **Status**: Active Implementation
> **Branch**: `feat/sprint-2-byok-implementation`
> **Goal**: Enable BYOK (Bring Your Own Key) to unblock public launch

## Overview

This is the **single source of truth** for Sprint 2 implementation. It consolidates details from:

- ROADMAP.md (task list)
- PHASED_IMPLEMENTATION_PLAN.md (phases and testing)
- schema-improvements-proposal.md (Prisma schemas)
- QOL_MODEL_MANAGEMENT.md (slash commands and ownership)

**Why BYOK First**: Without BYOK, random users can rack up expensive API bills on the bot owner's account. This blocks public launch.

---

## Prerequisites

- [x] Phase 0 complete (integration tests, contract tests)
- [x] Phase 1 Sprint 1 complete (testing baseline)
- [x] Prisma 7.0 migration complete
- [x] 1715+ tests passing

---

## Implementation Order

Based on Gemini consultation (2025-11-25), the optimal order is:

```
1. PREPARATION (Code First)
   └── Encryption utilities (must know storage format before schema)
   └── Zod schemas for advancedParameters

2. DATABASE MIGRATIONS (Dependency Order)
   └── User table (root dependency)
   └── UserApiKey table (depends on User)
   └── Personality table (depends on User for ownerId)
   └── LlmConfig table (depends on Personality)
   └── PersonalityAlias table (leaf node)
   └── UsageLog table (leaf node)

3. DATA MIGRATION (After Schema)
   └── Migrate custom_fields → dedicated columns
   └── Extract shapes.inc backup data
   └── Assign ownership to existing personalities

4. APPLICATION CODE
   └── Log sanitization middleware
   └── Key validation service
   └── Update ai-worker for user API keys
   └── Thinking/reasoning model handling

5. SLASH COMMANDS (Sprint 3, after backend)
   └── /wallet commands
   └── /timezone commands
   └── /usage command
```

---

## Phase 1: Preparation (Code First)

### Task P.1: Encryption Utilities

**Why First**: Need to decide storage format (3 columns vs concatenated string) before writing migration.

**File**: `packages/common-types/src/utils/encryption.ts`

**Decision**: Use 3 separate columns (iv, content, tag) for clarity and easier debugging.

```typescript
// packages/common-types/src/utils/encryption.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Get encryption key from environment.
 * Key must be 32 bytes (256 bits) in hex format (64 hex characters).
 */
function getEncryptionKey(): Buffer {
  const key = process.env.APP_MASTER_KEY;
  if (!key) {
    throw new Error('APP_MASTER_KEY environment variable is required');
  }
  if (key.length !== 64) {
    throw new Error('APP_MASTER_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

export interface EncryptedData {
  iv: string; // 16 bytes as hex (32 chars)
  content: string; // Ciphertext as hex
  tag: string; // 16 bytes as hex (32 chars)
}

/**
 * Encrypt an API key using AES-256-GCM.
 * Returns IV, ciphertext, and auth tag separately for database storage.
 */
export function encryptApiKey(plaintext: string): EncryptedData {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    content: encrypted,
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an API key using AES-256-GCM.
 * Throws if authentication fails (tampered data).
 */
export function decryptApiKey(encrypted: EncryptedData): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(encrypted.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));

  let decrypted = decipher.update(encrypted.content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

**Tests**: `packages/common-types/src/utils/encryption.test.ts`

- Test encrypt/decrypt round-trip
- Test different key lengths
- Test tampered data detection (auth tag failure)
- Test missing APP_MASTER_KEY error

**Environment Setup**:

```bash
# Generate a 32-byte key (64 hex chars)
openssl rand -hex 32

# Add to Railway environment
railway variables set APP_MASTER_KEY=<generated-key> --service api-gateway
railway variables set APP_MASTER_KEY=<generated-key> --service ai-worker
```

---

### Task P.2: Zod Schemas for advancedParameters

**File**: `packages/common-types/src/schemas/llmAdvancedParams.ts`

**Why**: Validate JSONB structure at application layer before database storage.

**Provider Strategy**: Tzurot uses **OpenRouter as the single LLM provider**. OpenRouter provides a **unified API** that normalizes parameters across underlying models (OpenAI, Anthropic, Google, open-source).

**Key Discovery (2025-11-25)**: OpenRouter has a **unified `reasoning` object** that works across all reasoning models (o1/o3, Claude thinking, Gemini thinking, DeepSeek R1). No need for model-family specific schemas!

### SDK Decision: REST API via LangChain (Not @openrouter/sdk)

**Research Conclusion (2025-11-25)**: After evaluating `@openrouter/sdk` (official TypeScript SDK, in beta) vs direct REST API, we chose to **keep our current approach**:

**Current Implementation** (`services/ai-worker/src/services/ModelFactory.ts`):

```typescript
// We use LangChain's ChatOpenAI with custom baseURL pointing to OpenRouter
new ChatOpenAI({
  modelName,
  apiKey,
  temperature,
  configuration: {
    baseURL: 'https://openrouter.ai/api/v1',
  },
});
```

**Why NOT switch to @openrouter/sdk**:

1. **Beta Status**: The SDK "may have breaking changes between versions without a major version update" - risky for production
2. **Type Blocking**: Strict TypeScript types can block new parameters (like `reasoning`) before SDK updates
3. **Debugging Complexity**: BYOK errors are easier to debug with raw HTTP responses vs SDK-wrapped errors
4. **No Real Benefit**: We already have type safety via Zod schemas, streaming via LangChain, and the SDK is just a wrapper around fetch anyway

**What we gain by staying with current approach**:

1. **Stability**: LangChain's OpenAI SDK is battle-tested
2. **Flexibility**: Can add new parameters immediately without waiting for SDK updates
3. **BYOK Debugging**: Raw 401/402/429 errors are clear for user-facing error messages
4. **Reasoning Support**: Can pass `reasoning` object directly via LangChain's extra params

**For reasoning/advanced parameters**, LangChain's ChatOpenAI passes unsupported params directly to the underlying API:

```typescript
// Method 1: At instantiation (for static config from LlmConfig)
const model = new ChatOpenAI({
  modelName,
  apiKey,
  temperature,
  // Extra params passed directly to OpenRouter
  frequencyPenalty: 0.5,
  configuration: { baseURL: 'https://openrouter.ai/api/v1' },
});

// Method 2: At invoke time using .bind() (for dynamic config)
const modelWithReasoning = model.bind({
  reasoning: { effort: 'high' },
});
await modelWithReasoning.invoke(messages);
```

**Implementation Plan**: Store advanced params in `LlmConfig.advancedParameters` (JSONB), then spread them into the ChatOpenAI constructor or use `.bind()` at invoke time.

**Sources**:

- [OpenRouter SDKs Documentation](https://openrouter.ai/docs/sdks)
- [OpenRouter TypeScript SDK GitHub](https://github.com/OpenRouterTeam/typescript-sdk)
- Gemini consultation (2025-11-25)

**References**:

- https://openrouter.ai/docs/api/reference/parameters
- https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

```typescript
// packages/common-types/src/schemas/llmAdvancedParams.ts
import { z } from 'zod';

/**
 * Advanced parameters for LLM requests via OpenRouter.
 *
 * OpenRouter normalizes these parameters across all underlying models.
 * Unsupported params are silently dropped (sampling) or cause errors (conflicts).
 *
 * See: https://openrouter.ai/docs/api/reference/parameters
 */

// ============================================
// SAMPLING PARAMETERS
// OpenRouter REST API uses snake_case. LangChain passes unknown params as-is.
// We store in snake_case to match what gets sent to the API.
// ============================================
const SamplingParamsSchema = z.object({
  // Standard (widely supported)
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(0).optional(),

  // Penalties
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  repetition_penalty: z.number().min(0).max(2).optional(),

  // Advanced sampling (open-source models)
  min_p: z.number().min(0).max(1).optional(),
  top_a: z.number().min(0).max(1).optional(),

  // Determinism
  seed: z.number().int().optional(),
});

// ============================================
// REASONING PARAMETERS (Unified by OpenRouter)
// Works across: OpenAI o1/o3, Claude, Gemini, DeepSeek R1
// Note: OpenRouter may use camelCase here - verify against latest docs
// ============================================
const ReasoningParamsSchema = z.object({
  reasoning: z
    .object({
      // Effort level (OpenAI o1/o3, Grok, DeepSeek R1)
      // Maps to ~80%/50%/20%/10%/0% of max_tokens for reasoning
      effort: z.enum(['high', 'medium', 'low', 'minimal', 'none']).optional(),

      // Direct token budget (Anthropic, Gemini, Alibaba Qwen)
      // Constraints: min 1024, max 32000, must be < max_tokens
      max_tokens: z.number().int().min(1024).max(32000).optional(),

      // Whether to include reasoning in response (default: true)
      exclude: z.boolean().optional(),

      // Enable/disable reasoning (default: true for reasoning models)
      enabled: z.boolean().optional(),
    })
    .optional(),
});

// ============================================
// OUTPUT CONTROL PARAMETERS
// ============================================
const OutputParamsSchema = z.object({
  max_tokens: z.number().int().positive().optional(),
  stop: z.array(z.string()).optional(),
  logit_bias: z.record(z.string(), z.number().min(-100).max(100)).optional(),

  // Response format
  response_format: z
    .object({
      type: z.enum(['text', 'json_object']),
    })
    .optional(),
});

// ============================================
// OPENROUTER-SPECIFIC PARAMETERS
// ============================================
const OpenRouterParamsSchema = z.object({
  // Prompt transforms (e.g., middle-out for long contexts)
  transforms: z.array(z.string()).optional(),

  // Provider routing preferences
  route: z.enum(['fallback']).optional(),

  // Response verbosity
  verbosity: z.enum(['low', 'medium', 'high']).optional(),
});

// ============================================
// COMBINED SCHEMA
// ============================================
export const AdvancedParamsSchema = SamplingParamsSchema.merge(ReasoningParamsSchema)
  .merge(OutputParamsSchema)
  .merge(OpenRouterParamsSchema);

export type AdvancedParams = z.infer<typeof AdvancedParamsSchema>;

/**
 * Validate advancedParameters from database/user input.
 * Returns validated params or throws ZodError.
 */
export function validateAdvancedParams(params: unknown): AdvancedParams {
  return AdvancedParamsSchema.parse(params);
}

/**
 * Safely validate advancedParameters, returning null on failure.
 */
export function safeValidateAdvancedParams(params: unknown): AdvancedParams | null {
  const result = AdvancedParamsSchema.safeParse(params);
  return result.success ? result.data : null;
}

/**
 * Check if reasoning is enabled for these params.
 * Used to apply constraints (e.g., max_tokens > reasoning.max_tokens).
 */
export function hasReasoningEnabled(params: AdvancedParams): boolean {
  if (!params.reasoning) return false;
  if (params.reasoning.enabled === false) return false;
  if (params.reasoning.effort === 'none') return false;
  return params.reasoning.effort !== undefined || params.reasoning.max_tokens !== undefined;
}
```

**Key Constraints** (enforced at runtime, not in schema):

1. When `reasoning.max_tokens` is set, `max_tokens` must be greater (leave room for response)
2. Reasoning models may ignore/error on `temperature` if reasoning is enabled
3. Minimum reasoning budget: 1,024 tokens
4. Maximum reasoning budget: 32,000 tokens

**Tests**: `packages/common-types/src/schemas/llmAdvancedParams.test.ts`

- Test sampling params with valid/invalid ranges
- Test reasoning object validation (effort levels, token budgets)
- Test output params (maxTokens, stop sequences)
- Test OpenRouter-specific params
- Test `hasReasoningEnabled()` helper
- Test combined schema validates correctly
- Test invalid values are rejected with clear errors

---

## Phase 2: Database Migrations

### Migration Order (CRITICAL)

Run migrations in this exact order to satisfy foreign key dependencies:

1. `001_update_user_table` - Add isSuperuser, timezone
2. `002_create_user_api_key` - Depends on User
3. `003_update_personality_table` - Add ownerId, isPublic, errorMessage, birthday
4. `004_refactor_llm_config` - Add provider, advancedParameters, maxReferencedMessages
5. `005_create_personality_alias` - Depends on Personality
6. `006_create_usage_log` - Depends on User

---

### Migration 1: Update User Table

**Task 2.5 from ROADMAP.md**

```prisma
model User {
  id                      String                   @id @default(uuid())
  discordId               String                   @unique
  username                String?

  // NEW fields
  timezone                String                   @default("UTC")
  isSuperuser             Boolean                  @default(false)

  // NEW relationships
  apiKeys                 UserApiKey[]
  usageLogs               UsageLog[]
  ownedPersonalities      Personality[]            @relation("PersonalityOwner")

  // Existing relationships...
  createdAt               DateTime                 @default(now())
  updatedAt               DateTime                 @updatedAt

  @@map("users")
}
```

**Migration SQL** (generated by Prisma):

```sql
ALTER TABLE "users" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "users" ADD COLUMN "isSuperuser" BOOLEAN NOT NULL DEFAULT false;
```

---

### Migration 2: Create UserApiKey Table

**Task 2.2 from ROADMAP.md**

**Provider Strategy**: Currently only stores OpenRouter keys. The `provider` field exists for future extensibility (e.g., if we add direct embedding provider support), but for now all keys will be `provider: "openrouter"`.

```prisma
model UserApiKey {
  id          String    @id @default(uuid())
  userId      String

  // Provider identification (currently only "openrouter")
  provider    String    @default("openrouter") @db.VarChar(20)

  // AES-256-GCM encryption fields (3 separate columns)
  iv          String    @db.VarChar(32)   // 16 bytes as hex
  content     String    @db.Text          // Ciphertext as hex
  tag         String    @db.VarChar(32)   // 16 bytes as hex

  // Status
  isActive    Boolean   @default(true)

  // Metadata
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  lastUsedAt  DateTime?

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider])
  @@index([userId])
  @@map("user_api_keys")
}
```

---

### Migration 3: Update Personality Table

**Task 2.4 from ROADMAP.md**

```prisma
model Personality {
  id                String                    @id @default(uuid())
  name              String                    @unique

  // ... existing fields ...

  // NEW fields
  errorMessage      String?                   @db.Text
  birthday          DateTime?                 @db.Date
  ownerId           String?                   // null = system personality
  isPublic          Boolean                   @default(true)

  // NEW relationships
  owner             User?                     @relation("PersonalityOwner", fields: [ownerId], references: [id])
  aliases           PersonalityAlias[]

  // ... existing relationships ...

  @@map("personalities")
}
```

**Note**: `ownerId` is nullable initially to allow existing personalities to remain ownerless until data migration assigns them.

---

### Migration 4: Refactor LlmConfig Table (2-Step Process)

**Task 2.6 from ROADMAP.md**

**Step 4a: Add new columns (keep old columns)**

```prisma
model LlmConfig {
  id                        String      @id @default(uuid())
  personalityId             String      @unique

  // NEW: Provider identification
  provider                  String      @default("openrouter") @db.VarChar(20)

  // EXISTING: Universal parameters (keep as columns)
  model                     String      @db.VarChar(100)
  visionModel               String?     @db.VarChar(100)
  temperature               Decimal?    @db.Decimal(3, 2)
  topP                      Decimal?    @db.Decimal(4, 3)
  maxTokens                 Int?
  memoryScoreThreshold      Decimal?    @db.Decimal(4, 3)
  memoryLimit               Int?        @default(20)
  maxConversationHistory    Int?        @default(50)

  // NEW: Configurable (was hardcoded)
  maxReferencedMessages     Int?        @default(10)

  // NEW: JSONB for provider-specific params
  advancedParameters        Json        @default("{}")

  // KEEP FOR NOW (will migrate then drop in Step 4b):
  // topK, frequencyPenalty, presencePenalty, repetitionPenalty,
  // stop, seed, logitBias, responseFormat, streamResponse, systemFingerprint

  // ... existing ...
}
```

**Step 4b: Data migration script** (run after 4a)

```typescript
// scripts/migrations/migrate-llmconfig-to-jsonb.ts
import { prisma } from '../src/db';

async function migrateLlmConfigToJsonb() {
  const configs = await prisma.llmConfig.findMany();

  for (const config of configs) {
    const advancedParams: Record<string, unknown> = {};

    // Move provider-specific columns to JSONB
    if (config.topK !== null) advancedParams.topK = config.topK;
    if (config.frequencyPenalty !== null)
      advancedParams.frequencyPenalty = Number(config.frequencyPenalty);
    if (config.presencePenalty !== null)
      advancedParams.presencePenalty = Number(config.presencePenalty);
    if (config.repetitionPenalty !== null)
      advancedParams.repetitionPenalty = Number(config.repetitionPenalty);
    if (config.stop !== null) advancedParams.stop = config.stop;
    if (config.seed !== null) advancedParams.seed = config.seed;
    if (config.logitBias !== null) advancedParams.logitBias = config.logitBias;
    if (config.responseFormat !== null) advancedParams.responseFormat = config.responseFormat;
    if (config.streamResponse !== null) advancedParams.streamResponse = config.streamResponse;
    if (config.systemFingerprint !== null)
      advancedParams.systemFingerprint = config.systemFingerprint;

    await prisma.llmConfig.update({
      where: { id: config.id },
      data: { advancedParameters: advancedParams },
    });

    console.log(`Migrated LlmConfig ${config.id}`);
  }

  console.log(`Migrated ${configs.length} LlmConfig records`);
}

migrateLlmConfigToJsonb().catch(console.error);
```

**Step 4c: Drop old columns** (separate migration after verification)

```sql
ALTER TABLE "llm_configs" DROP COLUMN "topK";
ALTER TABLE "llm_configs" DROP COLUMN "frequencyPenalty";
ALTER TABLE "llm_configs" DROP COLUMN "presencePenalty";
ALTER TABLE "llm_configs" DROP COLUMN "repetitionPenalty";
ALTER TABLE "llm_configs" DROP COLUMN "stop";
ALTER TABLE "llm_configs" DROP COLUMN "seed";
ALTER TABLE "llm_configs" DROP COLUMN "logitBias";
ALTER TABLE "llm_configs" DROP COLUMN "responseFormat";
ALTER TABLE "llm_configs" DROP COLUMN "streamResponse";
ALTER TABLE "llm_configs" DROP COLUMN "systemFingerprint";
```

---

### Migration 5: Create PersonalityAlias Table

**Task 2.3 from ROADMAP.md**

```prisma
model PersonalityAlias {
  id              String      @id @default(uuid())
  alias           String      @unique @db.VarChar(50)
  personalityId   String

  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  personality     Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@index([personalityId])
  @@map("personality_aliases")
}
```

---

### Migration 6: Create UsageLog Table

**Task 2.2 from ROADMAP.md**

```prisma
model UsageLog {
  id            String    @id @default(uuid())
  userId        String
  personalityId String?

  // Provider & model
  provider      String    @db.VarChar(20)
  model         String    @db.VarChar(100)

  // Token counts
  tokensIn      Int
  tokensOut     Int
  tokensTotal   Int       // Computed: tokensIn + tokensOut

  // Request type
  requestType   String    @db.VarChar(20)  // "text", "voice", "image"

  // Metadata
  timestamp     DateTime  @default(now())

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, timestamp])
  @@index([provider])
  @@index([requestType])
  @@map("usage_logs")
}
```

---

## Phase 2.5: Parameterizable Limits (Database Configuration)

### Overview

Several limits are currently hardcoded as constants in `@tzurot/common-types`. For flexibility, these should be made configurable per-personality in the database.

**Current Constants Location**: `packages/common-types/src/constants/`

| Constant | Current Value | Domain | Status |
|----------|---------------|--------|--------|
| `MESSAGE_LIMITS.MAX_REFERENCED_MESSAGES` | 20 | message.ts | ✅ Added to LlmConfig (Migration 4) |
| `MESSAGE_LIMITS.MAX_HISTORY_FETCH` | 100 | message.ts | System-wide (no per-personality need) |
| `AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS` | 3 | ai.ts | Candidate for personality config |
| `DISCORD_MENTIONS.MAX_PER_MESSAGE` | 10 | discord.ts | Candidate for personality config |
| `DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE` | 5 | discord.ts | Candidate for personality config |
| `DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE` | 5 | discord.ts | Candidate for personality config |

### Migration 4 Update: Additional Limit Columns

Update Migration 4 to include mention limit columns in `LlmConfig`:

```prisma
model LlmConfig {
  // ... existing fields ...

  // Configurable limits (defaults match current constants)
  maxReferencedMessages     Int?        @default(20)
  maxMentionsPerMessage     Int?        @default(10)
  maxChannelsPerMessage     Int?        @default(5)
  maxRolesPerMessage        Int?        @default(5)
  ltmSearchHistoryTurns     Int?        @default(3)

  // ... rest of model ...
}
```

### Resolution Strategy

When processing a message, resolve each limit in this order:
1. **Personality-specific value** (from LlmConfig if non-null)
2. **Constant fallback** (from `@tzurot/common-types`)

```typescript
// Example usage in MessageContextBuilder
const maxMentions = personality.llmConfig?.maxMentionsPerMessage
  ?? DISCORD_MENTIONS.MAX_PER_MESSAGE;
```

### Implementation Notes

- **Nullable columns**: Use `null` to mean "use system default" (not zero)
- **Validation**: Add min/max constraints in Zod schema
  - `maxMentionsPerMessage`: min 1, max 50
  - `maxChannelsPerMessage`: min 1, max 20
  - `maxRolesPerMessage`: min 1, max 20
  - `ltmSearchHistoryTurns`: min 0, max 10
  - `maxReferencedMessages`: min 1, max 50
- **UI**: Future `/personality config` commands to modify these

### Benefits

1. **Personality customization**: Some personalities may need more/fewer mentions resolved
2. **Performance tuning**: Heavy-traffic channels can reduce limits
3. **Memory optimization**: Reduce LTM window for simpler personalities
4. **A/B testing**: Test different values per personality to find optimal settings

---

## Phase 3: Data Migration

### Task 2.7: Migrate errorMessage from custom_fields

```typescript
// scripts/migrations/migrate-error-messages.ts
async function migrateErrorMessages() {
  const personalities = await prisma.personality.findMany({
    where: {
      customFields: { not: null },
    },
  });

  let migrated = 0;
  for (const p of personalities) {
    const customFields = p.customFields as Record<string, unknown> | null;
    if (customFields?.errorMessage) {
      await prisma.personality.update({
        where: { id: p.id },
        data: { errorMessage: String(customFields.errorMessage) },
      });
      migrated++;
    }
  }

  console.log(`Migrated ${migrated} error messages`);
}
```

### Task 2.8-2.9: Extract aliases and birthdays from shapes.inc backups

**Location**: `tzurot-legacy/data/` (shapes.inc backup files)

```typescript
// scripts/migrations/import-shapes-data.ts
import fs from 'fs';
import path from 'path';

async function importShapesData() {
  const backupDir = path.join(__dirname, '../../tzurot-legacy/data');

  // Read shapes.inc backup files and extract:
  // - aliases → PersonalityAlias table
  // - birthdays → Personality.birthday
  // - errorMessages (if not already in custom_fields)

  // Implementation depends on backup file format
}
```

### Task 2.10: Assign ownership to existing personalities

```typescript
// scripts/migrations/assign-personality-ownership.ts
async function assignOwnership() {
  const BOT_OWNER_DISCORD_ID = process.env.BOT_OWNER_DISCORD_ID;
  if (!BOT_OWNER_DISCORD_ID) {
    throw new Error('BOT_OWNER_DISCORD_ID required');
  }

  // Find or create bot owner user
  let owner = await prisma.user.findUnique({
    where: { discordId: BOT_OWNER_DISCORD_ID },
  });

  if (!owner) {
    owner = await prisma.user.create({
      data: {
        discordId: BOT_OWNER_DISCORD_ID,
        username: 'Bot Owner',
        isSuperuser: true,
      },
    });
  } else if (!owner.isSuperuser) {
    await prisma.user.update({
      where: { id: owner.id },
      data: { isSuperuser: true },
    });
  }

  // Assign all unowned personalities to bot owner
  const result = await prisma.personality.updateMany({
    where: { ownerId: null },
    data: { ownerId: owner.id },
  });

  console.log(`Assigned ${result.count} personalities to bot owner`);
}
```

---

## Phase 4: Application Code

### Task 2.12: Log Sanitization Middleware

**File**: `packages/common-types/src/utils/logSanitizer.ts`

```typescript
// API key patterns to redact
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI
  /sk_[a-zA-Z0-9]{20,}/g, // Alternative format
  /AIza[a-zA-Z0-9_-]{35,}/g, // Google
  /anthropic-[a-zA-Z0-9-]{20,}/g, // Anthropic (if applicable)
];

export function sanitizeLogMessage(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

// Pino serializer for request/response objects
export function createSanitizedSerializer() {
  return {
    req: (req: unknown) => sanitizeObject(req),
    res: (res: unknown) => sanitizeObject(res),
    err: (err: unknown) => sanitizeObject(err),
  };
}

function sanitizeObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return sanitizeLogMessage(obj);
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
}
```

### Task 2.12: Update ai-worker for User API Keys

**CRITICAL SECURITY NOTE** (from Gemini):

> Do NOT pass decrypted API keys in BullMQ job payloads. Redis stores job data in plain text.
> Pass only userId in job, fetch and decrypt key inside the worker.

**Provider Strategy**: OpenRouter is the single LLM provider. Users store their OpenRouter API key.

```typescript
// services/ai-worker/src/utils/resolveApiKey.ts
import { decryptApiKey } from '@tzurot/common-types';
import { prisma } from '../db';

export interface ResolvedApiKey {
  key: string;
  source: 'user' | 'system';
}

/**
 * Resolve OpenRouter API key for a user.
 *
 * Priority:
 * 1. User's encrypted key (BYOK)
 * 2. System key (bot owner's key from environment)
 *
 * OpenRouter is the single LLM provider - it routes to underlying models.
 */
export async function resolveOpenRouterKey(userId: string): Promise<ResolvedApiKey> {
  // 1. Try user's BYOK key first
  const userKey = await prisma.userApiKey.findUnique({
    where: {
      userId_provider: { userId, provider: 'openrouter' },
    },
  });

  if (userKey && userKey.isActive) {
    const decrypted = decryptApiKey({
      iv: userKey.iv,
      content: userKey.content,
      tag: userKey.tag,
    });

    // Update lastUsedAt
    await prisma.userApiKey.update({
      where: { id: userKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      key: decrypted,
      source: 'user',
    };
  }

  // 2. Fall back to system key (bot owner's OpenRouter key)
  const systemKey = process.env.OPENROUTER_API_KEY;
  if (!systemKey) {
    throw new Error(
      'No OpenRouter API key available (user has no BYOK, system key not configured)'
    );
  }

  return {
    key: systemKey,
    source: 'system',
  };
}
```

### Task 2.13: Key Validation Service

**Provider Strategy**: Only OpenRouter keys need validation (single provider).

```typescript
// services/api-gateway/src/services/KeyValidationService.ts

/**
 * Validates OpenRouter API keys before storage.
 *
 * Makes a minimal API call to verify the key works.
 * This prevents storing invalid keys that would fail at runtime.
 */
export class KeyValidationService {
  private static readonly OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

  /**
   * Validate an OpenRouter API key by listing models.
   * Returns true if valid, throws specific error if not.
   */
  async validateOpenRouterKey(apiKey: string): Promise<boolean> {
    const response = await fetch(`${KeyValidationService.OPENROUTER_API_URL}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://tzurot.app', // Required by OpenRouter
        'X-Title': 'Tzurot Bot', // Required by OpenRouter
      },
    });

    if (response.status === 401) {
      throw new InvalidApiKeyError('Invalid OpenRouter API key');
    }
    if (response.status === 402) {
      throw new QuotaExceededError('OpenRouter account has insufficient credits');
    }
    if (response.status === 429) {
      throw new RateLimitError('OpenRouter rate limit exceeded, try again later');
    }
    if (!response.ok) {
      throw new ApiValidationError(`OpenRouter validation failed: ${response.status}`);
    }

    return true;
  }
}

// Custom error classes for specific failure modes
export class InvalidApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApiKeyError';
  }
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ApiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiValidationError';
  }
}
```

### Task 2.14: Reasoning Model Handling

**Key Discovery**: OpenRouter provides a **unified `reasoning` object** that works across all reasoning models. We don't need model-specific adapters!

**OpenRouter handles**:

- Translating `reasoning.effort` → model-specific format
- Translating `reasoning.maxTokens` → model-specific token budgets
- Parameter constraints (some models ignore temp when reasoning)

**What we need to handle**:

1. Detect if a model supports reasoning (for UI/validation)
2. Ensure `maxTokens > reasoning.maxTokens` when both are set
3. Strip `<thinking>` tags from responses (optional, for clean output)

```typescript
// services/ai-worker/src/utils/reasoningModelUtils.ts

/**
 * Models known to support reasoning/thinking.
 * OpenRouter handles the actual parameter translation.
 */
const REASONING_MODEL_PATTERNS = [
  // OpenAI
  'o1',
  'o3',
  'gpt-4o-reasoning',
  // Anthropic
  'claude-3-7',
  'claude-3.7',
  'claude-sonnet-4',
  // Google
  'gemini-2.0-flash-thinking',
  'gemini-2.5-flash-preview',
  // DeepSeek
  'deepseek-r1',
  'deepseek-reasoner',
  // Alibaba
  'qwen-qwq',
  'qwq-32b',
];

/**
 * Check if a model supports reasoning parameters.
 * Used for UI hints and validation, not for parameter translation.
 */
export function supportsReasoning(model: string): boolean {
  const modelLower = model.toLowerCase();
  return REASONING_MODEL_PATTERNS.some(pattern => modelLower.includes(pattern.toLowerCase()));
}

/**
 * Validate reasoning token budget constraints.
 * Must be called before sending to OpenRouter.
 */
export function validateReasoningBudget(
  max_tokens: number | undefined,
  reasoning_max_tokens: number | undefined
): void {
  if (reasoning_max_tokens === undefined) return;

  if (reasoning_max_tokens < 1024) {
    throw new Error('Reasoning budget must be at least 1,024 tokens');
  }
  if (reasoning_max_tokens > 32000) {
    throw new Error('Reasoning budget cannot exceed 32,000 tokens');
  }
  if (max_tokens !== undefined && max_tokens <= reasoning_max_tokens) {
    throw new Error(
      `max_tokens (${max_tokens}) must be greater than reasoning.max_tokens (${reasoning_max_tokens}) ` +
        'to leave room for the final response'
    );
  }
}

/**
 * Strip thinking/reasoning tags from response content.
 * Some models include <thinking> blocks in output.
 */
export function stripThinkingTags(content: string): string {
  // Common patterns across models
  return content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
    .trim();
}

/**
 * Extract thinking content from response (for logging/debugging).
 */
export function extractThinkingContent(content: string): string | null {
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thinkingMatch) return thinkingMatch[1].trim();

  const reasoningMatch = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
  if (reasoningMatch) return reasoningMatch[1].trim();

  return null;
}
```

**Integration in LLMInvoker**:

```typescript
// In services/ai-worker/src/services/LLMInvoker.ts

async invoke(params: InvokeParams): Promise<InvokeResult> {
  const { model, messages, advancedParams } = params;

  // Validate reasoning budget if set
  if (advancedParams?.reasoning?.max_tokens) {
    validateReasoningBudget(
      advancedParams.max_tokens,
      advancedParams.reasoning.max_tokens
    );
  }

  // Build OpenRouter request - reasoning object is passed through directly
  const request = {
    model,
    messages,
    ...advancedParams,  // Includes reasoning object if present
  };

  const response = await this.openRouterClient.chat(request);

  // Optionally strip thinking tags from response
  const content = stripThinkingTags(response.content);

  return { content, usage: response.usage };
}
```

---

## Security Checklist

Based on Gemini consultation:

- [ ] **Encryption key management**: APP_MASTER_KEY in Railway secrets (not .env file)
- [ ] **Discord ephemeral responses**: All `/wallet` commands use `ephemeral: true`
- [ ] **Log sanitization**: Regex patterns catch all API key formats
- [ ] **BullMQ security**: Only pass userId in job, not decrypted keys
- [ ] **Confused deputy prevention**: Always scope key retrieval to interaction.user.id
- [ ] **No fallback to system key on user key failure**: Mark key inactive, DM user
- [ ] **Key validation before storage**: Dry-run API call before encrypting

---

## Testing Checklist

### Unit Tests

- [ ] Encryption utilities (encrypt, decrypt, tamper detection)
- [ ] Log sanitization (all API key patterns)
- [ ] Zod schemas for advancedParameters (all providers)
- [ ] Alias uniqueness validation
- [ ] Timezone validation (IANA format)
- [ ] Reasoning model constraints

### Integration Tests

- [ ] BYOK flow: set → validate → encrypt → store → use → decrypt
- [ ] Key validation failures (invalid key, quota exceeded)
- [ ] Personality deletion cascades (aliases)
- [ ] Usage logging for text requests
- [ ] LlmConfig JSONB migration verification

### Migration Tests

- [ ] Run on 67 personality dataset
- [ ] Verify no data loss (aliases, errorMessages, birthdays)
- [ ] Test rollback procedure

---

## Rollback Plan

1. **Database**: `prisma migrate rollback` to previous state
2. **Data**: Restore from pre-migration backup (take BEFORE starting!)
3. **Application**: `git revert` to commit before changes
4. **Verification**: Confirm 67 personalities intact with original data

**CRITICAL**: Take full database backup before starting any migration!

```bash
# Railway database backup
railway run pg_dump -Fc > backup_pre_sprint2_$(date +%Y%m%d).dump
```

---

## Success Criteria

- [ ] Users can add API keys via `/wallet set` (ephemeral, modal input)
- [ ] API keys encrypted at rest (AES-256-GCM verified in DB)
- [ ] Logs sanitized (no API keys in Railway logs)
- [ ] All 67 personalities migrated with aliases/birthdays
- [ ] Custom error messages displaying correctly
- [ ] advancedParameters JSONB working for all providers
- [ ] Reasoning model constraints enforced (o1, Claude 3.7, Gemini 2.0)
- [ ] All tests passing (1715+ existing + new tests)
- [ ] Zero data loss verified

---

## References

- [ROADMAP.md](../../ROADMAP.md) - Master task list
- [PHASED_IMPLEMENTATION_PLAN.md](PHASED_IMPLEMENTATION_PLAN.md) - Phase details
- [schema-improvements-proposal.md](schema-improvements-proposal.md) - Full Prisma schemas
- [QOL_MODEL_MANAGEMENT.md](QOL_MODEL_MANAGEMENT.md) - Slash command designs
- [llm-hyperparameters-research.md](../architecture/llm-hyperparameters-research.md) - Provider parameters

---

## Changelog

- **2025-11-25**: Added Phase 2.5 for parameterizable limits (mention/channel/role limits, LTM search turns)
- **2025-11-25**: Added SDK decision section based on research + Gemini consultation
- **2025-11-25**: Created consolidated guide from multiple docs + Gemini consultation
