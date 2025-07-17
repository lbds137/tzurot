# Global Blacklist Refactoring Plan

## Status: ✅ IMPLEMENTED

### Implementation Date: 2025-01-17
- Created on feature branch: `feature/global-blacklist-refactor`
- All core functionality implemented and tested

## Current State (BEFORE)
- Blacklist is currently part of the Authentication domain (UserAuth)
- Only prevents: token refresh, personality access
- Requires user to be authenticated first to be blacklisted
- Does NOT prevent command usage or re-authentication attempts

## Goal (ACHIEVED)
Create a proper global blacklist system that:
- ✅ Blocks ALL bot interactions for blacklisted users
- ✅ Works independently of authentication status
- ✅ Checks at the message handler level (before any command processing)

## Implementation Details

### 1. ✅ Created New Blacklist Domain (`src/domain/blacklist/`)

**Implemented Files:**
- `BlacklistedUser.js` - Value object with validation
- `BlacklistRepository.js` - Repository interface
- `BlacklistEvents.js` - Domain events (UserBlacklistedGlobally, UserUnblacklistedGlobally)
- `index.js` - Domain exports

### 2. ✅ Created Blacklist Application Service

**Implemented:** `src/application/services/BlacklistService.js`
- Complete CRUD operations for blacklist
- Event publishing for domain events
- Error handling and logging

### 3. ✅ Added Persistence

**Implemented:** `src/adapters/persistence/FileBlacklistRepository.js`
- File-based storage in `data/blacklist.json`
- Automatic migration from auth system on first run
- Atomic write operations (temp file + rename)

### 4. ✅ Added Global Check in Message Handler

**Implemented in:** `src/handlers/messageHandler.js`
- Check happens at the very beginning of message processing
- Handles PluralKit proxy system user mapping
- Silent fail - no response to blacklisted users

### 5. ✅ Updated BlacklistCommand

**Changes made:**
- Removed all auth service dependencies
- Now uses global BlacklistService
- Updated all help text to reflect global nature
- Maintains same command interface for users

### 6. ✅ Migration & Event Handlers

**Implemented:**
- `src/migrations/migrateBlacklistData.js` - Automatic migration script
- `src/application/eventHandlers/BlacklistEventHandlers.js` - Handles cleanup tasks
- Event handlers expire auth tokens and clear conversations when user blacklisted
- ApplicationBootstrap updated to initialize blacklist system

## Testing Implementation

### ✅ Created Comprehensive Test Suite

**Test Files Created:**
1. `tests/unit/domain/blacklist/BlacklistedUser.test.js` - Domain model tests
2. `tests/unit/application/services/BlacklistService.test.js` - Service layer tests  
3. `tests/unit/adapters/persistence/FileBlacklistRepository.test.js` - Persistence tests
4. `tests/unit/application/eventHandlers/BlacklistEventHandlers.test.js` - Event handler tests

**Test Coverage:**
- Domain validation and value object behavior
- Service operations (add, remove, check, list)
- Persistence operations and migration
- Event handling and side effects
- Error scenarios and edge cases

## Architecture Notes

### ✅ No Circular Dependencies
Analysis confirmed no circular dependencies exist in the implementation:
- ApplicationBootstrap → BlacklistService → Domain
- ApplicationBootstrap → FileBlacklistRepository → Domain
- No reverse dependencies

### ⚠️ Dependency Injection Pattern
While no circular dependencies exist, the following files use the anti-pattern of importing ApplicationBootstrap to get services:
- `BlacklistCommand.js` - Gets blacklistService via bootstrap
- `messageHandler.js` - Gets blacklistService via bootstrap

**Future Improvement:** These should receive services through dependency injection rather than importing ApplicationBootstrap.

## Migration Notes

### Data Migration
The FileBlacklistRepository automatically migrates blacklist data from `auth.json` to `blacklist.json` on first initialization. Original auth file is backed up before cleaning.

### Remaining Cleanup
The blacklist fields in UserAuth domain (`blacklisted`, `blacklistReason`) have been removed since they never made it to production.

### Test Cleanup Required
The following test files still have tests for the deprecated blacklist functionality in UserAuth:
- `tests/unit/application/services/AuthenticationApplicationService.test.js` - Tests for blacklistUser, unblacklistUser, getBlacklistedUsers methods
- `tests/unit/adapters/persistence/FileAuthenticationRepository.test.js` - Tests for findBlacklisted

These tests should be removed or updated when cleaning up the deprecated methods in AuthenticationApplicationService.