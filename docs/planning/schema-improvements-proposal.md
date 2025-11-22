# Database Schema Improvements Proposal

> **Date**: 2025-11-22
> **Status**: Draft for review
> **Related**: [LLM Hyperparameters Research](../architecture/llm-hyperparameters-research.md)

## Summary

This proposal addresses missing fields from shapes.inc migration, implements BYOK (Bring Your Own Key) to enable public launch, adds image synthesis support, and modernizes the LlmConfig table to support advanced AI provider parameters while solving the "wide table" problem.

**Critical Production Blocker**: BYOK is required for public launch - without it, random users can rack up expensive API bills on the bot owner's account. Since we're doing major schema changes anyway, this is the ideal time to roll BYOK in.

## User Requirements

Based on shapes.inc data analysis and user feedback:

### Critical Priority (Production Blockers)

1. **BYOK (Bring Your Own Key)** - User-provided API keys to prevent bot owner paying all costs - **BLOCKS PUBLIC LAUNCH**
2. **API Usage Tracking** - Token usage monitoring to prevent infrastructure abuse

### High Priority

3. **Custom Error Messages** - Replace generic "no job result" error with personality-specific messages
4. **Aliases** - Store as array with uniqueness constraints to prevent overlap
5. **Voice Settings** - Detailed voice configuration (ElevenLabs only for now)
6. **Image Synthesis** - Support for image generation models (OpenRouter, OpenAI, Gemini)
7. **User Timezone** - User-level setting (not personality-level) for time-aware responses
8. **Max Referenced Messages** - Currently hardcoded to 10, should be configurable
9. **Birthday** - Add flavor/character depth to personalities

### Medium Priority

10. **Advanced LLM Hyperparameters** - Support reasoning models (Claude 3.7, OpenAI o1/o3) and advanced sampling
11. **User Config Commands** - Slash commands for users to control their own LLM configs (not just admin)

### Explicitly Rejected

- Soft delete / deleted flags
- Sensitivity flags
- Custom HTML/CSS
- X/Twitter integration
- Credits tracking
- Search/discovery features

## Proposed Schema Changes

### 1. Personality Table - Add Custom Error Messages

**Rationale**: Users need personality-specific error messages instead of generic "no job result" errors.

```prisma
model Personality {
  // ... existing fields ...

  // NEW: Custom error message for job failures
  errorMessage       String?  @db.Text

  // Example: "*halo fractures* Even queens face cosmic hiccups..."
}
```

**Migration**: Default to `NULL` (fallback to generic error in application logic).

### 2. Personality Table - Add Birthday

**Rationale**: Adds character depth and flavor for time-aware personality responses.

```prisma
model Personality {
  // ... existing fields ...

  // NEW: Birthday for personality flavor
  birthday           DateTime? @db.Date

  // Example: "1990-12-24" for Lilith
}
```

