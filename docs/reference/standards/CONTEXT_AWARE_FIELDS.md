# Context-Aware Field Pattern

**Status**: Standard
**Applies to**: Dashboard field visibility and behavior based on user context

## Overview

The context-aware pattern allows dashboard field properties to be either static values or functions that dynamically resolve based on user context (e.g., admin status, user ID). This enables role-based field visibility without duplicating dashboard configurations.

## Core Types

```typescript
/**
 * Context passed to dashboard rendering functions
 */
interface DashboardContext {
  /** Whether the current user is a bot admin */
  isAdmin: boolean;
  /** Discord user ID */
  userId: string;
}

/**
 * Type for properties that can be static or context-dependent
 * - Static: `true`, `false`, `"value"`
 * - Dynamic: `(ctx) => ctx.isAdmin`
 */
type ContextAware<T> = T | ((context: DashboardContext) => T);
```

## Resolution Function

```typescript
/**
 * Resolve a context-aware value to its concrete form
 */
function resolveContextAware<T>(
  value: ContextAware<T> | undefined,
  context: DashboardContext,
  defaultValue: T
): T {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'function') {
    return (value as (ctx: DashboardContext) => T)(context);
  }
  return value;
}
```

## Common Use Cases

### 1. Admin-Only Field Visibility

Hide fields from non-admin users:

```typescript
const adminSection: SectionDefinition<CharacterData> = {
  id: 'admin',
  label: '⚙️ Admin Settings',
  fields: [
    {
      id: 'slug',
      label: 'Slug (URL Identifier)',
      // Field is hidden when user is NOT an admin
      hidden: (ctx: DashboardContext) => !ctx.isAdmin,
    },
  ],
};
```

### 2. Conditional Section Inclusion

Include entire sections conditionally:

```typescript
function getCharacterDashboardConfig(isAdmin: boolean): DashboardConfig<CharacterData> {
  const sections = [identitySection, biographySection];

  if (isAdmin) {
    sections.push(adminSection);
  }

  return { ...baseDashboardConfig, sections };
}
```

### 3. Dynamic Placeholders (Future)

```typescript
{
  id: 'notes',
  placeholder: (ctx) => ctx.isAdmin
    ? 'Admin notes (visible to all admins)'
    : 'Your personal notes',
}
```

## Security Model (Defense-in-Depth)

Context-aware fields implement a **3-layer security model**:

| Layer       | Location          | Purpose                                         |
| ----------- | ----------------- | ----------------------------------------------- |
| **Section** | Config factory    | Entire section included/excluded based on role  |
| **Field**   | `hidden` property | Field filtered from modal when building UI      |
| **Handler** | Server-side check | Re-verify permission before any write operation |

### Critical Security Rule

**NEVER trust context data for authorization.** The context is for UI rendering only.

```typescript
// ❌ WRONG: Trusting session data
if (session.data._isAdmin) {
  // Allow sensitive operation
}

// ✅ CORRECT: Always re-verify server-side
if (isBotOwner(interaction.user.id)) {
  // Allow sensitive operation
}
```

## Implementation Checklist

When adding new context-aware fields:

1. **Define the context property** in `DashboardContext` if needed
2. **Add `hidden` property** to field definition with context function
3. **Update modal builder** to filter fields using `resolveContextAware()`
4. **Add section-level check** in config factory if entire section is role-gated
5. **Add handler-level check** that re-verifies permission server-side
6. **Write tests** for both admin and non-admin scenarios
7. **Document the field** with security considerations

## Field Definition Interface

```typescript
interface FieldDefinition {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  style: 'short' | 'paragraph';
  minLength?: number;
  maxLength?: number;
  /** Hide this field from the modal (context-aware) */
  hidden?: ContextAware<boolean>;
}
```

## Session Data Convention

When storing context metadata in sessions, use underscore prefix to indicate non-persisted data:

```typescript
interface CharacterSessionData extends CharacterData {
  /**
   * Session-only metadata (underscore prefix = not persisted to DB).
   * Stored for audit/debugging - NEVER trusted for authorization.
   */
  _isAdmin?: boolean;
}
```

## Current Implementations

| Entity    | Field  | Context Property | Security Gate             |
| --------- | ------ | ---------------- | ------------------------- |
| Character | `slug` | `isAdmin`        | `isBotOwner()` in handler |

## Future Extensions

This pattern can be extended for:

- **Premium features**: `ctx.isPremium` for subscriber-only fields
- **Organization admins**: `ctx.isOrgAdmin` for team management
- **Moderators**: `ctx.isModerator` for content moderation fields
- **Feature flags**: `ctx.features.has('beta-feature')` for gradual rollouts

## Related Files

- `services/bot-client/src/utils/dashboard/types.ts` - Core type definitions
- `services/bot-client/src/utils/dashboard/ModalFactory.ts` - Field filtering logic
- `services/bot-client/src/commands/character/config.ts` - Character dashboard config
- `services/bot-client/src/commands/character/dashboard.ts` - Handler security checks
- `services/bot-client/src/commands/character/edit.ts` - Session data type

## See Also

- [TRI_STATE_PATTERN.md](./TRI_STATE_PATTERN.md) - For cascading boolean settings
- [HANDLER_FACTORY_PATTERN.md](./HANDLER_FACTORY_PATTERN.md) - For route handler structure
