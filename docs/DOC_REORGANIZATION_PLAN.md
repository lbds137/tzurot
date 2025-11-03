# Documentation Reorganization Plan

**Date:** 2025-10-28
**Purpose:** Clean up scattered markdown files and establish clear organization

## Current Issues

1. **Root-level clutter:** 12+ markdown files in project root
2. **Loose docs/:** 9 uncategorized files directly in docs/
3. **Unclear categorization:** Hard to find relevant documentation
4. **Duplicates/obsoletes:** Old migration docs, one-time summaries

## Proposed Structure

```
tzurot/
├── README.md                          ← Project overview
├── CHANGELOG.md                       ← Version history
├── CLAUDE.md                          ← Claude Code instructions
├── CURRENT_WORK.md                    ← Active work tracker
│
├── docs/
│   ├── architecture/                  ← Design decisions & patterns
│   │   ├── ARCHITECTURE_DECISIONS.md  (moved from root)
│   │   ├── ANTIPATTERN_REVIEW.md
│   │   ├── group-conversation-design.md (moved from docs/)
│   │   ├── ltm-summarization-design.md  (moved from docs/)
│   │   ├── memory-and-context-redesign.md (moved from docs/)
│   │   ├── MEMORY_FORMAT_COMPARISON.md
│   │   ├── pantheons-and-memory-scopes.md (moved from docs/)
│   │   ├── POSTGRES_SCHEMA.md
│   │   ├── PROMPT_CACHING_STRATEGY.md
│   │   └── SHAPES_INC_MIGRATION_STRATEGY.md
│   │
│   ├── deployment/                    ← Deployment guides
│   │   ├── DEPLOYMENT.md              (moved from root, merged with RAILWAY_DEPLOYMENT.md)
│   │   ├── RAILWAY_SHARED_VARIABLES.md
│   │   └── RAILWAY_VOLUME_SETUP.md
│   │
│   ├── guides/                        ← Developer guides
│   │   ├── DEVELOPMENT.md             (moved from root)
│   │   └── TESTING.md                 (renamed from TESTING_STEPS.md)
│   │
│   ├── migration/                     ← Migration guides
│   │   ├── PERSONA_MIGRATION_GUIDE.md (moved from docs/)
│   │   ├── shapes-inc-uuid-migration.md (moved from docs/)
│   │   ├── SHAPES_INC_CREDENTIALS.md
│   │   └── SHAPES_INC_IMPORT_PLAN.md
│   │
│   ├── planning/                      ← Project planning
│   │   ├── gemini-code-review.md      (renamed from Gemini-Tzurot V3 Code Review & Refinement.md)
│   │   ├── V2_FEATURES_TO_PORT.md
│   │   ├── V2_FEATURE_TRACKING.md     (moved from root)
│   │   └── V3_REFINEMENT_ROADMAP.md
│   │
│   ├── features/                      ← Feature documentation
│   │   └── SLASH_COMMAND_UX_FEATURES.md
│   │
│   ├── improvements/                  ← Improvement proposals
│   │   ├── MEMORY_INGESTION_IMPROVEMENTS.md
│   │   └── QDRANT_TOOLING_NEEDED.md
│   │
│   ├── operations/                    ← Operational procedures
│   │   └── DATABASE_BACKUP_STRATEGY.md
│   │
│   ├── reference/                     ← Reference documentation
│   │   └── RAILWAY_CLI_REFERENCE.md
│   │
│   ├── templates/                     ← Document templates
│   │   └── MIGRATION_TEMPLATE.md
│   │
│   └── archive/                       ← Completed/obsolete docs
│       ├── ARCHITECTURE_CLEANUP_SUMMARY.md (moved from root)
│       ├── CODE_QUALITY_AUDIT.md      (moved from docs/)
│       ├── CONTEXT_HANDOFF.md         (moved from root)
│       ├── schema-and-conversation-fix.md (moved from docs/)
│       ├── schema-redesign-proposal.md (moved from docs/)
│       ├── TZUROT_V3_IMPLEMENTATION_STATUS_2025-10-02.md
│       ├── V3_IMPLEMENTATION_PLAN.md  (moved from root)
│       └── README.md
│
├── .github/                           ← GitHub-specific docs (unchanged)
│   ├── PULL_REQUEST_TEMPLATE/
│   ├── pull_request_template.md
│   └── rulesets/README.md
│
└── scripts/                           ← Script-specific docs (unchanged)
    ├── import-personality/
    │   ├── PROGRESS.md
    │   ├── README.md
    │   └── SESSION_SUMMARY.md
    ├── QDRANT_CLI.md
    ├── README_BACKUP_SCRIPT.md
    └── README.md
```

