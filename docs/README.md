# Tzurot v3 Documentation

**Last Updated:** 2025-12-08

This directory contains all project documentation, organized by category for easy navigation.

## Documentation Structure

### 📐 [architecture/](architecture/)

Design decisions, system architecture, and technical patterns.

**Key docs:**

- `ARCHITECTURE_DECISIONS.md` - Core architectural choices and rationale
- `group-conversation-design.md` - Multi-participant conversation handling
- `memory-and-context-redesign.md` - STM/LTM architecture
- `pantheons-and-memory-scopes.md` - Canon groups and memory scoping

### 🚀 [deployment/](deployment/)

Deployment guides and infrastructure setup.

**Key docs:**

- `RAILWAY_DEPLOYMENT.md` - Railway deployment guide (primary reference)
- `RAILWAY_SHARED_VARIABLES.md` - Environment variable setup
- `RAILWAY_VOLUME_SETUP.md` - Persistent storage configuration

### 📖 [guides/](guides/)

Developer guides and how-tos.

**Key docs:**

- `DEVELOPMENT.md` - Local development setup
- `TESTING.md` - Testing procedures and checklist

### 🔄 [migration/](migration/)

Data migration guides and procedures.

**Key docs:**

- `PERSONA_MIGRATION_GUIDE.md` - Migrating persona data
- `SHAPES_INC_IMPORT_PLAN.md` - Importing from Shapes.inc API
- `SHAPES_INC_CREDENTIALS.md` - API credentials and access

### 📋 [planning/](planning/)

Project planning, roadmaps, and feature tracking.

**Key docs:**

- `V3_REFINEMENT_ROADMAP.md` - Prioritized improvement roadmap
- `OPENMEMORY_MIGRATION_PLAN.md` - OpenMemory architecture migration plan
- `V2_FEATURES_TO_PORT.md` - V2 features awaiting v3 implementation
- `V2_FEATURE_TRACKING.md` - Status of ported features

### ✨ [features/](features/)

Feature-specific documentation and specs.

**Key docs:**

- `SLASH_COMMAND_UX_FEATURES.md` - Discord slash command design

### 💡 [improvements/](improvements/)

Improvement proposals and enhancement ideas.

**Key docs:**

- `MEMORY_INGESTION_IMPROVEMENTS.md` - LTM storage enhancements
- `QDRANT_TOOLING_NEEDED.md` - Vector DB tooling wishlist

### ⚙️ [operations/](operations/)

Operational procedures and runbooks.

**Key docs:**

- `DATABASE_BACKUP_STRATEGY.md` - Backup and recovery procedures

### 🔥 [postmortems/](postmortems/)

Incident post-mortems and lessons learned.

**Key docs:**

- `PROJECT_POSTMORTEMS.md` - All v3 development post-mortems and prevention measures

### 📚 [reference/](reference/)

Reference documentation and quick lookups.

**Key docs:**

- `RAILWAY_CLI_REFERENCE.md` - Railway CLI command reference
- `GITHUB_CLI_REFERENCE.md` - GitHub CLI (gh) command reference with common pitfalls

### 📄 [templates/](templates/)

Reusable document templates.

**Key docs:**

- `MIGRATION_TEMPLATE.md` - Template for migration procedures

### 📏 [standards/](standards/)

Coding standards and UX patterns.

**Key docs:**

- `FOLDER_STRUCTURE.md` - File and folder organization standards
- `SLASH_COMMAND_UX.md` - Discord slash command UX patterns and best practices

---

## Quick Links

**Starting Development:**

1. [Development Setup](guides/DEVELOPMENT.md)
2. [Architecture Overview](architecture/ARCHITECTURE_DECISIONS.md)
3. [Deployment Guide](deployment/RAILWAY_DEPLOYMENT.md)

**Understanding the System:**

1. [Memory System](architecture/memory-and-context-redesign.md)
2. [Database Schema](architecture/POSTGRES_SCHEMA.md)
3. [Group Conversations](architecture/group-conversation-design.md)

**Planning Work:**

1. [Refinement Roadmap](planning/V3_REFINEMENT_ROADMAP.md)
2. [OpenMemory Migration Plan](planning/OPENMEMORY_MIGRATION_PLAN.md)
3. [Feature Tracking](planning/V2_FEATURE_TRACKING.md)

---

## Documentation Guidelines

### Where to Put New Docs

| Doc Type              | Location        | Example                           |
| --------------------- | --------------- | --------------------------------- |
| Design decision       | `architecture/` | System architecture, data models  |
| Deployment procedure  | `deployment/`   | Railway setup, environment config |
| Developer guide       | `guides/`       | Local setup, debugging, testing   |
| Migration procedure   | `migration/`    | Data migrations, imports          |
| Project planning      | `planning/`     | Roadmaps, feature tracking        |
| Feature spec          | `features/`     | Detailed feature documentation    |
| Improvement proposal  | `improvements/` | Not-yet-implemented enhancements  |
| Operational procedure | `operations/`   | Backups, monitoring, incidents    |
| Post-mortem           | `postmortems/`  | Incident analysis, lessons learned|
| Reference doc         | `reference/`    | CLI references, API docs          |
| Coding standard       | `standards/`    | UX patterns, file organization    |
| Template              | `templates/`    | Reusable document templates       |
| One-time/completed    | `archive/`      | Historical records                |

### Naming Conventions

- Use `UPPERCASE_WITH_UNDERSCORES.md` for major documents
- Use `lowercase-with-dashes.md` for specific topics
- Be descriptive: `memory-and-context-redesign.md` not `memory.md`
- Avoid dates in names (use git history instead)

### Cross-References

When linking to other docs:

```markdown
See [Memory Architecture](architecture/memory-and-context-redesign.md)
```

Use relative paths from the current doc location.

---

## Root-Level Documentation

These docs remain in the project root for visibility:

- `README.md` - Project overview and quick start
- `CLAUDE.md` - Claude Code instructions
- `CURRENT_WORK.md` - Current work status
- `ROADMAP.md` - Project roadmap and sprint planning

**Version History:** See [GitHub Releases](https://github.com/lbds137/tzurot/releases)
