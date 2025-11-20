# External Services Documentation Index

This directory contains sensitive documentation about external service integrations that is kept locally only.

## Quick Navigation Guide

### 📘 [SHAPES_INC_API_REFERENCE.md](./SHAPES_INC_API_REFERENCE.md)

**What it contains:**

- API endpoint documentation
- Authentication methods and requirements
- Data structure specifications
- Public vs Private API comparison
- Security considerations

**Use this when you need to:**

- ✅ Understand what data is available from the API
- ✅ Look up specific API response fields
- ✅ Compare public and private API capabilities
- ✅ Review authentication requirements

### 📗 [SHAPES_INC_MIGRATION_GUIDE.md](./SHAPES_INC_MIGRATION_GUIDE.md)

**What it contains:**

- Migration strategy and phases
- Implementation patterns for each feature
- Infrastructure and deployment guidance
- BYOK architecture design
- Performance optimization techniques

**Use this when you need to:**

- ✅ Implement local replacements for API features
- ✅ Set up memory, voice, or knowledge systems
- ✅ Optimize for Railway deployment
- ✅ Design the migration architecture

### 📙 [CHAT_HISTORY_BACKUP_GUIDE.md](./CHAT_HISTORY_BACKUP_GUIDE.md)

**What it contains:**

- How chat history backup is seamlessly integrated
- Technical details of the `before_ts` pagination
- Storage format and incremental sync strategy
- No additional configuration needed!

**Use this when you need to:**

- ✅ Understand how chat history backup works
- ✅ Troubleshoot chat history sync issues
- ✅ Learn about the pagination implementation
- ✅ See how data is stored for migration

## Decision Tree

```
Need external service info?
│
├─ Looking for API details?
│  └─→ See API_REFERENCE.md
│
├─ Implementing a feature locally?
│  └─→ See MIGRATION_GUIDE.md
│
└─ Need both?
   └─→ Start with API_REFERENCE.md for context,
       then MIGRATION_GUIDE.md for implementation
```

## Common Tasks

| Task                         | Document        | Section                        |
| ---------------------------- | --------------- | ------------------------------ |
| Check API limitations        | API_REFERENCE   | "Data Availability Comparison" |
| Implement memory system      | MIGRATION_GUIDE | "Phase 2: Memory Systems"      |
| Set up voice synthesis       | MIGRATION_GUIDE | "Phase 3: Voice Synthesis"     |
| Understand auth requirements | API_REFERENCE   | "Authentication"               |
| Design BYOK architecture     | MIGRATION_GUIDE | "Phase 5: BYOK Architecture"   |
| Review data structures       | API_REFERENCE   | "Response Structure"           |

## Notes

- This documentation is excluded from version control for security reasons
- Contains reverse-engineered API details and migration strategies
- Updates should maintain generic naming to avoid revealing service names