## Actions Required

### Move from root to docs/

- [x] ARCHITECTURE_DECISIONS.md → docs/architecture/
- [ ] DEPLOYMENT.md → docs/deployment/ (merge with RAILWAY_DEPLOYMENT.md)
- [ ] DEVELOPMENT.md → docs/guides/
- [ ] TESTING_STEPS.md → docs/guides/TESTING.md (rename)
- [ ] V2_FEATURE_TRACKING.md → docs/planning/

### Move to archive/

- [ ] ARCHITECTURE_CLEANUP_SUMMARY.md → docs/archive/
- [ ] CONTEXT_HANDOFF.md → docs/archive/
- [ ] V3_IMPLEMENTATION_PLAN.md → docs/archive/ (plan completed)

### Organize loose docs/ files

- [ ] CODE_QUALITY_AUDIT.md → docs/archive/
- [ ] group-conversation-design.md → docs/architecture/
- [ ] ltm-summarization-design.md → docs/architecture/
- [ ] memory-and-context-redesign.md → docs/architecture/
- [ ] PERSONA_MIGRATION_GUIDE.md → docs/migration/
- [ ] pantheons-and-memory-scopes.md → docs/architecture/
- [ ] schema-and-conversation-fix.md → docs/archive/
- [ ] schema-redesign-proposal.md → docs/archive/
- [ ] shapes-inc-uuid-migration.md → docs/migration/

### Rename for clarity

- [ ] Gemini-Tzurot V3 Code Review & Refinement.md → docs/planning/gemini-code-review.md
- [ ] TESTING_STEPS.md → docs/guides/TESTING.md

### Merge duplicates

- [ ] RAILWAY_DEPLOYMENT.md + DEPLOYMENT.md → docs/deployment/DEPLOYMENT.md

### Delete if obsolete

- [ ] READY_TO_DEPLOY.md (check if needed first)

## Guidelines for Future Docs

### Root Level (Only 4 files)

- `README.md` - Project overview, quick start
- `CHANGELOG.md` - Version history
- `CLAUDE.md` - Claude Code instructions
- `CURRENT_WORK.md` - Active work status

### docs/ Categories

**architecture/** - Design decisions, patterns, system design

- Naming: Describe the topic, not the action (e.g., "Memory Format" not "Memory Format Comparison")

**deployment/** - Deployment procedures and guides

- Railway configuration, environment setup, deployment checklist

**guides/** - How-to guides for developers

- Development setup, testing, debugging

**migration/** - Data migration guides

- Step-by-step migration procedures with examples

**planning/** - Project planning and roadmaps

- Feature planning, code reviews, tracking docs

**features/** - Feature-specific documentation

- Detailed feature specs, user stories

**improvements/** - Improvement proposals

- Not-yet-implemented enhancements

**operations/** - Operational procedures

- Backup, monitoring, incident response

**reference/** - Reference documentation

- CLI references, API docs, configuration options

**templates/** - Reusable document templates

- Use these to maintain consistency

**archive/** - Completed/obsolete documentation

- One-time audits, completed plans, historical records

## Next Steps

1. Review this plan
2. Execute file moves (use git mv to preserve history)
3. Update any cross-references in docs
4. Update CLAUDE.md with new structure
5. Delete this plan file after completion
