---
name: tzurot-shared-types
description: Type management for Tzurot v3 - Zod schemas, type guards, DTOs, workspace exports, and ensuring type safety across microservices. Use when creating types or working with data validation.
---

# Tzurot v3 Shared Types & Validation

**Use this skill when:** Creating new types, adding data validation, sharing types across services, or working with Discord/AI provider data structures.

## Core Principle

**In a microservices architecture, type mismatches between services cause silent failures.**

If bot-client pushes job data that ai-worker can't parse, the job fails silently with no user feedback. Type safety and runtime validation are CRITICAL.

## Type Organization

### Packages/Common-Types Structure

```
packages/common-types/src/
├── types/                  # TypeScript interfaces
│   ├── discord-types.ts   # Discord.js extensions
│   ├── ai-types.ts        # AI provider request/response
│   ├── queue-types.ts     # BullMQ job data types
│   ├── personality-types.ts
│   └── schemas.ts         # Zod schemas for validation
│
├── services/              # Shared service classes
├── utils/                 # Utility functions
├── constants/             # Application constants
└── index.ts              # Barrel export
```

### When Types Belong in Common-Types

**✅ Add to common-types when:**
1. **Used by 2+ services** - Cross-service data contracts
2. **Queue job data** - BullMQ job payloads
3. **API request/response** - HTTP contract between bot-client and api-gateway
4. **Discord type extensions** - Reusable Discord.js type narrowing
5. **AI provider types** - OpenRouter/Gemini request/response shapes

**❌ Keep local when:**
1. **Service-specific** - Only used within one service
2. **Implementation details** - Internal data structures
3. **Temporary types** - Transitional refactoring types

## Zod Schemas for Runtime Validation

**Always use Zod for data entering service boundaries:**

### Why Zod?

- **Runtime validation** - TypeScript only checks at compile time
- **Type inference** - Generate TypeScript types from schemas
- **Error messages** - Clear validation failure details
- **Composable** - Build complex schemas from simple ones

### Schema Pattern

```typescript
import { z } from 'zod';

// Define Zod schema
export const PersonalityConfigSchema = z.object({
  name: z.string().min(1).max(100),
  systemPrompt: z.string().min(10),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

// Infer TypeScript type from schema
export type PersonalityConfig = z.infer<typeof PersonalityConfigSchema>;

// Validation function
export function validatePersonalityConfig(
  data: unknown
): PersonalityConfig {
  return PersonalityConfigSchema.parse(data);
}
```

### Usage in Services

```typescript
// api-gateway/routes/ai.ts
app.post('/ai/generate', (req, res) => {
  try {
    // Validate incoming request
    const request = AIGenerationRequestSchema.parse(req.body);

    // Type-safe from here on
    const job = await queue.add('llm-generation', request);

    res.json({ jobId: job.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    throw error;
  }
});
```

## Type Guards

**Type guards narrow TypeScript types at runtime**

### Discord Type Guards

```typescript
// packages/common-types/src/types/discord-types.ts
import type { Message, TextChannel, DMChannel } from 'discord.js';

/**
 * Type guard to check if a channel is a text-based channel
 */
export function isTextChannel(channel: any): channel is TextChannel {
  return channel?.type === 0; // ChannelType.GuildText
}

/**
 * Type guard to check if a channel is a DM
 */
export function isDMChannel(channel: any): channel is DMChannel {
  return channel?.type === 1; // ChannelType.DM
}

/**
 * Type guard for messages with attachments
 */
export function hasAttachments(message: Message): boolean {
  return message.attachments.size > 0;
}

/**
 * Type guard for voice message attachments
 */
export function hasVoiceMessage(message: Message): boolean {
  return Array.from(message.attachments.values()).some(
    attachment =>
      attachment.contentType?.startsWith('audio/') ||
      attachment.name?.endsWith('.ogg') ||
      attachment.name?.endsWith('.mp3')
  );
}
```

### Usage

```typescript
// bot-client/handlers/messageCreate.ts
import { isTextChannel, hasAttachments } from '@tzurot/common-types';

client.on('messageCreate', async (message) => {
  // Type narrowing with guard
  if (!isTextChannel(message.channel)) {
    return; // Only handle text channels
  }

  // Now message.channel is typed as TextChannel
  const permissions = message.channel.permissionsFor(client.user!);

  if (hasAttachments(message)) {
    // Handle attachments
  }
});
```

