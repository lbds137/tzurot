# DDD Test Migration Workflow

This document outlines the complete workflow for migrating DDD tests to the consolidated mock system.

## Migration Workflow Steps

### 1. Pre-Migration Setup

```bash
# Create a full backup of all DDD tests (one-time)
./scripts/backup-ddd-tests.sh
```

### 2. Select Test for Migration

```bash
# Use the guide tool to analyze the test
node scripts/guide-ddd-test-migration.js tests/unit/domain/personality/UserId.test.js
```

### 3. Create Individual Backup

```bash
# Backup the specific test file
cp tests/unit/domain/personality/UserId.test.js tests/unit/domain/personality/UserId.test.js.backup
```

### 4. Migrate the Test

Follow the template provided by the guide tool and:

- Add proper test headers (@jest-environment, @testType)
- Import consolidated mocks (dddPresets)
- Add comments clarifying what is/isn't mocked
- Update beforeEach/afterEach for consistency
- Keep all test logic unchanged

### 5. Validate the Migration

```bash
# Check syntax
node scripts/validate-test-syntax.js tests/unit/domain/personality/UserId.migrated.test.js

# Run the test
npx jest tests/unit/domain/personality/UserId.migrated.test.js --no-coverage

# Compare with original
diff -u tests/unit/domain/personality/UserId.test.js.backup tests/unit/domain/personality/UserId.migrated.test.js
```

### 6. Replace Original with Migrated Version

Once validated:

```bash
# Replace the original with the migrated version
mv tests/unit/domain/personality/UserId.migrated.test.js tests/unit/domain/personality/UserId.test.js

# Clean up the backup
rm tests/unit/domain/personality/UserId.test.js.backup
```

### 7. Update Documentation

- Update `/docs/testing/DDD_TEST_MIGRATION_STATUS.md` with the completed migration
- Commit with a descriptive message:

  ```
  test: migrate UserId test to consolidated mocks

  - Migrated value object test
  - All 25 tests passing
  - DDD test migration: 5/45 files complete
  ```

## Batch Migration Process

When migrating multiple tests:

1. **Group Similar Tests**
   - Migrate value objects together
   - Migrate repositories together
   - Migrate services together

2. **Use Batch Commands**

   ```bash
   # Validate multiple files
   node scripts/validate-test-syntax.js tests/unit/domain/personality/*.migrated.test.js

   # Run all migrated tests in a directory
   npx jest tests/unit/domain/personality/*.migrated.test.js --no-coverage
   ```

3. **Clean Up After Validation**
   ```bash
   # Use the cleanup script (to be created)
   node scripts/cleanup-migrated-tests.js tests/unit/domain/personality/
   ```

## Migration Checklist Template

For each test file:

- [ ] Analyzed with guide tool
- [ ] Created backup (.backup file)
- [ ] Created migrated version (.migrated.test.js)
- [ ] Validated syntax
- [ ] All tests passing
- [ ] Compared with original
- [ ] Replaced original file
- [ ] Cleaned up backup
- [ ] Updated status documentation
- [ ] Committed changes

## Common Issues and Solutions

### Jest Mock Hoisting

**Problem**: "The module factory of jest.mock() is not allowed to reference any out-of-scope variables"
**Solution**: Define mocks inline without external references

### Trailing Commas

**Problem**: Syntax validator reports trailing comma errors
**Solution**: Remove trailing commas from objects and arrays

### Timer Issues

**Problem**: Tests timeout or fail with timer-related errors
**Solution**: Ensure jest.useFakeTimers() in beforeEach and jest.useRealTimers() in afterEach

### Missing Dependencies

**Problem**: Test fails with "Cannot find module"
**Solution**: Check that all required modules are properly imported

## Quality Standards

Every migrated test must:

1. ✅ Pass all existing tests without modification
2. ✅ Follow consistent patterns for its test type
3. ✅ Have clear documentation headers
4. ✅ Use consolidated mocks appropriately
5. ✅ Never mock the code under test
6. ✅ Pass syntax validation
7. ✅ Run in under 5 seconds

## Progress Tracking

- Current Status: See `/docs/testing/DDD_TEST_MIGRATION_STATUS.md`
- Target: 45 DDD test files
- Goal: 100% migration to consolidated mocks
- Timeline: Complete within current sprint

## Migration Summary

As of the latest update:

- ✅ **5/45 files migrated** (11.1%)
- ✅ **154 tests** successfully migrated and passing
- ✅ **All 5 files** cleaned up and merged
- ✅ **0 files** awaiting cleanup

### Completed Migrations

1. PersonalityId (35 tests) - MERGED ✅
2. Alias (28 tests) - MERGED ✅
3. Token (31 tests) - MERGED ✅
4. UserId (21 tests) - MERGED ✅
5. FilePersonalityRepository (39 tests) - MERGED ✅

### Tools Created

1. **backup-ddd-tests.sh** - Safe backup creation
2. **guide-ddd-test-migration.js** - Migration analysis and templates
3. **validate-test-syntax.js** - Syntax validation
4. **cleanup-migrated-tests.js** - Automated cleanup after validation
