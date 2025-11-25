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
  iv: string;      // 16 bytes as hex (32 chars)
  content: string; // Ciphertext as hex
  tag: string;     // 16 bytes as hex (32 chars)
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

```typescript
// packages/common-types/src/schemas/llmAdvancedParams.ts
import { z } from 'zod';

// Base schema - common across all providers
const BaseAdvancedParamsSchema = z.object({
  stop: z.array(z.string()).optional(),
  streamResponse: z.boolean().optional(),
});

// OpenAI-specific parameters
export const OpenAIAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  seed: z.number().int().optional(),
  logitBias: z.record(z.number()).optional(),
  // Reasoning models (o1, o3)
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  maxCompletionTokens: z.number().int().positive().optional(),
  // Note: o1 doesn't support system role - handled in LLMInvoker
});

// Anthropic-specific parameters
export const AnthropicAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  topK: z.number().int().min(1).max(500).optional(),
  // Claude 3.7 thinking/extended thinking
  thinking: z.object({
    type: z.enum(['enabled', 'disabled']),
    budgetTokens: z.number().int().min(1024).max(32000),
  }).optional(),
  cacheControl: z.boolean().optional(),
});

// Gemini-specific parameters
export const GeminiAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  topK: z.number().int().min(1).max(100).optional(),
  // Gemini 2.0 thinking
  thinkingConfig: z.object({
    thinkingBudget: z.number().int().min(0).max(24576).optional(),
  }).optional(),
  safetySettings: z.array(z.object({
    category: z.enum([
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ]),
    threshold: z.enum([
      'BLOCK_NONE',
      'BLOCK_ONLY_HIGH',
      'BLOCK_MEDIUM_AND_ABOVE',
      'BLOCK_LOW_AND_ABOVE',
    ]),
  })).optional(),
});

// OpenRouter-specific parameters
export const OpenRouterAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  minP: z.number().min(0).max(1).optional(),
  topA: z.number().min(0).max(1).optional(),
  typicalP: z.number().min(0).max(1).optional(),
  repetitionPenalty: z.number().min(0.1).max(2).optional(),
  transforms: z.array(z.string()).optional(),
});

// Provider type
export type LlmProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

// Union schema for validation
export function validateAdvancedParams(provider: LlmProvider, params: unknown) {
  switch (provider) {
    case 'openai':
      return OpenAIAdvancedParamsSchema.parse(params);
    case 'anthropic':
      return AnthropicAdvancedParamsSchema.parse(params);
    case 'google':
      return GeminiAdvancedParamsSchema.parse(params);
    case 'openrouter':
      return OpenRouterAdvancedParamsSchema.parse(params);
    default:
      return BaseAdvancedParamsSchema.parse(params);
  }
}

// Type exports
export type OpenAIAdvancedParams = z.infer<typeof OpenAIAdvancedParamsSchema>;
export type AnthropicAdvancedParams = z.infer<typeof AnthropicAdvancedParamsSchema>;
export type GeminiAdvancedParams = z.infer<typeof GeminiAdvancedParamsSchema>;
export type OpenRouterAdvancedParams = z.infer<typeof OpenRouterAdvancedParamsSchema>;
```

**Tests**: `packages/common-types/src/schemas/llmAdvancedParams.test.ts`
- Test each provider schema validates correctly
- Test invalid values are rejected
- Test unknown provider falls back to base schema

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

**Task 2.1 from ROADMAP.md**

```prisma
model UserApiKey {
  id          String    @id @default(uuid())
  userId      String

  // Provider identification
  provider    String    @db.VarChar(20)
  // Values: "openai", "anthropic", "google", "openrouter"

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
  @@index([provider])
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
    if (config.frequencyPenalty !== null) advancedParams.frequencyPenalty = Number(config.frequencyPenalty);
    if (config.presencePenalty !== null) advancedParams.presencePenalty = Number(config.presencePenalty);
    if (config.repetitionPenalty !== null) advancedParams.repetitionPenalty = Number(config.repetitionPenalty);
    if (config.stop !== null) advancedParams.stop = config.stop;
    if (config.seed !== null) advancedParams.seed = config.seed;
    if (config.logitBias !== null) advancedParams.logitBias = config.logitBias;
    if (config.responseFormat !== null) advancedParams.responseFormat = config.responseFormat;
    if (config.streamResponse !== null) advancedParams.streamResponse = config.streamResponse;
    if (config.systemFingerprint !== null) advancedParams.systemFingerprint = config.systemFingerprint;

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
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI
  /sk_[a-zA-Z0-9]{20,}/g,           // Alternative format
  /AIza[a-zA-Z0-9_-]{35,}/g,        // Google
  /anthropic-[a-zA-Z0-9-]{20,}/g,   // Anthropic (if applicable)
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

### Task 2.13: Update ai-worker for User API Keys

**CRITICAL SECURITY NOTE** (from Gemini):
> Do NOT pass decrypted API keys in BullMQ job payloads. Redis stores job data in plain text.
> Pass only userId in job, fetch and decrypt key inside the worker.

```typescript
// services/ai-worker/src/utils/resolveApiKey.ts
import { decryptApiKey } from '@tzurot/common-types';
import { prisma } from '../db';