## DTOs (Data Transfer Objects)

**DTOs define data shapes for cross-service communication**

### BullMQ Job Data

```typescript
// packages/common-types/src/types/queue-types.ts
import { z } from 'zod';

/**
 * LLM Generation Job Data
 * Sent from api-gateway to ai-worker via BullMQ
 */
export const LLMGenerationJobDataSchema = z.object({
  requestId: z.string(),
  personalityId: z.string(),
  channelId: z.string(),
  guildId: z.string().optional(),
  userId: z.string(),
  userMessage: z.string(),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string().datetime(),
  })),
  attachments: z.array(z.object({
    url: z.string().url(),
    type: z.enum(['image', 'voice']),
    description: z.string().optional(),
  })).optional(),
});

export type LLMGenerationJobData = z.infer<typeof LLMGenerationJobDataSchema>;
```

### HTTP API Request/Response

```typescript
// packages/common-types/src/types/ai-types.ts
import { z } from 'zod';

/**
 * AI Generation Request
 * POST /ai/generate from bot-client
 */
export const AIGenerationRequestSchema = z.object({
  personalityName: z.string(),
  message: z.string(),
  channelId: z.string(),
  guildId: z.string().optional(),
  userId: z.string(),
  username: z.string(),
  referencedMessageId: z.string().optional(),
  attachments: z.array(z.object({
    url: z.string().url(),
    contentType: z.string(),
    name: z.string(),
  })).optional(),
});

export type AIGenerationRequest = z.infer<typeof AIGenerationRequestSchema>;

/**
 * AI Generation Response
 * Returned to bot-client
 */
export const AIGenerationResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  personalityName: z.string(),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }).optional(),
});

export type AIGenerationResponse = z.infer<typeof AIGenerationResponseSchema>;
```

## Workspace Type Exports

### Package.json Exports

```json
// packages/common-types/package.json
{
  "name": "@tzurot/common-types",
  "version": "3.0.0-alpha.43",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./types": "./dist/types/index.js",
    "./services": "./dist/services/index.js",
    "./constants": "./dist/constants/index.js"
  },
  "typesVersions": {
    "*": {
      "*": ["./dist/*"]
    }
  }
}
```

### Barrel Exports

```typescript
// packages/common-types/src/index.ts
export * from './types/index.js';
export * from './services/index.js';
export * from './constants/index.js';
export * from './utils/index.js';
export * from './errors/index.js';

// packages/common-types/src/types/index.ts
export * from './discord-types.js';
export * from './ai-types.js';
export * from './queue-types.js';
export * from './personality-types.js';
export * from './schemas.js';
```

### Importing in Services

```typescript
// ✅ GOOD - Import from package
import {
  AIGenerationRequest,
  LLMGenerationJobData,
  isTextChannel,
  PersonalityConfigSchema,
} from '@tzurot/common-types';

// ❌ BAD - Direct file imports
import { AIGenerationRequest } from '@tzurot/common-types/dist/types/ai-types';
```

## Schema Composition

**Build complex schemas from simple ones**

```typescript
// Base schemas
const BaseMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().datetime(),
});

const AttachmentSchema = z.object({
  url: z.string().url(),
  type: z.enum(['image', 'voice', 'file']),
  contentType: z.string(),
  name: z.string(),
});

// Composed schemas
const UserMessageSchema = BaseMessageSchema.extend({
  role: z.literal('user'),
  userId: z.string(),
  username: z.string(),
  attachments: z.array(AttachmentSchema).optional(),
});

const AssistantMessageSchema = BaseMessageSchema.extend({
  role: z.literal('assistant'),
  model: z.string(),
  usage: z.object({
    tokens: z.number(),
  }).optional(),
});

// Union type
const ConversationMessageSchema = z.union([
  UserMessageSchema,
  AssistantMessageSchema,
]);

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
```

## Error Handling with Zod

```typescript
import { z } from 'zod';

function processJobData(data: unknown): void {
  try {
    const validated = LLMGenerationJobDataSchema.parse(data);

    // Type-safe processing
    console.log(`Processing request: ${validated.requestId}`);

  } catch (error) {
    if (error instanceof z.ZodError) {
      // Detailed validation errors
      console.error('Validation failed:');
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });

      // Example error:
      // conversationHistory.0.role: Invalid enum value. Expected 'user' | 'assistant' | 'system', received 'bot'
    }
    throw error;
  }
}
```

