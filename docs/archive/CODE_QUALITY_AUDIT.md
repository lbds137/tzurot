# Code Quality Audit Report - Tzurot v3

**Date**: 2025-10-25
**Branch**: `chore/code-quality-audit`
**Total Codebase**: 5,888 lines across 20 TypeScript source files

## Executive Summary

The Tzurot v3 codebase is well-structured with clean architecture and TypeScript throughout. However, there are several areas for improvement around constants management, code duplication, architectural concerns, and testability.

---

## 1. MAGIC NUMBERS & HARDCODED CONSTANTS

### Severity: Medium

#### 1.1 Timeout Values (Inconsistent)

**Files Affected**:
- `services/ai-worker/src/services/MultimodalProcessor.ts` (lines 200, 291)
  - Hardcoded `30000ms` timeout for vision model invocation (appears 2 times)

- `services/api-gateway/src/routes/ai.ts` (line 205)
  - Hardcoded `270000ms` timeout for job waiting
  - Hardcoded `120000ms` base timeout calculation

**Issue**: These timeout values are scattered and duplicated.

**Recommendation**: Add to `packages/common-types/src/constants.ts`:
```typescript
export const TIMEOUTS = {
  VISION_MODEL: 30000,          // 30 seconds
  JOB_WAIT: 270000,              // 4.5 minutes
  JOB_BASE: 120000,              // 2 minutes
} as const;
```

#### 1.2 Cache & Cleanup Intervals

**Files Affected**:
- `services/bot-client/src/webhooks/manager.ts` (lines 28, 193)
  - `10 * 60 * 1000` (10 minutes) cache timeout
  - `60000` (1 minute) cleanup interval

- `services/api-gateway/src/utils/requestDeduplication.ts` (lines 20, 23)
  - `5000` (5 seconds) duplicate detection window
  - `10000` (10 seconds) cleanup interval

- `services/api-gateway/src/queue.ts` (lines 65, 77)
  - `5000` (5 seconds) cleanup delay (appears 2 times)

- `services/bot-client/src/handlers/messageHandler.ts` (line 196)
  - `8000` (8 seconds) typing indicator refresh interval

**Recommendation**: Add to constants:
```typescript
export const INTERVALS = {
  WEBHOOK_CACHE_TTL: 10 * 60 * 1000,        // 10 minutes
  WEBHOOK_CLEANUP: 60000,                    // 1 minute
  REQUEST_DEDUP_WINDOW: 5000,                // 5 seconds
  REQUEST_DEDUP_CLEANUP: 10000,              // 10 seconds
  ATTACHMENT_CLEANUP_DELAY: 5000,            // 5 seconds
  TYPING_INDICATOR_REFRESH: 8000,            // 8 seconds
} as const;
```

#### 1.3 Job Queue Configuration

**Files**:
- `services/api-gateway/src/queue.ts` (lines 44-45)
- `services/ai-worker/src/index.ts` (mirrors same values)
  - `100` - completed job history limit
  - `500` - failed job history limit

**Recommendation**:
```typescript
export const QUEUE_CONFIG = {
  COMPLETED_HISTORY_LIMIT: 100,
  FAILED_HISTORY_LIMIT: 500,
} as const;
```

#### 1.4 Buffer Times & Timestamps

**File**: `services/ai-worker/src/services/MultimodalProcessor.ts` (line 401)
- `5 * 60 * 1000` (5 minutes) buffer for Discord URL expiration checking

**Recommendation**:
```typescript
export const BUFFERS = {
  DISCORD_URL_EXPIRATION: 5 * 60 * 1000,  // 5 minutes
  STM_LTM_BUFFER_MS: 10000,               // Already exists
} as const;
```

#### 1.5 Text Truncation Limits

**Files Affected**:
- `services/ai-worker/src/services/ConversationalRAGService.ts` (lines 135, 163, 361)
  - `100` - persona truncation in logging
  - `150` - message content preview in logging
  - `2000` - max preview length for full prompt

- `services/bot-client/src/commands/admin.ts` (lines 155-156)
  - `1000` - summary truncation
  - `1024` - warnings field truncation (Discord embed limit)