**Migration**: Default to `NULL` (most personalities won't have birthdays initially).

### 3. User Table - Add Timezone

**Rationale**: User-level timezone setting (not personality-level) allows personalities to reference correct user time.

```prisma
model User {
  // ... existing fields ...

  // NEW: User timezone for time-aware responses
  timezone           String?  @default("UTC")

  // Example: "America/New_York"
  // Will be set via slash command: /timezone set America/New_York
}
```

**Migration**: Default to `"UTC"` for existing users.

**Application Changes Needed**:

- Add `/timezone` slash command (set, get)
- Update personality context to include user timezone
- Validate timezone strings against IANA database

### 4. PersonalityAlias Table - New Table for Uniqueness

**Rationale**: Aliases need to be globally unique across all personalities to prevent conflicts. Current approach stores in personality JSON which doesn't enforce uniqueness.

```prisma
model PersonalityAlias {
  id                 String      @id @default(uuid())
  alias              String      @unique @db.VarChar(50)
  personalityId      String

  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  personality        Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@index([personalityId])
  @@map("personality_aliases")
}
```

**Changes to Personality Table**:

```prisma
model Personality {
  // ... existing fields ...

  // NEW: Relationship to aliases
  aliases            PersonalityAlias[]
}
```

**Migration**:

1. Extract aliases from existing `Personality.customFields` JSON (if any)
2. Create `PersonalityAlias` records
3. Enforce uniqueness constraint (fail if duplicates exist)

**Application Changes Needed**:

- Update personality creation to check alias uniqueness
- Update personality deletion to cascade delete aliases
- Update mention detection to query `PersonalityAlias` table

### 5. VoiceConfig Table - New Table for Voice Settings

**Rationale**: Detailed voice settings are personality-specific but LlmConfig is already complex. Separating voice concerns follows single-responsibility principle.

```prisma
model VoiceConfig {
  id                 String      @id @default(uuid())
  personalityId      String      @unique

  // Voice provider settings (ElevenLabs, etc.)
  voiceId            String      @db.VarChar(100)
  voiceModel         String      @default("eleven_flash_v2_5") @db.VarChar(50)

  // Voice quality parameters
  stability          Decimal     @default(0.5) @db.Decimal(3, 2)  // 0.00-1.00
  similarity         Decimal     @default(0.75) @db.Decimal(3, 2) // 0.00-1.00
  style              Decimal     @default(0.0) @db.Decimal(3, 2)  // 0.00-1.00
  frequency          Decimal     @default(0.0) @db.Decimal(3, 2)  // 0.00-1.00 (frequency boost)

  // Metadata
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  personality        Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@map("voice_configs")
}
```

**Changes to Personality Table**:

```prisma
model Personality {
  // ... existing fields ...

  voiceEnabled       Boolean      @default(false)
  // REMOVE: voiceSettings Json?  (replaced by VoiceConfig table)

  // NEW: Relationship to voice config
  voiceConfig        VoiceConfig?
}
```

**Migration**:

1. Extract voice settings from shapes.inc backup data
2. Create `VoiceConfig` records for personalities with `voiceEnabled = true`
3. Validate stability/similarity/style/frequency are in range [0.0, 1.0]

**Application Changes Needed**:

- Update voice synthesis to query `VoiceConfig` table
- Add validation for voice parameter ranges
- Update personality creation/update to handle voice config

### 6. LlmConfig Table - Hybrid Schema Refactor

**Rationale**: Current table has 18+ columns and will balloon to 50+ if we add provider-specific advanced parameters. Gemini recommends hybrid schema: universal columns + JSONB for provider-specific params.

**Current Issues**:

- Wide table problem (sparse matrix of NULLs)
- Can't easily add new provider-specific parameters
- Some columns only used by specific providers (topK, repetitionPenalty)

**Solution**: Keep universal parameters as columns, move provider-specific and advanced parameters to JSONB.

```prisma
model LlmConfig {
  id                        String      @id @default(uuid())
  personalityId             String      @unique

  // ====== UNIVERSAL PARAMETERS (columns) ======

  // Provider identification
  provider                  String      @default("openrouter") @db.VarChar(20)
  // Values: "openai", "anthropic", "google", "openrouter"

  // Model selection
  model                     String      @db.VarChar(100)
  visionModel               String?     @db.VarChar(100)

  // Universal sampling parameters
  temperature               Decimal?    @db.Decimal(3, 2)  // 0.00-2.00
  topP                      Decimal?    @db.Decimal(4, 3)  // 0.000-1.000

  // Token limits
  maxTokens                 Int?        // Standard models

  // Memory & context (Tzurot-specific)
  memoryScoreThreshold      Decimal?    @db.Decimal(4, 3)  // 0.000-1.000
  memoryLimit               Int?        @default(20)
  maxConversationHistory    Int?        @default(50)
  maxReferencedMessages     Int?        @default(10)       // NEW: Currently hardcoded

  // ====== ADVANCED PARAMETERS (JSONB) ======

  // Provider-specific and advanced settings
  advancedParameters        Json        @default("{}")

  // Example advancedParameters structure:
  // {
  //   // Sampling (provider-specific)
  //   "topK": 40,                          // Anthropic, Gemini
  //   "minP": 0.05,                        // OpenRouter, open-source
  //   "frequencyPenalty": 0.5,             // OpenAI
  //   "presencePenalty": 0.3,              // OpenAI
  //   "repetitionPenalty": 1.1,            // OpenRouter
  //
  //   // Reasoning parameters (new)
  //   "reasoningEffort": "high",           // OpenAI o1/o3
  //   "maxCompletionTokens": 8000,         // OpenAI reasoning models
  //   "thinking": {                        // Anthropic Claude 3.7
  //     "type": "enabled",
  //     "budgetTokens": 4000
  //   },
  //
  //   // Structured outputs
  //   "jsonSchema": { ... },               // OpenAI, OpenRouter
  //   "toolChoice": "auto",                // All providers
  //
  //   // Safety (Gemini)
  //   "safetySettings": [
  //     {
  //       "category": "HARM_CATEGORY_HARASSMENT",
  //       "threshold": "BLOCK_MEDIUM_AND_ABOVE"
  //     }
  //   ],
  //
  //   // Performance
  //   "cacheControl": true,                // Anthropic prompt caching
  //   "streamResponse": true,              // All providers
  //
  //   // Other
  //   "stop": ["STOP", "END"],             // All providers
  //   "seed": 12345,                       // OpenAI, some others
  //   "logitBias": { ... },                // OpenAI
  //   "systemFingerprint": "..."           // OpenAI
  // }

  // Metadata
  createdAt                 DateTime    @default(now())
  updatedAt                 DateTime    @updatedAt

  personality               Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@index([provider])
  @@map("llm_configs")
}
```

**Migration Steps**:

1. **Add new columns**:
   - `provider` (default "openrouter")
   - `advancedParameters` (JSONB, default "{}")
   - `maxReferencedMessages` (int, default 10)

2. **Migrate existing data to JSONB**:

   ```sql
   -- Pseudocode migration
   UPDATE llm_configs SET advancedParameters = jsonb_build_object(
     'topK', top_k,
     'frequencyPenalty', frequency_penalty,
     'presencePenalty', presence_penalty,
     'repetitionPenalty', repetition_penalty,
     'stop', stop,
     'seed', seed,
     'logitBias', logit_bias,
     'responseFormat', response_format,
     'streamResponse', stream_response,
     'systemFingerprint', system_fingerprint
   ) WHERE /* any of these fields are not null */;
   ```

3. **Drop old columns**:
   - `topK`
   - `frequencyPenalty`
   - `presencePenalty`
   - `repetitionPenalty`
   - `stop`
   - `seed`
   - `logitBias`
   - `responseFormat`
   - `streamResponse`
   - `systemFingerprint`

4. **Update application code**:
   - Create Zod schemas for `advancedParameters` validation (per provider)
   - Update AI service to read from JSONB
   - Add support for new reasoning parameters
   - Implement business logic constraints (e.g., Claude 3.7 thinking requires temperature=1.0)

**Benefits**:

- ✅ No more NULL-heavy columns
- ✅ Easy to add new provider-specific parameters (no migration needed)
- ✅ Flexible schema that adapts as AI providers release new features
- ✅ Clear separation: universal params (columns) vs advanced params (JSONB)
- ✅ Can still query by provider: `WHERE provider = 'anthropic'`

**Validation Strategy**:

Use Zod schemas in application layer to validate JSONB structure:

```typescript
// @tzurot/common-types/src/schemas/llmConfigSchemas.ts

const BaseAdvancedParamsSchema = z.object({
  // Common across providers
  stop: z.array(z.string()).optional(),
  streamResponse: z.boolean().optional(),
});

const OpenAIAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  seed: z.number().int().optional(),
  logitBias: z.record(z.number()).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  maxCompletionTokens: z.number().int().positive().optional(),
  jsonSchema: z.object({}).passthrough().optional(),
});

const AnthropicAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  topK: z.number().int().min(1).max(500).optional(),
  thinking: z
    .object({
      type: z.enum(['enabled', 'disabled']),
      budgetTokens: z.number().int().min(1024).max(10000),
    })
    .optional(),
  cacheControl: z.boolean().optional(),
});

const GeminiAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  topK: z.number().int().min(1).max(100).optional(),
  safetySettings: z
    .array(
      z.object({
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
      })
    )
    .optional(),
});

const OpenRouterAdvancedParamsSchema = BaseAdvancedParamsSchema.extend({
  minP: z.number().min(0).max(1).optional(),
  topA: z.number().min(0).max(1).optional(),
  typicalP: z.number().min(0).max(1).optional(),
  repetitionPenalty: z.number().min(0.1).max(2).optional(),
  transforms: z.array(z.string()).optional(),
});

// Provider-specific validation
export function validateAdvancedParams(provider: string, params: unknown) {
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
```

### 7. UserApiKey Table - BYOK Support (Production Blocker)

**Rationale**: BYOK is required for public launch. Without it, random users can rack up expensive API bills on the bot owner's account. This implements secure, encrypted storage of user-provided API keys with validation and hierarchical inheritance (user wallet → persona override).

```prisma
model UserApiKey {
  id          String   @id @default(uuid())
  userId      String

  // Provider identification
  provider    String   @db.VarChar(20)
  // Values: "openai", "anthropic", "google", "openrouter"

  // AES-256-GCM encryption fields
  iv          String   @db.VarChar(32)   // Initialization Vector (hex)
  content     String   @db.Text          // Encrypted API key (hex)
  tag         String   @db.VarChar(32)   // Auth tag (hex)

  // Status
  isActive    Boolean  @default(true)    // False if validation fails

  // Metadata
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  lastUsedAt  DateTime?

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider]) // One key per provider per user
  @@index([userId])
  @@index([provider])
  @@map("user_api_keys")
}
```

**Changes to User Table**:

```prisma
model User {
  // ... existing fields ...

  // NEW: Relationship to API keys
  apiKeys     UserApiKey[]
}
```

**Security Implementation**:

1. **Encryption Utility** (`packages/common-types/src/utils/encryption.ts`):

   ```typescript
   import crypto from 'crypto';

   const ALGORITHM = 'aes-256-gcm';
   const ENCRYPTION_KEY = Buffer.from(process.env.APP_MASTER_KEY!, 'hex'); // 32 bytes

   export const encryptApiKey = (text: string) => {
     const iv = crypto.randomBytes(16);
     const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
     let encrypted = cipher.update(text, 'utf8', 'hex');
     encrypted += cipher.final('hex');
     const authTag = cipher.getAuthTag().toString('hex');

     return {
       iv: iv.toString('hex'),
       content: encrypted,
       tag: authTag,
     };
   };

   export const decryptApiKey = (encrypted: { iv: string; content: string; tag: string }) => {
     const decipher = crypto.createDecipheriv(
       ALGORITHM,
       ENCRYPTION_KEY,
       Buffer.from(encrypted.iv, 'hex')
     );
     decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
     let decrypted = decipher.update(encrypted.content, 'hex', 'utf8');
     decrypted += decipher.final('utf8');
     return decrypted;
   };
   ```

2. **Key Validation Strategy**:
   - User submits key via Discord Modal (ephemeral, not visible in chat)
   - **Immediate dry run**: Make minimal API call (e.g., `models.list` or completion with `max_tokens: 1`)
   - **If success**: Encrypt and store in database with `isActive: true`
   - **If fail**: Return specific error (Invalid Key / Quota Exceeded) - **DO NOT STORE**

3. **Hierarchical Inheritance**:
   - Users configure keys globally in their "wallet" (`/wallet set openai sk-...`)
   - Personas inherit from user's wallet by default
   - Personas can optionally override provider/model in LlmConfig

4. **Fallback Strategy**:
   - **CRITICAL**: Do NOT fallback to bot owner's key if user's key fails
   - Mark key as `isActive: false` and DM user
   - For 429 (Quota Exceeded): DM user to check their account

5. **Discord Security Best Practices**:
   - All key commands return `ephemeral: true` (only user can see response)
   - Use Discord Modals for key input (more secure than slash command args)
   - Sanitize logs: Regex match `sk-...`, `sk_...`, `AIza...` and replace with `[REDACTED]`

**Migration**:

1. Generate `APP_MASTER_KEY` (32 bytes) and add to Railway environment variables
2. Create `UserApiKey` table
3. No data migration (new feature - users will add keys via commands)

**Application Changes Needed**:

- Add `/wallet` command group (set, list, remove, test)
- Update `ai-worker` to accept encrypted API key in job payload
- Add key validation service
- Add log sanitization middleware
- Update AI provider clients to use decrypted user keys

### 8. UsageLog Table - Token Usage Tracking

**Rationale**: Even with BYOK, need to track token usage to prevent abuse of infrastructure (CPU/RAM, bandwidth, pgvector operations). Track tokens (not dollars) since pricing changes too often.

```prisma
model UsageLog {
  id           String   @id @default(uuid())
  userId       String
  personaId    String?  // Optional: which persona generated this

  // Provider & model
  provider     String   @db.VarChar(20)
  model        String   @db.VarChar(100)

  // Token counts
  tokensIn     Int      // Input tokens
  tokensOut    Int      // Output tokens
  tokensTotal  Int      // tokensIn + tokensOut

  // Request type
  requestType  String   @db.VarChar(20)  // "text", "voice", "image"

  // Metadata
  timestamp    DateTime @default(now())

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, timestamp])
  @@index([provider])
  @@index([requestType])
  @@map("usage_logs")
}
```

**Changes to User Table**:

```prisma
model User {
  // ... existing fields ...

  // NEW: Relationship to usage logs
  usageLogs   UsageLog[]
}
```

**Usage Tracking Strategy**:

- Log every AI request (text generation, voice synthesis, image generation)
- For image generation: Use approximate token equivalent (e.g., 1 image = 1000 tokens)
- Implement rate limiting based on token usage (not dollars)
- Provide `/usage` command for users to view their stats

**Application Changes Needed**:

- Add usage logging to ai-worker after each request
- Add `/usage` command (daily/weekly/monthly stats)
- Add rate limiting middleware based on usage logs
- Add admin command to view global usage stats

### 9. ImageConfig Table - Image Synthesis Support

**Rationale**: Image synthesis is a natural extension given voice support. OpenRouter now supports image models (DALL-E 3, Flux, Stable Diffusion). Use JSONB for provider-specific parameters (same pattern as LlmConfig).

```prisma
model ImageConfig {
  id                 String      @id @default(uuid())
  personalityId      String      @unique

  // Provider & model
  provider           String      @default("openrouter") @db.VarChar(20)
  // Values: "openai", "google", "openrouter"
  model              String      @db.VarChar(100)
  // Examples: "dall-e-3", "black-forest-labs/flux-pro", "stable-diffusion-xl"

  // Universal parameters (columns)
  enabled            Boolean     @default(false)
  defaultSize        String      @default("1024x1024") @db.VarChar(20)
  // Common sizes: "1024x1024", "1792x1024", "1024x1792"

  // Provider-specific parameters (JSONB)
  advancedParameters Json        @default("{}")

  // Example advancedParameters structure:
  // {
  //   // OpenAI specific
  //   "quality": "hd",                    // "standard" or "hd"
  //   "style": "vivid",                   // "vivid" or "natural"
  //
  //   // Stable Diffusion / Flux (OpenRouter)
  //   "steps": 25,                        // 1-50 denoising steps
  //   "guidanceScale": 7.5,               // 1.0-20.0 CFG
  //   "negativePrompt": "blurry, low quality, extra fingers",
  //   "seed": 12345,
  //   "scheduler": "DPM++ 2M Karras",
  //
  //   // Google Gemini
  //   "aspectRatio": "1:1",               // "1:1", "16:9", "4:3"
  //   "safetyFilterLevel": "block_medium_and_above",
  //
  //   // Personality-specific
  //   "promptPrefix": "A pixel art style image of...",
  //   "defaultNegativePrompt": "text, watermark"
  // }

  // Metadata
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  personality        Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@index([provider])
  @@map("image_configs")
}
```

**Changes to Personality Table**:

```prisma
model Personality {
  // ... existing fields ...

  // NEW: Relationship to image config
  imageConfig        ImageConfig?
}
```

**Image Generation Flow**:

1. User sends command (e.g., `/imagine a sunset over the ocean`)
2. **Immediate defer**: Discord interaction tokens expire in 3 seconds - use `interaction.defer()`
3. API Gateway creates image generation job in BullMQ
4. AI Worker:
   - Fetch personality's ImageConfig
   - Decrypt user's API key (or use bot owner's key for free tier)
   - Prepend `promptPrefix` to user's prompt (e.g., "A pixel art style image of a sunset...")
   - Add `negativePrompt` (e.g., "blurry, low quality")
   - Request image with `response_format: "b64_json"` (NOT url - URLs expire!)
