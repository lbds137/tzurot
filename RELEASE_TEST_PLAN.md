# Release Test Plan: develop → main

**Date**: 2026-01-19
**Commits**: 29 commits, 133 files changed, +13,558 / -2,938 lines

---

## 🔴 Critical Features (Test First)

### 1. Incognito Mode (Phase 3 Memory)

**What**: Users can enable incognito mode to prevent conversations from being saved to memory.

**Test Steps**:

- [x] `/memory status` - Shows current incognito status
- [x] `/memory incognito enable` - Enables incognito mode
- [x] Send message to a character while incognito
- [x] Verify message is NOT saved to memory (`/memory list` should not show it)
- [x] `/memory incognito disable` - Disables incognito mode
- [x] Send another message
- [x] Verify this message IS saved to memory
- [x] `/memory incognito status` - Shows correct status

**Edge Cases**:

- [ ] Incognito persists across bot restarts (stored in Redis)
- [ ] Incognito applies to specific channel or globally (verify scope)

---

### 2. Preset Edit Dashboard

**What**: New dashboard UI for editing presets with advancedParameters support.

**Test Steps**:

- [x] `/preset list` - Lists available presets
- [x] `/preset edit <name>` - Opens dashboard for preset
- [x] Click on different sections (should open modals)
- [x] Edit a field and save
- [x] Verify changes persist (re-open dashboard)
- [ ] Test advancedParameters section (temperature, topP, etc.)
- [x] Close button works
- [x] Refresh button works

**Permission Tests**:

- [ ] Owner can edit their preset
- [ ] Non-owner cannot edit others' presets
- [ ] Bot admin can edit any preset (if applicable)

---

### 3. Admin-Only Slug Editing (Context-Aware Fields)

**What**: Bot admins can now edit character slugs via the dashboard.

**Test Steps (as Bot Admin)**:

- [x] `/character edit <name>` - Opens dashboard
- [x] Verify "⚙️ Admin Settings" section is visible
- [x] Click Admin Settings, see slug field
- [x] Edit slug to valid new value
- [x] Verify slug changed in API (character accessible via new slug)
- [ ] Test validation: invalid format (spaces, uppercase)
- [ ] Test validation: reserved slugs (admin, system, bot)
- [ ] Test validation: duplicate slug

**Test Steps (as Regular User)**:

- [x] `/character edit <name>` - Opens dashboard
- [x] Verify "⚙️ Admin Settings" section is NOT visible
- [x] Cannot access admin section via custom ID manipulation

---

### 4. Redis SessionManager Migration

**What**: Dashboard sessions now stored in Redis (persistent across restarts).

**Test Steps**:

- [ ] Open a dashboard (`/character edit`)
- [ ] Restart the bot (or wait for container redeploy)
- [ ] Dashboard should still be interactive (session persisted)
- [ ] Multiple users can have sessions simultaneously
- [ ] Sessions expire appropriately (default: 15 minutes idle)

---

## 🟡 Important Fixes (Test Second)

### 5. Gateway API Timeout for Autocomplete

**What**: Autocomplete now has proper timeout handling.

**Test Steps**:

- [x] `/character edit` and start typing character name
- [x] Autocomplete suggestions appear quickly
- [x] If gateway is slow, autocomplete gracefully handles timeout
- [x] No errors in logs for normal autocomplete usage

---

### 6. Permissions canEdit Authorization

**What**: Fixed authorization to use `permissions.canEdit` properly.

**Test Steps**:

- [x] User owns a character → can edit ✓
- [ ] User is co-owner of character → can edit ✓
- [x] User has no ownership → cannot edit ✓
- [x] Bot admin → can edit any character ✓

---

### 7. Command Loading (Index-or-Root Filter)

**What**: Fixed command handler registration to avoid duplicates.

**Test Steps**:

- [ ] All slash commands work: `/character`, `/preset`, `/persona`, `/wallet`, `/memory`
- [ ] No duplicate command registrations in logs
- [ ] Subcommands work correctly (e.g., `/character edit`, `/character create`)

---

### 8. Memory Detail Bugs

**What**: Fixed issues with memory detail display.

**Test Steps**:

- [x] `/memory list` - Shows memories correctly
- [x] `/memory view <id>` - Shows memory details
- [ ] Memory timestamps display correctly
- [ ] Memory content truncation works properly

---

## 🟢 Minor Changes (Spot Check)

### 9. Duration Formatting

**What**: Consolidated duration parsing and uses `Duration.toHuman()`.

**Test Steps**:

- [ ] Timeframes in `/memory list` show human-readable format
- [ ] Extended context age displays correctly
- [ ] No "undefined" or malformed duration strings

---

### 10. Standardized Permissions DTO

**What**: All entities (character, preset, persona) use consistent permissions format.

**Test Steps**:

- [ ] Verify API responses include `permissions.canEdit` field
- [ ] All entity types return consistent structure

---

## 🧪 Regression Tests

Run these to ensure nothing broke:

- [ ] `/character create` - Create new character
- [ ] `/character list` - List characters
- [ ] `@character message` - Chat with character
- [ ] `/wallet status` - Check API key status
- [ ] `/persona create` - Create persona
- [ ] `/persona list` - List personas
- [ ] `/channel status` - Check channel settings

---

## 📋 Pre-Release Checklist

- [ ] All critical features tested ✓
- [ ] No console errors during testing
- [ ] All automated tests passing (CI green)
- [ ] Database migrations applied (if any)
- [ ] No breaking API changes (or documented)

---

## 🚀 Release Notes Draft

### New Features

- **Incognito Mode**: Enable `/memory incognito` to prevent conversations from being saved
- **Preset Edit Dashboard**: Full dashboard UI for editing presets with advancedParameters
- **Admin Slug Editing**: Bot admins can now edit character slugs via dashboard

### Improvements

- Dashboard sessions now persist across bot restarts (Redis-backed)
- Improved autocomplete performance with timeout handling
- Standardized permissions across all entity types
- Better duration formatting throughout the UI

### Bug Fixes

- Fixed authorization checks for character editing
- Fixed command loading to prevent duplicate registrations
- Fixed memory detail display issues
- Fixed preset command handler exports

---

**Tester**: ******\_\_\_******
**Date Tested**: ******\_\_\_******
**Result**: [ ] PASS / [ ] FAIL
