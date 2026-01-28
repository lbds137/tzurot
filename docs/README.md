# Tzurot v3 Documentation

**Last Updated:** 2026-01-04

This directory contains all project documentation, organized by lifecycle stage for easy navigation.

## Documentation Structure

### 📚 [reference/](reference/)

**What currently exists** - The source of truth for implemented systems.

| Subdirectory    | Contents                                                  |
| --------------- | --------------------------------------------------------- |
| `architecture/` | Design decisions, system architecture, technical patterns |
| `deployment/`   | Railway deployment guides, environment setup              |
| `operations/`   | Runbooks, backup procedures, maintenance                  |
| `standards/`    | Coding patterns, folder structure, UX conventions         |
| `guides/`       | Developer how-tos, testing guides                         |
| `features/`     | Feature-specific documentation                            |
| `testing/`      | Test procedures and checklists                            |
| `database/`     | Schema documentation                                      |
| `templates/`    | Reusable document templates                               |

**Key docs:**

- `reference/architecture/ARCHITECTURE_DECISIONS.md` - Core architectural choices
- `reference/deployment/RAILWAY_OPERATIONS.md` - Primary deployment and operations guide
- `reference/guides/DEVELOPMENT.md` - Local development setup
- `reference/standards/FOLDER_STRUCTURE.md` - File organization standards

### 📋 [proposals/](proposals/)

**What we want to build** - Plans and ideas for future work.

| Subdirectory | Contents                               |
| ------------ | -------------------------------------- |
| `active/`    | Currently being worked on (on roadmap) |
| `backlog/`   | Ideas not yet scheduled                |

**Active proposals:**

- `proposals/active/TECH_DEBT.md` - Tech debt tracking and metrics
- `proposals/active/MEMORY_MANAGEMENT_COMMANDS.md` - Phase 2 (LTM) in progress
- `proposals/active/SHAPES_INC_SLASH_COMMAND_DESIGN.md` - Import feature design
- `proposals/active/V2_FEATURE_TRACKING.md` - Feature parity tracking

**Backlog proposals:**

- `proposals/backlog/multi-personality-support.md` - Multi-personality channels
- `proposals/backlog/ltm-context-separation.md` - Memory isolation improvements
- `proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md` - Future architecture

### 🔥 [incidents/](incidents/)

**What went wrong** - Post-mortems and lessons learned.

**Key docs:**

- `incidents/PROJECT_POSTMORTEMS.md` - All v3 development post-mortems

### 🔄 [migration/](migration/)

**Active migration guides** - Data migration procedures.

**Key docs:**

- `migration/PERSONA_MIGRATION_GUIDE.md` - Migrating persona data
- `migration/SHAPES_INC_IMPORT_PLAN.md` - Importing from Shapes.inc

---

## Decision Rules

| Question             | Answer                                                   |
| -------------------- | -------------------------------------------------------- |
| Is it implemented?   | → `reference/`                                           |
| Is it a plan/idea?   | → `proposals/` (active or backlog)                       |
| Is it done/obsolete? | → Extract learnings, then DELETE (git preserves history) |
| Is it an incident?   | → `incidents/`                                           |

---

## Quick Links

**Starting Development:**

1. [Development Setup](reference/guides/DEVELOPMENT.md)
2. [Architecture Overview](reference/architecture/ARCHITECTURE_DECISIONS.md)
3. [Operations Guide](reference/deployment/RAILWAY_OPERATIONS.md)

**Understanding the System:**

1. [Memory System](reference/architecture/memory-and-context-redesign.md)
2. [Database Schema](reference/architecture/POSTGRES_SCHEMA.md)
3. [Group Conversations](reference/architecture/group-conversation-design.md)

**Planning Work:**

1. [Tech Debt Tracking](proposals/active/TECH_DEBT.md)
2. [Feature Tracking](proposals/active/V2_FEATURE_TRACKING.md)
3. [OpenMemory Migration](proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)

---

## Documentation Guidelines

### Where to Put New Docs

| Doc Type             | Location                  | When to Use                       |
| -------------------- | ------------------------- | --------------------------------- |
| Design decision      | `reference/architecture/` | After implementation complete     |
| Deployment procedure | `reference/deployment/`   | Railway setup, environment config |
| Developer guide      | `reference/guides/`       | How-tos for common tasks          |
| Coding standard      | `reference/standards/`    | Patterns to follow                |
| Active proposal      | `proposals/active/`       | On the roadmap, being worked      |
| Future idea          | `proposals/backlog/`      | Good idea, not scheduled          |
| Post-mortem          | `incidents/`              | After incident resolution         |
| Migration guide      | `migration/`              | Active data migrations            |

### Naming Conventions

- Use `UPPERCASE_WITH_UNDERSCORES.md` for major documents
- Use `lowercase-with-dashes.md` for specific topics
- Be descriptive: `memory-and-context-redesign.md` not `memory.md`
- Avoid dates in filenames (use git history or frontmatter instead)

### Lifecycle Management

When a proposal is completed:

1. Extract any reusable learnings to `reference/` or skills
2. Update incident docs if issues were discovered
3. Delete the proposal (git history preserves it)

---

## Root-Level Documentation

These docs remain in the project root for visibility:

- `README.md` - Project overview and quick start
- `CLAUDE.md` - Claude Code instructions
- `CURRENT_WORK.md` - Current work status and session context
- `ROADMAP.md` - Project roadmap and priorities

**Version History:** See [GitHub Releases](https://github.com/lbds137/tzurot/releases)