5. Decode base64 → Buffer → Upload to Discord as `File` attachment
6. Log usage (approximate 1 image = 1000 tokens)
7. `interaction.followup.send()` with image attachment

**Cost Considerations**:

- **DALL-E 3**: $0.040 (standard) / $0.080 (HD) per image - **expensive**
- **Flux Schnell**: ~$0.003 per image - **cheapest, recommended default**
- **Flux Pro**: ~$0.055 per image - **premium quality**
- **SDXL**: ~$0.006 per image - **good balance**

**Migration**:

1. Create `ImageConfig` table
2. No data migration (new feature)
3. Default all personalities to `enabled: false` (opt-in feature)

**Application Changes Needed**:

- Add `/imagine` command (or integrate into personality mention)
- Add image generation job handler in ai-worker
- Add provider-specific image generation clients (OpenAI, OpenRouter, Gemini)
- Add Zod schemas for image advancedParameters validation
- Add base64 decoding and Discord file upload
- Update usage logging to handle image requests

**Provider-Specific Implementation Notes**:

1. **Output Format**: Always request `b64_json` (NOT `url`) because:
   - URLs expire after 60 minutes
   - Base64 → Buffer → Discord CDN = permanent image

2. **Prompt Engineering**:
   - **DALL-E 3**: Send user's raw prompt (model is smart enough)
   - **SDXL/Flux**: Prepend personality's `promptPrefix` for style consistency

