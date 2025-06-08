# Documentation Cleanup Recommendations

## Overview
Beyond the improvements folder cleanup, the documentation structure has grown organically and needs consolidation to reduce duplication and improve findability.

## Recommended Consolidations

### 1. Testing Documentation
**Problem**: Mock and testing guidance spread across 10+ files

**Consolidate into**:
- `docs/testing/TESTING_GUIDE.md` - Main testing resource combining:
  - BEHAVIOR_BASED_TESTING.md
  - TEST_ANTIPATTERNS_REFERENCE.md
  - MANUAL_TESTING_PROCEDURE.md
  
- `docs/testing/MOCK_SYSTEM_GUIDE.md` - All mock-related content:
  - MOCK_PATTERN_RULES.md
  - MOCK_VERIFICATION_ENFORCEMENT.md
  - MOCK_VERIFICATION_GUIDE.md
  - MOCK_ISOLATION_LESSONS.md

- `docs/testing/TIMER_TESTING_COMPLETE.md` - Combine all timer content:
  - core/TIMER_PATTERNS.md
  - development/TIMER_ENFORCEMENT_GUIDE.md
  - testing/TIMER_TESTING_GUIDE.md

### 2. Git Workflow Documentation
**Problem**: 5 documents about git workflow with overlapping content

**Consolidate into**:
- `docs/development/GIT_AND_PR_WORKFLOW.md` - Combine:
  - GIT_WORKFLOW.md
  - GIT_WORKFLOW_SYNC_GUIDE.md
  - PR_WORKFLOW_RULES.md
  - BRANCH_PROTECTION_GUIDELINES.md
  - WORKFLOW_SUMMARY.md

### 3. Command System Documentation
**Problem**: Commands documented in multiple places

**Consolidate into**:
- `docs/core/COMMAND_SYSTEM.md` - Merge:
  - COMMANDS.md
  - COMMAND_ARCHITECTURE.md
  - Reference src/commands/CLAUDE.md content

### 4. Architecture Documentation
**Problem**: Old architecture docs conflict with new DDD plan

**Action**:
- Update `docs/core/ARCHITECTURE.md` to reference DDD plan
- Add deprecation notice pointing to new structure
- Keep as transition document until DDD Phase 2

### 5. Feature Documentation
**Problem**: Related features documented separately

**Consolidate**:
- ✅ Merged GITHUB_WEBHOOK_NOTIFICATIONS.md + RELEASE_NOTIFICATIONS.md → `RELEASE_NOTIFICATION_SYSTEM.md`
- Move PLURALKIT_PROXY_HANDLING.md to authentication section

## Duplicate Content to Remove

### Exact Duplicates
- Timer patterns appear in 3 places - keep only one comprehensive guide
- Mock patterns documented in both CLAUDE.md files and testing folder

### Near Duplicates
- Setup instructions in README.md and docs/core/SETUP.md
- Security guidelines in CLAUDE.md and docs/core/SECURITY.md

## New Structure Proposal

```
docs/
├── architecture/
│   ├── CURRENT_ARCHITECTURE.md (with DDD migration notice)
│   └── ddd/  (all DDD documents)
├── development/
│   ├── GIT_AND_PR_WORKFLOW.md (consolidated)
│   ├── SETUP.md
│   └── CONTRIBUTING.md
├── features/
│   ├── commands/
│   ├── personalities/
│   ├── webhooks/
│   └── notifications/
├── testing/
│   ├── TESTING_GUIDE.md (main guide)
│   ├── MOCK_SYSTEM_GUIDE.md
│   └── reference/ (case studies, postmortems)
├── api/
│   └── API_REFERENCE.md
└── operations/
    ├── DEPLOYMENT.md
    ├── TROUBLESHOOTING.md
    └── SECURITY.md
```

## Benefits

1. **Reduced Duplication**: From ~60 docs to ~30
2. **Clear Categories**: Features, development, testing, operations
3. **Single Source of Truth**: One place for each topic
4. **Better Discoverability**: Logical grouping

## Implementation Priority

1. **High Priority** (Do with DDD Phase 0):
   - Consolidate timer documentation (blocking tests)
   - Merge mock documentation (preventing bugs)

2. **Medium Priority** (Do before DDD Phase 1):
   - Consolidate git workflow docs
   - Clean up command documentation

3. **Low Priority** (Can wait):
   - Feature documentation reorganization
   - Architecture transition docs

## Automation Opportunities

Create scripts to:
- Check for duplicate content between files
- Verify internal documentation links
- Generate documentation index/map
- Track documentation coverage per component