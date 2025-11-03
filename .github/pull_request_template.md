## 🚨 FEATURE FREEZE IN EFFECT 🚨

**Effective**: June 8, 2025 - August 24, 2025  
**Reason**: Critical DDD architectural migration

## Pre-Submission Checklist

**ALL boxes must be checked or PR will be closed:**

- [ ] This is NOT a new feature
- [ ] This is EITHER:
  - [ ] A critical bug fix (meets ALL criteria below)
  - [ ] Part of the DDD migration plan
  - [ ] Technical debt reduction that directly supports DDD
- [ ] Changes touch < 10 files
- [ ] NO backwards compatibility layers added
- [ ] NO new facades or workarounds added
- [ ] NO new files in `/src/utils/` (already has 28 files!)
- [ ] Includes tests for all changes
- [ ] All tests pass locally

## Critical Bug Fix Criteria

If this is a bug fix, it must meet ALL of these:

- [ ] Causes data loss OR security vulnerability
- [ ] Affects > 10% of users
- [ ] Has NO workaround available
- [ ] Fix touches < 10 files
- [ ] Includes regression tests

## DDD Migration Work

If this is DDD migration work:

- [ ] Listed in Phase 0-4 plan
- [ ] Follows domain boundaries
- [ ] No dependencies on legacy code
- [ ] 100% test coverage for new domain code

## Description

### What does this PR do?

<!-- Describe changes in 1-2 sentences -->

### Why is this needed during freeze?

<!-- Justify why this cannot wait -->

### What is the impact of NOT merging?

<!-- Describe consequences of deferral -->

## Testing

### Test coverage

<!-- Paste coverage report for changed files -->

### Manual testing performed

<!-- List manual verification steps -->

## Automatic Rejection Criteria

PR will be auto-closed if it:

- Adds files to `/src/utils/`
- Increases any file size > 500 lines
- Adds circular dependencies
- Creates new singletons
- Adds "TODO: refactor later" comments
- Is a "quick improvement" or "small feature"

## Reviewer Checklist

- [ ] Verified this meets freeze criteria
- [ ] No scope creep from original intent
- [ ] Tests cover edge cases
- [ ] No new technical debt introduced

---

**Remember**: Every exception makes the next exception easier. Stay strong! 💪

The freeze is not punishment. It's survival.