3. **Rate Limiting**:
   - Image generation is slower than text (5-30 seconds depending on model)
   - Implement per-user rate limit (e.g., 10 images/hour for free tier)

**Validation Strategy**:

Use Zod schemas for advancedParameters validation (similar to LlmConfig):

```typescript
const OpenAIImageParamsSchema = z.object({
  quality: z.enum(['standard', 'hd']).optional(),
  style: z.enum(['vivid', 'natural']).optional(),
});

const StableDiffusionParamsSchema = z.object({
  steps: z.number().int().min(1).max(50).optional(),
  guidanceScale: z.number().min(1.0).max(20.0).optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().int().optional(),
  scheduler: z.string().optional(),
});

const GeminiImageParamsSchema = z.object({
  aspectRatio: z.enum(['1:1', '16:9', '4:3', '3:4', '9:16']).optional(),
  safetyFilterLevel: z.string().optional(),
});

export function validateImageParams(provider: string, params: unknown) {
  switch (provider) {
    case 'openai':
      return OpenAIImageParamsSchema.parse(params);
    case 'openrouter':
      return StableDiffusionParamsSchema.parse(params);
    case 'google':
      return GeminiImageParamsSchema.parse(params);
    default:
      return z.object({}).parse(params);
  }
}
```

## Complete Migration Checklist