## Type Safety Patterns

### Discriminated Unions

```typescript
// Job types with discriminator
type JobResult =
  | { status: 'success'; data: string }
  | { status: 'error'; error: Error };

function handleJobResult(result: JobResult): void {
  // TypeScript narrows type based on status
  if (result.status === 'success') {
    console.log(result.data); // ✅ data is available
  } else {
    console.error(result.error); // ✅ error is available
  }
}
```

### Branded Types

```typescript
// Prevent mixing similar string types
type PersonalityId = string & { __brand: 'PersonalityId' };
type UserId = string & { __brand: 'UserId' };

function getPersonality(id: PersonalityId): Promise<Personality> {
  // ...
}

const userId: UserId = 'user-123' as UserId;
const personalityId: PersonalityId = 'personality-456' as PersonalityId;

// ❌ TypeScript error - can't mix branded types
getPersonality(userId); // Error: UserId is not PersonalityId
```

### Const Assertions

```typescript
// Infer literal types
const ROLES = ['user', 'assistant', 'system'] as const;
type Role = typeof ROLES[number]; // 'user' | 'assistant' | 'system'

// Readonly object
const CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
} as const;
// CONFIG.MAX_RETRIES = 5; // ❌ Error: readonly
```

## Testing Types

### Type-Only Tests

```typescript
// Type assertions for compile-time checks
import { expectType, expectError } from 'tsd';

expectType<PersonalityConfig>({
  name: 'Test',
  systemPrompt: 'Test prompt',
  model: 'test-model',
});

expectError<PersonalityConfig>({
  name: 'Test',
  // Missing required systemPrompt
});
```

### Runtime Validation Tests

```typescript
describe('AIGenerationRequestSchema', () => {
  it('should validate correct request', () => {
    const validRequest = {
      personalityName: 'Lilith',
      message: 'Hello',
      channelId: '123',
      userId: '456',
      username: 'user',
    };

    const result = AIGenerationRequestSchema.parse(validRequest);
    expect(result).toEqual(validRequest);
  });

  it('should reject invalid request', () => {
    const invalidRequest = {
      // Missing required fields
      personalityName: 'Lilith',
    };

    expect(() => AIGenerationRequestSchema.parse(invalidRequest)).toThrow(z.ZodError);
  });
});
```

## Anti-Patterns

### ❌ Don't Use `any`
```typescript
// ❌ BAD - Loses type safety
function processMessage(message: any): void {
  console.log(message.content); // No type checking
}

// ✅ GOOD - Proper typing
function processMessage(message: Message): void {
  console.log(message.content); // Type-safe
}
```

### ❌ Don't Skip Runtime Validation at Boundaries
```typescript
// ❌ BAD - Trusts external data
app.post('/ai/generate', (req, res) => {
  const request = req.body as AIGenerationRequest; // Unsafe cast!
  // What if req.body doesn't match the type?
});

// ✅ GOOD - Validate at boundary
app.post('/ai/generate', (req, res) => {
  const request = AIGenerationRequestSchema.parse(req.body);
  // Safe - validated at runtime
});
```

### ❌ Don't Duplicate Type Definitions
```typescript
// ❌ BAD - Duplication across services
// bot-client/types.ts
interface PersonalityConfig { /* ... */ }

// ai-worker/types.ts
interface PersonalityConfig { /* ... */ } // Same type!

// ✅ GOOD - Define once in common-types
// packages/common-types/src/types/personality-types.ts
export interface PersonalityConfig { /* ... */ }
```

### ❌ Don't Use TypeScript Enums
```typescript
// ❌ BAD - TypeScript enum (generates runtime code)
enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

// ✅ GOOD - Zod enum or const assertion
const ROLES = ['user', 'assistant', 'system'] as const;
type MessageRole = typeof ROLES[number];
```

## References

- Type centralization: `CLAUDE.md#type-centralization`
- Zod documentation: https://zod.dev/
- Common-types package: `packages/common-types/`
- TypeScript handbook: https://www.typescriptlang.org/docs/handbook/