**Recommendation**:
```typescript
export const TEXT_LIMITS = {
  LOG_PREVIEW: 150,                      // Characters for log previews
  LOG_PERSONA_PREVIEW: 100,              // Characters for persona preview
  LOG_FULL_PROMPT: 2000,                 // Character limit before truncating
  ADMIN_SUMMARY_TRUNCATE: 1000,
  DISCORD_EMBED_FIELD: 1024,
} as const;
```

---

## 2. FILE SIZE ANALYSIS

### Severity: Medium

### Files Exceeding 500+ Lines (Critical)

#### 2.1 ConversationalRAGService.ts - 757 lines
**Location**: `services/ai-worker/src/services/ConversationalRAGService.ts`

**Responsibilities**:
- Memory retrieval
- Prompt building
- Interaction storage
- System prompt building
- Persona fetching

**Refactoring Recommendation**: Extract into separate classes:
- `PromptBuilder` - buildSystemPrompt, buildFullSystemPrompt
- `InteractionStorage` - storeInteraction
- `UserPersonaManager` - getUserPersona, getUserPersonaForPersonality
- Keep `ConversationalRAGService` focused on orchestration

**Priority**: Medium (defer until development slows down)

#### 2.2 MultimodalProcessor.ts - 621 lines
**Location**: `services/ai-worker/src/services/MultimodalProcessor.ts`

**Responsibilities**:
- Image description
- Audio transcription
- URL expiration checking
- Image resizing

**Refactoring Recommendation**: Extract into:
- `VisionService` - describeImage, describeWithVisionModel, describeWithFallbackVision
- `AudioTranscriptionService` - transcribeAudio
- `ImageProcessor` - fetchAsBase64, resizeImage
- Keep wrapper function for retry logic

**Priority**: Medium (defer until development slows down)

### Files Between 300-500 Lines (Monitor)

- `messageHandler.ts` - 383 lines
- `admin.ts` - 346 lines
- `ai.ts` - 342 lines
- `index.ts` (api-gateway) - 340 lines

---

## 3. DUPLICATE CODE PATTERNS

### Severity: Low-Medium

### 3.1 Image URL Resolution (Duplicate Logic)

**Files**: `services/ai-worker/src/services/MultimodalProcessor.ts` (lines 169-182, 264-273)

**Duplicate Pattern**:
```typescript
if (isDiscordUrlExpired(attachment.url)) {
  logger.info({ url: attachment.url }, 'Discord URL expired...');
  const base64Image = await fetchAsBase64(attachment.url);
  imageUrl = `data:${attachment.contentType};base64,${base64Image}`;
} else {
  logger.info({ url: attachment.url }, 'Using direct URL...');
  imageUrl = attachment.url;
}
```

**Recommendation**: Extract helper:
```typescript
async function resolveImageUrl(
  attachment: AttachmentMetadata,
  logger: Logger
): Promise<string> {
  if (isDiscordUrlExpired(attachment.url)) {
    logger.info({ url: attachment.url }, 'Discord URL expired, using base64');
    const base64 = await fetchAsBase64(attachment.url);
    return `data:${attachment.contentType};base64,${base64}`;
  }
  logger.info({ url: attachment.url }, 'Using direct URL');
  return attachment.url;
}
```

### 3.2 Error Detail Extraction (Duplicate Logic)

**Files**: `services/ai-worker/src/services/MultimodalProcessor.ts` (lines 206-223, 297-315)

**Duplicate Pattern**:
```typescript
const errorDetails: ErrorDetails = {
  errorType: error?.constructor?.name,
  errorMessage: error instanceof Error ? error.message : 'Unknown error',
};

if (error && typeof error === 'object') {
  if ('response' in error) errorDetails.apiResponse = error.response;
  if ('status' in error) errorDetails.statusCode = error.status;
  if ('statusText' in error) errorDetails.statusText = error.statusText;
}
```

**Recommendation**: Extract utility:
```typescript
function extractErrorDetails(error: unknown, modelName?: string): ErrorDetails {
  const details: ErrorDetails = {
    modelName,
    errorType: error?.constructor?.name,
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
  };

  if (error && typeof error === 'object') {
    if ('response' in error) details.apiResponse = error.response;
    if ('status' in error) details.statusCode = error.status;
    if ('statusText' in error) details.statusText = error.statusText;
  }

  return details;
}
```

### 3.3 Attachment Cleanup Scheduling (Duplicate Logic)

