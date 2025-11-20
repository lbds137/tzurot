# getAllReleases Bug Postmortem

## Incident Summary

Tests mocked a non-existent method `githubClient.getAllReleases()`, which passed all tests but failed in the development environment when actually executed.

## Timeline

- Tests written with `mockGithubClient.getAllReleases.mockResolvedValue(...)`
- All tests passed ✅
- Code deployed to development environment
- Development testing with GitHub webhook integration
- Runtime error: `this.githubClient.getAllReleases is not a function`
- Root cause: The method doesn't exist (should be `getReleasesBetween`)
- Caught before production deployment ✅

## Root Cause Analysis

### Why It Happened

1. **Ad-hoc mocking**: Test created inline mock without verifying methods exist
2. **Consolidated mocks unused**: Only ~5% of tests use the safe mock system
3. **No verification**: No automated checks for mock accuracy

### Code Example

```javascript
// ❌ What we had (test file)
mockGithubClient.getAllReleases.mockResolvedValue([...]); // Passed!

// ❌ What we had (implementation)
const releases = await this.githubClient.getAllReleases(); // Failed in dev!

// ✅ What actually exists
const releases = await this.githubClient.getReleasesBetween('0.0.0', version);
```

## Fixes Implemented

### 1. Mock Verification Script

Created `scripts/verify-mock-methods.js` to verify mocked methods exist in real implementations.

### 2. Pre-commit Hook Integration

```bash
# Now runs automatically on test files
run_check "Mock method verification" "node scripts/verify-mock-methods.js $STAGED_TEST_FILES"
```

### 3. Documentation Updates

- Updated [MOCK_SYSTEM_GUIDE.md](./MOCK_SYSTEM_GUIDE.md) with verification guidance
- Added enforcement details to mock documentation
- Updated testing guidelines with warnings and Boy Scout Rule

### 4. Boy Scout Rule

When touching any test file:

1. Fix your immediate task
2. Migrate at least one other test to consolidated mocks
3. Track progress in commit messages

## Lessons Learned

1. **Testing the tests matters**: Mocks can lie if not verified
2. **Good systems need enforcement**: Consolidated mocks existed but weren't used
3. **Gradual migration works**: Boy Scout Rule ensures progress without blocking features
4. **Development environment saves the day**: Catching issues before production is why we test in dev
5. **Even "passing" tests can hide bugs**: 100% test pass rate doesn't mean bug-free code

## Prevention Measures

- ✅ Automated verification of mock methods
- ✅ Pre-commit hooks block invalid mocks
- ✅ Clear documentation and examples
- ⏳ Ongoing migration to consolidated mocks (5% → 100%)

## Action Items

- [x] Create mock verification tooling
- [x] Add pre-commit enforcement
- [x] Document the issue and solutions
- [ ] Extend `__mocks__/modules.js` with missing components
- [ ] Create GitHub issue to track migration progress
- [ ] Add mock verification to CI pipeline