### Database Migrations

**Personality Table Updates:**

- [ ] Add `Personality.errorMessage` (String?, Text)
- [ ] Add `Personality.birthday` (DateTime?, Date)
- [ ] Add `Personality.aliases` relationship
- [ ] Add `Personality.voiceConfig` relationship
- [ ] Add `Personality.imageConfig` relationship
- [ ] Remove `Personality.voiceSettings` JSON column

**User Table Updates:**

- [ ] Add `User.timezone` (String, default "UTC")
- [ ] Add `User.apiKeys` relationship
- [ ] Add `User.usageLogs` relationship

**New Tables:**

- [ ] Create `PersonalityAlias` table with unique constraint on `alias`
- [ ] Create `VoiceConfig` table (ElevenLabs parameters)
- [ ] Create `UserApiKey` table (BYOK - encrypted API keys)
- [ ] Create `UsageLog` table (token usage tracking)
- [ ] Create `ImageConfig` table (image synthesis parameters)

**LlmConfig Table Refactor:**

- [ ] Add `LlmConfig.provider` (String, default "openrouter")
- [ ] Add `LlmConfig.advancedParameters` (Json, default "{}")
- [ ] Add `LlmConfig.maxReferencedMessages` (Int, default 10)
- [ ] Migrate existing LlmConfig columns to advancedParameters JSONB
- [ ] Drop old LlmConfig columns (topK, frequencyPenalty, etc.)

