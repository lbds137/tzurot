# TypeScript Migration Plan (Post-DDD)

## Overview

This document outlines the plan to migrate Tzurot to TypeScript AFTER the DDD migration is complete. By establishing clean domain boundaries first, we'll make the TypeScript conversion much smoother.

## Why TypeScript (Eventually)

### Type Safety Benefits for Our Domain Model

1. **Aggregate Invariants**: Compile-time enforcement of business rules
2. **Value Objects**: Branded types prevent primitive obsession
3. **Repository Contracts**: Explicit interfaces with proper return types
4. **Event Types**: Discriminated unions for domain events
5. **Error Handling**: Result types instead of exceptions

### DDD-Specific Benefits

```typescript
// Example: PersonalityId as branded type
type PersonalityId = string & { readonly brand: unique symbol };

// Example: Repository with explicit types
interface PersonalityRepository {
  findById(id: PersonalityId): Promise<Personality | null>;
  save(personality: Personality): Promise<void>;
}

// Example: Discriminated union for events
type PersonalityEvent =
  | { type: 'PersonalityCreated'; payload: CreatePayload }
  | { type: 'PersonalityRemoved'; payload: RemovePayload };
```

## Prerequisites (What We're Doing Now)

### 1. Clean Architecture

- ✅ Domain layer with no external dependencies
- ✅ Clear boundaries between contexts
- ✅ Repository interfaces
- ✅ Event-driven communication

### 2. JSDoc Everything

- ✅ Type annotations in comments
- ✅ Interface documentation
- ✅ Parameter and return types documented

### 3. Strict Patterns

- ✅ Constructor validation
- ✅ Immutable value objects
- ✅ Factory methods
- ✅ No any-typed operations

## Migration Timeline

### Phase 1: After DDD Phase 4 Complete (Week 12)

**Setup & Configuration**

- Initialize TypeScript configuration
- Set up build pipeline
- Configure strict mode from start
- Add necessary @types packages

### Phase 2: Domain Layer First (Week 13)

**Convert Core Domain**

```bash
src/domain/
├── shared/         # Convert first (base classes)
├── personality/    # Then aggregates
├── conversation/
├── authentication/
└── ai/
```

### Phase 3: Adapters & Infrastructure (Week 14)

**Convert Adapters**

- Persistence adapters
- Discord adapters
- AI service adapters

### Phase 4: Application Layer (Week 15)

**Convert Commands & Handlers**

- Command handlers
- Event handlers
- Application services

## Conversion Strategy

### 1. File-by-File Approach

```bash
# Rename .js to .ts one at a time
mv src/domain/personality/PersonalityId.js src/domain/personality/PersonalityId.ts

# Fix type errors
# Commit each file separately
```

### 2. Maintain Compatibility

```json
// tsconfig.json
{
  "compilerOptions": {
    "allowJs": true, // Mix JS and TS during migration
    "checkJs": false, // Don't check JS files
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true, // Start strict
    "esModuleInterop": true
  }
}
```

### 3. Type Definition Strategy

```typescript
// Start with interfaces in .d.ts files
// src/types/domain.d.ts
declare module '@domain/personality' {
  export interface PersonalityData {
    id: string;
    ownerId: string;
    profile: PersonalityProfile;
  }
}
```

## Expected Benefits Post-Migration

### 1. Compile-Time Safety

- Catch type errors before runtime
- Prevent invalid state transitions
- Enforce repository contracts

### 2. Better Refactoring

- IDE can safely rename across codebase
- Find all usages reliably
- Extract interfaces automatically

### 3. Self-Documenting Code

```typescript
// Before (JS with JSDoc)
/**
 * @param {string} id
 * @param {UserId} ownerId
 * @returns {Personality}
 */
static create(id, ownerId) { }

// After (TypeScript)
static create(id: PersonalityId, ownerId: UserId): Personality { }
```

### 4. Advanced Patterns

- Branded types for IDs
- Exhaustive switch with discriminated unions
- Generic repositories
- Conditional types for flexibility

## Why Not Now?

1. **Scope Creep**: DDD migration is already 11 weeks
2. **Focus**: One architectural change at a time
3. **Risk**: Combining migrations increases failure points
4. **Learning Curve**: Team can focus on DDD patterns first

## Success Metrics

- Zero use of `any` type
- 100% type coverage
- No `@ts-ignore` comments
- All tests passing with strict mode
- Build time < 30 seconds

## Preparation Checklist (During DDD)

- [ ] Write JSDoc for all new code
- [ ] Use factory methods over direct construction
- [ ] Keep functions pure where possible
- [ ] Avoid dynamic property access
- [ ] Use enums for fixed sets of values
- [ ] Design with interfaces in mind

## Risk Mitigation

1. **Gradual Migration**: One module at a time
2. **Maintain Tests**: All tests must pass after each file
3. **Type Definition Files**: Use .d.ts for gradual typing
4. **Escape Hatch**: `allowJs` lets us mix JS/TS

## Conclusion

By completing DDD first, we'll have:

- Clean boundaries perfect for TypeScript modules
- Well-defined interfaces ready for type contracts
- Pure domain logic easy to type
- No legacy code to work around

The TypeScript migration will be a natural evolution, not a revolution.

**Estimated effort**: 4 weeks (vs 8+ weeks if done during DDD)  
**Recommended start**: Week 12, after DDD Phase 4 complete
