# DDD Documentation Navigation Guide

## 🎯 Quick Links by Purpose

### "I want to understand the current state"

1. **[README.md](README.md)** - Start here! Honest overview
2. **[MIGRATION_STATUS_REALITY.md](MIGRATION_STATUS_REALITY.md)** - Detailed status
3. **[CURRENT_HYBRID_ARCHITECTURE.md](CURRENT_HYBRID_ARCHITECTURE.md)** - How it works now

### "I want to continue the DDD migration"

1. **[AI_SERVICE_MIGRATION_PLAN.md](AI_SERVICE_MIGRATION_PLAN.md)** - Next recommended step
2. **[CONVERSATION_DOMAIN_GAP_ANALYSIS.md](CONVERSATION_DOMAIN_GAP_ANALYSIS.md)** - Why not conversations
3. **[SINGLETON_MIGRATION_GUIDE.md](SINGLETON_MIGRATION_GUIDE.md)** - Avoid circular deps

### "I want to understand what went wrong"

1. **[DDD_IMPLEMENTATION_SUMMARY.md](DDD_IMPLEMENTATION_SUMMARY.md)** - Has warnings about aspirational content
2. **[CONVERSATION_QUICK_REFERENCE.md](CONVERSATION_QUICK_REFERENCE.md)** - Why conversation domain isn't ready

### "I need implementation details"

1. **[CONVERSATION_DOMAIN_DETAILED_ANALYSIS.md](CONVERSATION_DOMAIN_DETAILED_ANALYSIS.md)** - Full conversation analysis
2. **[DDD_DEPLOYMENT_GUIDE.md](DDD_DEPLOYMENT_GUIDE.md)** - Production considerations
3. **[DDD_ENABLEMENT_GUIDE.md](DDD_ENABLEMENT_GUIDE.md)** - Using feature flags

## 📁 File Organization

```
docs/ddd/
├── README.md ← START HERE
├── Current State Documentation
│   ├── MIGRATION_STATUS_REALITY.md
│   ├── CURRENT_HYBRID_ARCHITECTURE.md
│   └── NAVIGATION_GUIDE.md (this file)
├── Migration Plans
│   ├── AI_SERVICE_MIGRATION_PLAN.md
│   ├── CONVERSATION_DOMAIN_DETAILED_ANALYSIS.md
│   ├── CONVERSATION_DOMAIN_GAP_ANALYSIS.md
│   └── CONVERSATION_QUICK_REFERENCE.md
├── Reference Guides
│   ├── SINGLETON_MIGRATION_GUIDE.md
│   ├── DDD_DEPLOYMENT_GUIDE.md
│   └── DDD_ENABLEMENT_GUIDE.md
└── Historical/Aspirational (use with caution)
    └── DDD_IMPLEMENTATION_SUMMARY.md
```

## ⚠️ Document Status Key

- ✅ **Current & Accurate**: Reflects reality as of July 2025
- ⚠️ **Partially Outdated**: Some sections may not reflect current state
- ❌ **Aspirational**: Describes plans that didn't happen

| Document                       | Status              | Last Verified |
| ------------------------------ | ------------------- | ------------- |
| README.md                      | ✅ Current          | July 2025     |
| MIGRATION_STATUS_REALITY.md    | ✅ Current          | July 2025     |
| CURRENT_HYBRID_ARCHITECTURE.md | ✅ Current          | July 2025     |
| AI_SERVICE_MIGRATION_PLAN.md   | ✅ Current          | July 2025     |
| CONVERSATION*DOMAIN*\*.md      | ✅ Current          | July 2025     |
| DDD_IMPLEMENTATION_SUMMARY.md  | ⚠️ Aspirational     | Has warnings  |
| DDD_DEPLOYMENT_GUIDE.md        | ⚠️ Check references | June 2025     |
| DDD_ENABLEMENT_GUIDE.md        | ⚠️ Check accuracy   | June 2025     |

## 🔍 Finding Information

### By Component

- **Commands** → Any DDD doc (fully migrated)
- **Authentication** → Any DDD doc (fully migrated)
- **AI Service** → [AI_SERVICE_MIGRATION_PLAN.md](AI_SERVICE_MIGRATION_PLAN.md) (not migrated)
- **Conversations** → [CONVERSATION*DOMAIN*\*.md](CONVERSATION_DOMAIN_GAP_ANALYSIS.md) (not ready)
- **Message Flow** → Legacy docs, not in DDD

### By Task

- **Add new command** → Follow existing DDD patterns
- **Modify AI logic** → Work in legacy `aiService.js`
- **Update conversations** → Work in legacy `conversationManager.js`
- **Change auth** → Use DDD `AuthenticationApplicationService`

## 📝 Documentation Maintenance

When updating docs:

1. Always update this navigation guide
2. Mark outdated sections clearly
3. Update the status table above
4. Link back to README.md as truth source

## Missing Documentation

The following were referenced but don't exist:

- POST_DDD_REALITY_CHECK.md
- DOMAIN_DRIVEN_DESIGN_PLAN.md
- DDD_PHASE_0_GUIDE.md
- DDD_MIGRATION_CHECKLIST.md
- FEATURE_FLAGS.md

Don't create these - they represent aspirational planning that didn't match reality.
