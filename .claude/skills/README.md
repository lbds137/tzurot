# Tzurot v3 Skills Index

> **Important**: Requirements (rules) are now in `.claude/rules/` and load automatically every session.
> Skills are now **pure procedures** - invoke them with `/skill-name` for step-by-step workflows.

## Available Skills (Procedures)

| Skill                                                 | Purpose                                | Invoke With            |
| ----------------------------------------------------- | -------------------------------------- | ---------------------- |
| [tzurot-git-workflow](./tzurot-git-workflow/SKILL.md) | Commit, PR, release procedures         | `/tzurot-git-workflow` |
| [tzurot-deployment](./tzurot-deployment/SKILL.md)     | Railway deployment & troubleshooting   | `/tzurot-deployment`   |
| [tzurot-docs](./tzurot-docs/SKILL.md)                 | Session start/end, CURRENT.md workflow | `/tzurot-docs`         |
| [tzurot-db-vector](./tzurot-db-vector/SKILL.md)       | Prisma migrations, drift fixes         | `/tzurot-db-vector`    |
| [tzurot-testing](./tzurot-testing/SKILL.md)           | Test execution, coverage audits        | `/tzurot-testing`      |
| [tzurot-council-mcp](./tzurot-council-mcp/SKILL.md)   | Multi-perspective AI consultation      | `/tzurot-council-mcp`  |
| [tzurot-doc-audit](./tzurot-doc-audit/SKILL.md)       | Documentation freshness audit          | `/tzurot-doc-audit`    |
| [tzurot-arch-audit](./tzurot-arch-audit/SKILL.md)     | Architecture health audit              | `/tzurot-arch-audit`   |

## Rules (Auto-Loaded)

The following rules load automatically every session - no invocation needed:

| Rule                   | Content                                     |
| ---------------------- | ------------------------------------------- |
| `00-critical.md`       | Security, git safety, testing               |
| `01-architecture.md`   | Service boundaries, where code belongs      |
| `02-code-standards.md` | ESLint limits, TypeScript, testing patterns |
| `03-database.md`       | Prisma, pgvector, caching                   |
| `04-discord.md`        | 3-second deferral, slash commands, BullMQ   |
| `05-tooling.md`        | CLI reference, commit & release standards   |
| `06-backlog.md`        | Backlog structure, session workflow         |
| `07-documentation.md`  | Doc placement, naming, lifecycle            |

## Common Workflows

**New Feature**: Read rules → Code → `/tzurot-testing` → `/tzurot-git-workflow`

**Bug Fix**: Read rules → Fix → `/tzurot-testing` → `/tzurot-git-workflow`

**Database Changes**: `/tzurot-db-vector` → `/tzurot-testing` → `/tzurot-git-workflow`

**Deploy Issue**: `/tzurot-deployment` → check logs

**Session End**: `/tzurot-docs` → update CURRENT.md

**Doc Audit**: `/tzurot-doc-audit` → fix staleness → commit

**Architecture Audit**: `/tzurot-arch-audit` → quick scan → fix findings → update baselines

---

**Last Updated**: 2026-02-13