**Files**: `services/api-gateway/src/queue.ts` (lines 61-66, 73-78)

**Duplicate Pattern**:
```typescript
if (jobId.startsWith('req-')) {
  const requestId = jobId.substring(4);
  setTimeout(() => {
    void cleanupAttachments(requestId);
  }, 5000);
}
```

**Recommendation**: Extract helper:
```typescript
function scheduleAttachmentCleanup(jobId: string): void {
  if (jobId.startsWith('req-')) {
    const requestId = jobId.substring(4);
    setTimeout(() => void cleanupAttachments(requestId), INTERVALS.ATTACHMENT_CLEANUP_DELAY);
  }
}
```

### 3.4 Error Handling Pattern (43 instances)

**Issue**: Similar try-catch error handling patterns repeated throughout codebase.

**Count**: 43 total `logger.error({ err: error }, ...)` calls across 16 files

**Recommendation**: Create error handler utility (lower priority - these are fine as-is for now)

---

## 4. STRING LITERAL CONSTANTS

### Severity: Low

### 4.1 Message Role Strings

**Usage**: 'user', 'assistant', 'system' appear across multiple files

**Recommendation**: Create enum:
```typescript
export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}
```

### 4.2 Job Status Strings

**Usage**: 'queued', 'completed', 'failed' used in multiple places

**Recommendation**:
```typescript
export enum JobStatus {
  Queued = 'queued',
  Completed = 'completed',
  Failed = 'failed',
}
```

### 4.3 Attachment Type Strings

**Usage**: 'image', 'audio' attachment types

**Recommendation**:
```typescript
export enum AttachmentType {
  Image = 'image',
  Audio = 'audio',
}
```

---

## 5. FILE NAMING CONSISTENCY

### Severity: Low

### Issue

TypeScript file naming is inconsistent across the codebase. The standard convention is:
- **PascalCase** for files exporting a single class/component
- **camelCase** for utilities, helpers, or files with multiple exports
- **kebab-case** for scripts and configuration files

### Files Needing Rename

**bot-client service:**
- `src/webhooks/manager.ts` → `WebhookManager.ts` (exports WebhookManager class)
- `src/handlers/messageHandler.ts` → `MessageHandler.ts` (exports MessageHandler class)
- `src/handlers/commandHandler.ts` → `CommandHandler.ts` (exports CommandHandler class)
- `src/memory/ConversationManager.ts` → ✅ Already correct
- `src/gateway/client.ts` → `GatewayClient.ts` (exports GatewayClient class)

**api-gateway service:**
- `src/services/DatabaseSyncService.ts` → ✅ Already correct
- `src/utils/tempAttachmentStorage.ts` → Keep as-is (utility functions, not a class)
- `src/utils/requestDeduplication.ts` → Keep as-is (utility functions, not a class)

**ai-worker service:**
- All service files already follow PascalCase ✅

### Recommendation

Rename files to match the exported class name. This improves discoverability and follows TypeScript/Node.js conventions.

**Priority**: Low (Phase 1 - quick win, ~10 minutes)

---

## 6. TESTABILITY ISSUES

### Severity: Medium

### 6.1 Tightly Coupled Dependencies

**File**: `services/bot-client/src/handlers/messageHandler.ts`
- **Line 12**: Imports 5 services directly
- **Line 35-37**: Instantiates all services in constructor
- **Issue**: Cannot easily mock services for testing

**Better Approach**: Inject services as parameters or use dependency injection framework

**Priority**: Low (defer until adding unit tests)

### 6.2 Direct Database Access

**File**: `services/ai-worker/src/services/ConversationalRAGService.ts`
- **Lines 454-560**: Direct Prisma calls for interaction storage
- **Lines 618-663**: Direct user persona fetches
- **Issue**: Hard to test without database

**Recommendation**: Create data access layer (defer until adding unit tests)

### 6.3 Global State / Module-Level Variables

**File**: `services/api-gateway/src/utils/requestDeduplication.ts`
- **Line 17**: `const requestCache = new Map<string, CachedRequest>();`
- **Line 26**: `let cleanupTimer: NodeJS.Timeout | undefined;`
- **Issue**: Global state makes tests interfere with each other

**Recommendation**: Convert to injectable service class (defer until adding unit tests)