export interface ResolvedApiKey {
  key: string;
  provider: string;
  source: 'user' | 'system';
}

export async function resolveApiKey(
  userId: string,
  provider: string
): Promise<ResolvedApiKey> {
  // 1. Try user's key first
  const userKey = await prisma.userApiKey.findUnique({
    where: {
      userId_provider: { userId, provider },
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
      provider,
      source: 'user',
    };
  }

  // 2. Fall back to system key (from environment)
  const envKeyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  const systemKey = envKeyMap[provider];
  if (!systemKey) {
    throw new Error(`No API key available for provider: ${provider}`);
  }

  return {
    key: systemKey,
    provider,
    source: 'system',
  };
}
```

### Task 2.14: Key Validation Service

```typescript
// services/api-gateway/src/services/KeyValidationService.ts

export class KeyValidationService {
  /**
   * Validate an API key by making a minimal API call.
   * Returns true if valid, throws specific error if not.
   */
  async validateKey(provider: string, apiKey: string): Promise<boolean> {
    switch (provider) {
      case 'openai':
        return this.validateOpenAI(apiKey);
      case 'anthropic':
        return this.validateAnthropic(apiKey);
      case 'google':
        return this.validateGoogle(apiKey);
      case 'openrouter':
        return this.validateOpenRouter(apiKey);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private async validateOpenAI(apiKey: string): Promise<boolean> {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.status === 401) {
      throw new InvalidApiKeyError('openai', 'Invalid API key');
    }
    if (response.status === 429) {
      throw new QuotaExceededError('openai', 'Rate limit or quota exceeded');
    }
    if (!response.ok) {
      throw new ApiValidationError('openai', `Unexpected error: ${response.status}`);
    }

    return true;
  }

  // Similar implementations for other providers...
}

// Custom error classes
export class InvalidApiKeyError extends Error {
  constructor(public provider: string, message: string) {
    super(message);
    this.name = 'InvalidApiKeyError';
  }
}

export class QuotaExceededError extends Error {
  constructor(public provider: string, message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class ApiValidationError extends Error {
  constructor(public provider: string, message: string) {
    super(message);
    this.name = 'ApiValidationError';
  }
}
```

### Task 2.16: Thinking/Reasoning Model Handling

**Key Constraints** (from research):
- **OpenAI o1/o3**: No system role support, use `max_completion_tokens` not `max_tokens`
- **Claude 3.7**: When thinking enabled, temperature must be 1.0, no top_p/top_k
- **Gemini 2.0**: Uses `thinkingConfig.thinkingBudget`

```typescript
// services/ai-worker/src/utils/reasoningModelAdapter.ts

export interface ReasoningModelConfig {
  supportsSystemPrompt: boolean;
  requiresFixedTemperature: boolean;
  fixedTemperature?: number;
  tokenParamName: 'max_tokens' | 'max_completion_tokens';
  thinkingParamPath?: string; // e.g., 'thinking.budgetTokens'
}

const REASONING_MODEL_CONFIGS: Record<string, ReasoningModelConfig> = {
  'o1': {
    supportsSystemPrompt: false,
    requiresFixedTemperature: false,
    tokenParamName: 'max_completion_tokens',
  },
  'o1-mini': {
    supportsSystemPrompt: false,
    requiresFixedTemperature: false,
    tokenParamName: 'max_completion_tokens',
  },
  'o3-mini': {
    supportsSystemPrompt: false,
    requiresFixedTemperature: false,
    tokenParamName: 'max_completion_tokens',
  },
  'claude-3-7-sonnet': {
    supportsSystemPrompt: true,
    requiresFixedTemperature: true,
    fixedTemperature: 1.0,
    tokenParamName: 'max_tokens',
    thinkingParamPath: 'thinking',
  },
  'gemini-2.0-flash-thinking': {
    supportsSystemPrompt: true,
    requiresFixedTemperature: false,
    tokenParamName: 'max_tokens',
    thinkingParamPath: 'thinkingConfig',
  },
};

export function isReasoningModel(model: string): boolean {
  return Object.keys(REASONING_MODEL_CONFIGS).some(key =>
    model.toLowerCase().includes(key.toLowerCase())
  );
}

export function getReasoningConfig(model: string): ReasoningModelConfig | null {
  for (const [key, config] of Object.entries(REASONING_MODEL_CONFIGS)) {
    if (model.toLowerCase().includes(key.toLowerCase())) {
      return config;
    }
  }
  return null;
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

- **2025-11-25**: Created consolidated guide from multiple docs + Gemini consultation