### Data Migration Scripts

**Shapes.inc Data Extraction:**

- [ ] Extract aliases from 66 personalities → PersonalityAlias table
- [ ] Extract voice settings from personalities → VoiceConfig table
- [ ] Extract error messages → Personality.errorMessage
- [ ] Extract birthdays → Personality.birthday
- [ ] Validate all migrated data (no data loss, 66 personalities)

**LlmConfig Migration:**

- [ ] Migrate existing LlmConfig columns to advancedParameters JSONB
- [ ] Verify no data loss in migration

**BYOK Setup:**

- [ ] Generate APP_MASTER_KEY (32 bytes) for Railway environment
- [ ] Document key rotation procedure

### Application Code Changes

**Core Infrastructure (BYOK):**

- [ ] Create encryption utilities (`packages/common-types/src/utils/encryption.ts`)
- [ ] Add log sanitization middleware (regex for API keys)
- [ ] Update ai-worker to accept encrypted API key in job payload
- [ ] Update AI provider clients to use decrypted user keys
- [ ] Add key validation service (dry run API calls)

**Zod Validation Schemas:**

- [ ] Create LLM advancedParameters schemas (per provider)
- [ ] Create Image advancedParameters schemas (per provider)
- [ ] Add business logic constraints (Claude 3.7 thinking+temperature, etc.)