---

## 7. TODO ITEMS

### Found TODOs

1. `services/api-gateway/src/routes/ai.ts` (line 177)
   - `// TODO: Add callback URL support`

2. `services/ai-worker/src/jobs/AIJobProcessor.ts`
   - `// TODO: Add actual health check`

**Recommendation**: Track these in CURRENT_WORK.md or GitHub issues

---

## REFACTORING PHASES

### Phase 1: Quick Wins - ✅ **COMPLETED**

All Phase 1 items have been implemented on branch `chore/code-quality-audit`.

Completed work:

1. ✅ **Create centralized TIMEOUTS constants**
   - Extract `30000`, `270000`, `120000` from MultimodalProcessor and ai.ts

2. ✅ **Create INTERVALS constants**
   - Extract cache TTLs, cleanup intervals, typing indicator refresh

3. ✅ **Create QUEUE_CONFIG constants**
   - Extract history limits from queue initialization

4. ✅ **Create BUFFERS constants**
   - Extract Discord URL expiration buffer

5. ✅ **Create TEXT_LIMITS constants**
   - Extract log preview lengths and truncation limits

6. ✅ **Create enums for common strings**
   - MessageRole, JobStatus, AttachmentType

7. ✅ **Replace all magic numbers with named constants**
   - Update all files to use the new constants

8. ✅ **Rename files for consistency**
   - Rename `manager.ts` → `WebhookManager.ts`
   - Rename `messageHandler.ts` → `MessageHandler.ts`
   - Rename `commandHandler.ts` → `CommandHandler.ts`
   - Rename `client.ts` → `GatewayClient.ts`
   - Update all imports

9. ✅ **Move image resizing to api-gateway**
   - Extract resizing logic from MultimodalProcessor
   - Add sharp dependency to api-gateway
   - Resize images during download from Discord CDN
   - Remove dead code (isDiscordUrlExpired, fetchAsBase64)
   - Remove unused BUFFERS.DISCORD_URL_EXPIRATION constant

### Phase 2: Medium Effort (4-6 hours) - **DEFER FOR NOW**

1. Extract image URL resolution helper (MultimodalProcessor)
2. Extract error detail extraction utility
3. Extract attachment cleanup scheduling helper
4. Reduce error handling duplication (optional)

### Phase 3: Larger Refactor (8-10 hours) - **DEFER UNTIL TESTING PHASE**

1. Refactor ConversationalRAGService (757 lines → 3 classes)
2. Refactor MultimodalProcessor (621 lines → service classes)
3. Implement dependency injection for testability
4. Create data repository abstraction layer
5. Convert module-level cache to injectable service
6. Split api-gateway/index.ts into separate modules

### Phase 4: Long-term - **FUTURE WORK**

1. Add comprehensive unit test suite
2. Create integration tests for service boundaries
3. Implement end-to-end tests for critical paths

---

## SUMMARY TABLE

| Category | Count | Severity | Effort | Phase |
|----------|-------|----------|--------|-------|
| Magic Numbers | 15+ instances | Medium | Medium | 1 |
| Large Files | 2 critical, 4 monitor | Medium | High | 3 |
| Duplicate Code | 4 patterns | Low-Med | Low | 2 |
| Test Coupling | 6 locations | Medium | High | 3 |
| Config Strings | 20+ instances | Low | Low | 1 |
| File Naming | 4 files | Low | Low | 1 |
| Global State | 2 locations | Medium | Medium | 3 |
| TODO Items | 2 | Low | Low | - |

---

## CONCLUSION

The Tzurot v3 codebase demonstrates solid architectural decisions and clean code overall. The main areas for improvement are:

1. **Constants Management** - Magic numbers should be centralized (Phase 1)
2. **File Organization** - Two large files should be split into focused classes (Phase 3)
3. **Code Reuse** - Several patterns are duplicated and should be extracted (Phase 2)
4. **Testability** - Tightly coupled dependencies make unit testing difficult (Phase 3)

**Current Status**: Working on Phase 1 (Quick Wins) on branch `chore/code-quality-audit`

**Next Steps**:
1. Check for outdated npm dependencies
2. Implement Phase 1 constants consolidation
3. Replace magic numbers throughout codebase
4. Verify builds and commit changes
