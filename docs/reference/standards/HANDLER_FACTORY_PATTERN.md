# Handler Factory Pattern

**Status**: Standard
**Applies to**: Express route handlers in api-gateway

## Overview

The handler factory pattern separates route handler logic into discrete, testable functions. Each HTTP endpoint gets its own handler factory function that receives dependencies and returns an async request handler.

## Why This Pattern?

1. **Testability**: Dependencies (Prisma, cache services) are explicitly injected
2. **Complexity Management**: Keeps functions under ESLint's 100-line limit
3. **Single Responsibility**: Each helper function does one thing
4. **Readability**: Clear sections for helpers, handlers, and route setup

## File Structure

```typescript
/**
 * Route documentation header
 * Describes all endpoints in the file
 */

import { ... } from 'express';
import { ... } from '@tzurot/common-types';
// ... other imports

const logger = createLogger('route-name');

// --- Constants & Types ---
// Select objects, interfaces, type aliases

const ENTITY_SELECT = {
  id: true,
  name: true,
  // ... fields
} as const;

interface ResponseType {
  // ... response shape
}

// --- Helper Functions ---
// Pure functions for data transformation, validation, etc.

function formatResponse(entity: EntityFromDb): ResponseType {
  return { ... };
}

async function validateAccess(
  prisma: PrismaClient,
  userId: string
): Promise<boolean> {
  // ... validation logic
}

// --- Handler Factories ---
// Each returns an async (req, res) => void function

function createGetHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    // Handler logic here
  };
}

function createUpdateHandler(
  prisma: PrismaClient,
  cacheService?: CacheInvalidationService
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    // Handler logic here
  };
}

// --- Route Factory ---
// Exported function that wires everything together

export function createEntityRoutes(
  prisma: PrismaClient,
  cacheService?: CacheInvalidationService
): Router {
  const router = Router();

  router.get('/', requireAuth(), asyncHandler(createGetHandler(prisma)));
  router.put('/:id', requireAuth(), asyncHandler(createUpdateHandler(prisma, cacheService)));

  return router;
}
```

## Helper Function Guidelines

### Data Formatting

```typescript
// Transform database entity to API response
function formatPersonalityResponse(personality: PersonalityFromDb): PersonalityResponse {
  return {
    id: personality.id,
    name: personality.name,
    hasAvatar: personality.avatarData !== null, // Transform binary to boolean
    createdAt: personality.createdAt.toISOString(), // Dates to ISO strings
  };
}
```

### Validation & Authorization

```typescript
// Check if user can perform action
async function canUserEditPersonality(
  prisma: PrismaClient,
  userId: string,
  personalityId: string,
  discordUserId: string
): Promise<boolean> {
  if (isBotOwner(discordUserId)) return true;
  // ... additional checks
}
```

### Processing Helpers

```typescript
// Handle complex processing with proper error returns
async function processAvatarIfProvided(
  avatarData: string | undefined
): Promise<{ buffer: Buffer } | { error: ErrorResponse } | null> {
  if (avatarData === undefined) return null;

  try {
    const result = await optimizeAvatar(avatarData);
    return { buffer: result.buffer };
  } catch (error) {
    return { error: ErrorResponses.processingError('Failed to process avatar') };
  }
}
```

### Build Update Data

```typescript
// Construct update object from request body
function buildUpdateData(body: UpdateEntityBody, existingName: string): Prisma.EntityUpdateInput {
  const updateData: Prisma.EntityUpdateInput = {};

  const simpleFields = ['name', 'description'] as const;
  for (const field of simpleFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  return updateData;
}
```

## Handler Factory Guidelines

### Keep Handlers Focused on Orchestration

```typescript
function createUpdateHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    // 1. Extract and validate params
    const slug = getParam(req.params.slug);
    if (slug === undefined) {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    // 2. Authorize
    const canEdit = await canUserEditPersonality(prisma, userId, personalityId);
    if (!canEdit) {
      return sendError(res, ErrorResponses.unauthorized('...'));
    }

    // 3. Process (using helper)
    const result = await processData(body);
    if ('error' in result) {
      return sendError(res, result.error);
    }

    // 4. Execute
    const updated = await prisma.entity.update({ ... });

    // 5. Respond
    sendCustomSuccess(res, { entity: formatResponse(updated) });
  };
}
```

### Dependency Injection

Pass all dependencies explicitly:

```typescript
// Good - explicit dependencies
function createHandler(
  prisma: PrismaClient,
  cacheService?: CacheInvalidationService
) { ... }

// Bad - importing singletons inside handler
function createHandler() {
  const prisma = getPrismaClient();  // Hidden dependency
}
```

## Response Type Interfaces

Define explicit interfaces for API responses:

```typescript
interface PersonalityResponse {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  // ... all response fields
  hasAvatar: boolean; // Transformed from avatarData
  createdAt: string; // ISO string, not Date
  updatedAt: string;
}
```

This provides:

- Type safety in formatters
- API contract documentation
- Compiler errors if response shape changes

## Anti-Patterns

### Don't: Giant monolithic handlers

```typescript
// Bad - everything in one function
router.put('/:id', async (req, res) => {
  // 200 lines of validation, processing, database calls...
});
```

### Don't: Implicit dependencies

```typescript
// Bad - relies on global state
function createHandler() {
  const config = getGlobalConfig(); // Where does this come from?
}
```

### Don't: Mix concerns in helpers

```typescript
// Bad - helper does too much
async function processAndSaveEntity(prisma, body, userId) {
  // Validates, processes, saves, caches - too many responsibilities
}
```

## ESLint Limits This Pattern Satisfies

| Rule                     | Limit | How Pattern Helps                 |
| ------------------------ | ----- | --------------------------------- |
| `max-lines-per-function` | 100   | Handlers delegate to helpers      |
| `complexity`             | 15    | Branching spread across functions |
| `max-statements`         | 30    | Logic split into focused helpers  |
| `max-params`             | 5     | Use options objects if needed     |

## Examples in Codebase

- `services/api-gateway/src/routes/user/personality/get.ts`
- `services/api-gateway/src/routes/user/personality/update.ts`
- `services/api-gateway/src/routes/admin/llm-config.ts`
- `services/api-gateway/src/routes/user/persona/crud.ts`