**Discord Commands - Wallet Management:**

- [ ] Add `/wallet set <provider>` command (Modal input, ephemeral)
- [ ] Add `/wallet list` command (show configured providers, ephemeral)
- [ ] Add `/wallet remove <provider>` command
- [ ] Add `/wallet test <provider>` command (validate key still works)

**Discord Commands - Config Management:**

- [ ] Add `/config` command group for users to manage LLM settings
- [ ] Add `/timezone set` command (dropdown of common timezones)
- [ ] Add `/timezone get` command
- [ ] Add `/usage` command (daily/weekly/monthly token stats)

**Discord Commands - Image Generation:**

- [ ] Add `/imagine <prompt>` command
- [ ] Add interaction defer (3 second timeout handling)
- [ ] Add base64 → Buffer → Discord File upload

**Personality System Updates:**

- [ ] Update personality creation to handle aliases (uniqueness check)
- [ ] Update personality deletion to cascade (aliases, voice config, image config)
- [ ] Update mention detection to query PersonalityAlias table
- [ ] Update error handling to use custom errorMessage
- [ ] Update personality context to include user timezone

**AI Service Updates:**

- [ ] Update AI service to read LLM advancedParameters from JSONB
- [ ] Add support for reasoning parameters (Claude 3.7, OpenAI o1/o3)
- [ ] Update voice synthesis to query VoiceConfig table
- [ ] Add image generation job handler in ai-worker
- [ ] Add provider-specific image generation clients (OpenAI, OpenRouter, Gemini)

