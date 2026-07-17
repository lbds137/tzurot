# Tzurot v3 Skills Index

> **Layering**: constraints (rules) live in `.claude/rules/` and load automatically
> every session. Skills are **pure procedures** — invoke with `/skill-name` for
> step-by-step workflows. The `skill-eval.sh` UserPromptSubmit hook nudges skill
> loading when prompt keywords match.

## Available Skills (Procedures)

| Skill                                                       | Purpose                                                        | Invoke With               |
| ----------------------------------------------------------- | -------------------------------------------------------------- | ------------------------- |
| [tzurot-git-workflow](./tzurot-git-workflow/SKILL.md)       | Commit, PR, rebase, release procedures                         | `/tzurot-git-workflow`    |
| [tzurot-deployment](./tzurot-deployment/SKILL.md)           | Railway deployment & troubleshooting                           | `/tzurot-deployment`      |
| [tzurot-docs](./tzurot-docs/SKILL.md)                       | Session start/end, CURRENT.md workflow                         | `/tzurot-docs`            |
| [tzurot-db-vector](./tzurot-db-vector/SKILL.md)             | Prisma migrations, drift fixes, pgvector                       | `/tzurot-db-vector`       |
| [tzurot-testing](./tzurot-testing/SKILL.md)                 | Test execution, coverage audits, tier verification             | `/tzurot-testing`         |
| [tzurot-council-mcp](./tzurot-council-mcp/SKILL.md)         | Multi-perspective AI consultation                              | `/tzurot-council-mcp`     |
| [tzurot-doc-audit](./tzurot-doc-audit/SKILL.md)             | Documentation + auto-memory freshness audit                    | `/tzurot-doc-audit`       |
| [tzurot-arch-audit](./tzurot-arch-audit/SKILL.md)           | Architecture health audit                                      | `/tzurot-arch-audit`      |
| [tzurot-bug-remediation](./tzurot-bug-remediation/SKILL.md) | Recurring-bug protocol: evidence → class sweep → guard         | `/tzurot-bug-remediation` |
| [tzurot-reuse-scout](./tzurot-reuse-scout/SKILL.md)         | Pre-write reuse scouting, drifted-duplicate consolidation      | `/tzurot-reuse-scout`     |
| [tzurot-design-boulder](./tzurot-design-boulder/SKILL.md)   | Grounded, council-reviewed design sessions → ACCEPTED artifact | `/tzurot-design-boulder`  |

## Rules (Auto-Loaded)

The following rules load automatically every session — no invocation needed:

| Rule                      | Content                                       |
| ------------------------- | --------------------------------------------- |
| `00-critical.md`          | Security, git safety, testing                 |
| `01-architecture.md`      | Service boundaries, where code belongs        |
| `02-code-standards.md`    | ESLint limits, TypeScript, testing patterns   |
| `03-database.md`          | Prisma, pgvector, caching                     |
| `04-discord.md`           | 3-second deferral, slash commands, BullMQ     |
| `05-tooling.md`           | CLI reference, commit & release standards     |
| `06-backlog.md`           | Backlog structure, session workflow           |
| `07-documentation.md`     | Doc placement, naming, lifecycle              |
| `08-review-response.md`   | PR review-response iteration (auto-apply/ASK) |
| `09-interaction-style.md` | Session interaction style                     |
| `10-working-posture.md`   | How to drive a session                        |

## Common Workflows

**New Feature**: rules load → `/tzurot-reuse-scout` before new logic → code → `/tzurot-testing` → `/tzurot-git-workflow`

**Bug Fix**: fix → `/tzurot-testing` → `/tzurot-git-workflow` (recurring bug? → `/tzurot-bug-remediation`)

**Database Changes**: `/tzurot-db-vector` → `/tzurot-testing` → `/tzurot-git-workflow`

**Deploy Issue**: `/tzurot-deployment` → check logs

**Big Design**: `/tzurot-design-boulder` (grounding → council → ACCEPTED artifact)

**Session End**: `/tzurot-docs` → update CURRENT.md

**Audits**: `/tzurot-doc-audit` (docs + memory) · `/tzurot-arch-audit` (boundaries + health)
