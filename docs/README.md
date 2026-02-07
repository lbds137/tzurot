# Tzurot v3 Documentation

**Last Updated:** 2026-02-07

This directory contains all project documentation, organized by lifecycle stage for easy navigation.

For doc placement, naming, and lifecycle rules, see `.claude/rules/07-documentation.md`.

## Documentation Structure

### [reference/](reference/)

**What currently exists** - The source of truth for implemented systems.

| Subdirectory    | Contents                                                  |
| --------------- | --------------------------------------------------------- |
| `architecture/` | Design decisions, system architecture, technical patterns |
| `caching/`      | Cache patterns, pub/sub invalidation                      |
| `database/`     | Prisma drift issues, schema documentation                 |
| `deployment/`   | Railway deployment guides, environment setup              |
| `features/`     | Feature-specific documentation                            |
| `guides/`       | Developer how-tos, testing guides                         |
| `operations/`   | Runbooks, backup procedures, maintenance                  |
| `standards/`    | Coding patterns, folder structure, UX conventions         |
| `templates/`    | Reusable document templates                               |
| `testing/`      | Test procedures and checklists                            |
| `tooling/`      | OPS CLI reference, tooling docs                           |

Root-level reference files: `DOCUMENTATION_PHILOSOPHY.md`, `STATIC_ANALYSIS.md`, `GITHUB_CLI_REFERENCE.md`, `RAILWAY_CLI_REFERENCE.md`, `REASONING_MODEL_FORMATS.md`, `v2-patterns-reference.md`

**Key docs:**

- `reference/architecture/ARCHITECTURE_DECISIONS.md` - Core architectural choices
- `reference/deployment/RAILWAY_OPERATIONS.md` - Primary deployment and operations guide
- `reference/guides/DEVELOPMENT.md` - Local development setup
- `reference/standards/FOLDER_STRUCTURE.md` - File organization standards

### [proposals/](proposals/)

**What we want to build** - Plans and ideas for future work.

| Subdirectory | Contents                               |
| ------------ | -------------------------------------- |
| `active/`    | Currently being worked on (on roadmap) |
| `backlog/`   | Ideas not yet scheduled                |

**Active proposals:**

- `proposals/active/GIT_HOOK_IMPROVEMENTS.md` - Git hook enhancements
- `proposals/active/MEMORY_MANAGEMENT_COMMANDS.md` - Memory management commands
- `proposals/active/V2_FEATURE_TRACKING.md` - Feature parity tracking

**Backlog proposals (selected):**

- `proposals/backlog/multi-personality-support.md` - Multi-personality channels
- `proposals/backlog/ltm-context-separation.md` - Memory isolation improvements
- `proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md` - Future architecture
- `proposals/backlog/SHAPES_INC_SLASH_COMMAND_DESIGN.md` - Import feature design

### [incidents/](incidents/)

**What went wrong** - Post-mortems and lessons learned.

- `incidents/PROJECT_POSTMORTEMS.md` - All v3 development post-mortems

### [migration/](migration/)

**Active migration guides** - Data migration procedures.

- `migration/PERSONA_MIGRATION_GUIDE.md` - Migrating persona data
- `migration/SHAPES_INC_IMPORT_PLAN.md` - Importing from Shapes.inc

### [research/](research/)

**Distilled insights** - AI consultation notes in TL;DR format.

- `research/README.md` - Research notes archive

### [steam-deck/](steam-deck/)

**Dev environment** - Steam Deck development setup.

- `steam-deck/SSH_SETUP.md` - SSH configuration

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

1. [Feature Tracking](proposals/active/V2_FEATURE_TRACKING.md)
2. [OpenMemory Migration](proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)

---

## Root-Level Documentation

These docs remain in the project root for visibility:

- `README.md` - Project overview and quick start
- `CLAUDE.md` - Claude Code instructions
- `CURRENT.md` - Current work status and session context
- `BACKLOG.md` - Project backlog and priorities

**Version History:** See [GitHub Releases](https://github.com/lbds137/tzurot/releases)