**Usage Tracking & Rate Limiting:**

- [ ] Add usage logging to ai-worker (text, voice, image)
- [ ] Add rate limiting middleware based on usage logs
- [ ] Add admin command to view global usage stats

### Testing

**Unit Tests:**

- [ ] Test encryption/decryption utilities
- [ ] Test log sanitization (API keys redacted)
- [ ] Test alias uniqueness constraint enforcement
- [ ] Test voice config parameter validation (0.0-1.0 ranges)
- [ ] Test timezone validation (IANA database)
- [ ] Test LLM advancedParameters Zod validation (all providers)
- [ ] Test image advancedParameters Zod validation (all providers)
- [ ] Test reasoning parameter constraints (Claude 3.7 thinking+temperature)

**Integration Tests:**

- [ ] Test BYOK flow: set key → validate → encrypt → store → use → decrypt
- [ ] Test key validation failures (invalid key, quota exceeded)
- [ ] Test hierarchical inheritance (user wallet → persona override)
- [ ] Test personality deletion cascades (aliases, voice config, image config)
- [ ] Test `/imagine` command end-to-end (defer → job → generate → upload)
- [ ] Test usage logging for all request types (text, voice, image)
- [ ] Test rate limiting enforcement

**Migration Tests:**

- [ ] Test migration scripts with 66 shapes.inc personalities
- [ ] Verify no data loss (aliases, voice settings, error messages, birthdays)
- [ ] Test rollback procedure

### Documentation

**User-Facing Documentation:**

- [ ] Create user guide for `/wallet` commands (how to get API keys from providers)
- [ ] Create user guide for `/timezone` command
- [ ] Create user guide for `/imagine` command
- [ ] Document provider costs (OpenRouter, OpenAI, Gemini) for transparency

**Developer Documentation:**

- [ ] Update API documentation for new endpoints
- [ ] Document advancedParameters JSONB structure (LLM & image, per provider)
- [ ] Document encryption key rotation procedure
- [ ] Document migration process and rollback procedures
- [ ] Update CHANGELOG.md with breaking changes
- [ ] Update CURRENT_WORK.md with BYOK implementation status

**Security Documentation:**

- [ ] Document API key storage security (AES-256-GCM)
- [ ] Document log sanitization patterns
- [ ] Document Discord security best practices (ephemeral, modals)

## Rollback Plan

If migration fails:

1. **Database Rollback**: Use Prisma migrate rollback
2. **Data Recovery**: Restore from pre-migration backup
3. **Application Rollback**: Revert to previous commit before schema changes

**Critical**: Take full database backup before starting migration.

## Version Impact

**Breaking Changes**: Yes - this is a schema migration with application code changes.

**Recommended Version**: `3.0.0-alpha.48` (schema changes during alpha testing)

**User Impact**: Minimal - most changes are additive. Only LlmConfig refactor requires data migration, but no user-visible behavior changes.

## Timeline Estimate

- **Schema Design Review**: 1 session
- **Prisma Migration Writing**: 1 session
- **Data Migration Scripts**: 2 sessions
- **Application Code Updates**: 3-4 sessions
- **Testing & Validation**: 2 sessions
- **Documentation**: 1 session

**Total**: ~10-12 development sessions

## Open Questions

1. **Voice Config**: Should we support multiple voice providers (ElevenLabs, Azure, etc.) with provider-specific fields?
2. **Timezone Command**: Should `/timezone` support natural language ("Eastern Time") or require IANA format ("America/New_York")?
3. **Advanced Parameters**: Should we provide UI/commands for users to tweak these, or keep them admin-only?
4. **Migration Testing**: Do we have sufficient shapes.inc backup data to test the full migration?

## Next Steps

1. Review this proposal with user
2. Address open questions
3. Create Prisma migration files
4. Write data migration scripts
5. Implement application code changes
6. Test thoroughly in development
7. Deploy to Railway development environment
8. Monitor for issues before production release
