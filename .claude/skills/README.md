# Tzurot v3 Skills Index

> **Layering**: constraints (rules) live in `.claude/rules/` and load automatically
> every session. Skills are **pure procedures** — invoke with `/skill-name` for
> step-by-step workflows. The `skill-eval.sh` UserPromptSubmit hook nudges skill
> loading when prompt keywords match.

## Available Skills (Procedures)

| Skill                                                       | Purpose                                                                        | Invoke With               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| [tzurot-git-workflow](./tzurot-git-workflow/SKILL.md)       | Commit, PR, rebase, release procedures                                         | `/tzurot-git-workflow`    |
| [tzurot-deployment](./tzurot-deployment/SKILL.md)           | Railway deployment & troubleshooting                                           | `/tzurot-deployment`      |
| [tzurot-docs](./tzurot-docs/SKILL.md)                       | Session start/end, CURRENT.md workflow                                         | `/tzurot-docs`            |
| [tzurot-db-vector](./tzurot-db-vector/SKILL.md)             | Prisma migrations, drift fixes, pgvector                                       | `/tzurot-db-vector`       |
| [tzurot-testing](./tzurot-testing/SKILL.md)                 | Test execution, coverage audits, tier verification                             | `/tzurot-testing`         |
| [tzurot-council-mcp](./tzurot-council-mcp/SKILL.md)         | Multi-perspective AI consultation                                              | `/tzurot-council-mcp`     |
| [tzurot-doc-audit](./tzurot-doc-audit/SKILL.md)             | Documentation freshness audit (memory audit: `harness:doc-audit`)              | `/tzurot-doc-audit`       |
| [tzurot-arch-audit](./tzurot-arch-audit/SKILL.md)           | Architecture health audit                                                      | `/tzurot-arch-audit`      |
| [tzurot-bug-remediation](./tzurot-bug-remediation/SKILL.md) | Recurring-bug protocol: evidence → class sweep → guard                         | `/tzurot-bug-remediation` |
| [tzurot-reuse-scout](./tzurot-reuse-scout/SKILL.md)         | Pre-write reuse scouting, drifted-duplicate consolidation                      | `/tzurot-reuse-scout`     |
| [tzurot-review-response](./tzurot-review-response/SKILL.md) | PR review-response: edit-shape triage, auto-apply vs ASK                       | `/tzurot-review-response` |
| [tzurot-design-boulder](./tzurot-design-boulder/SKILL.md)   | Grounded, council-reviewed design sessions → ACCEPTED artifact                 | `/tzurot-design-boulder`  |
| [tzurot-session-mining](./tzurot-session-mining/SKILL.md)   | Mine session logs in two lenses (owner friction + agent record) → dispositions | `/tzurot-session-mining`  |
| [tzurot-orchestration](./tzurot-orchestration/SKILL.md)     | Delegation posture, worker spec template, full-diff review gate                | `/tzurot-orchestration`   |
| [tzurot-usage-audit](./tzurot-usage-audit/SKILL.md)         | Weekly plan-usage measurement: weighted tokens, delegation ratio, drift ledger | `/tzurot-usage-audit`     |

## Rules (Auto-Loaded)

The following rules load at session start, except the `paths:`-scoped ones (03, 04, 08 — they load when a matching file is touched):

| Rule                      | Content                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `00-critical.md`          | Security, git safety, testing                                                                            |
| `01-architecture.md`      | Service boundaries, where code belongs                                                                   |
| `02-code-standards.md`    | ESLint limits, TypeScript, testing patterns                                                              |
| `03-database.md`          | Prisma, pgvector, caching (paths-scoped)                                                                 |
| `04-discord.md`           | 3-second deferral, slash commands, component routing, shared utilities (paths-scoped)                    |
| `05-tooling.md`           | CLI reference, commit standards                                                                          |
| `06-backlog.md`           | Backlog structure, session workflow                                                                      |
| `07-documentation.md`     | Doc placement, naming, lifecycle                                                                         |
| `08-tooling-internals.md` | Xray, mutation/test-audit/CPD ratchets, guards + probes, backlog lint, model-call routing (paths-scoped) |
| `09-interaction-style.md` | Session interaction style                                                                                |
| `10-working-posture.md`   | How to drive a session                                                                                   |

## Common Workflows

**New Feature**: rules load → `/tzurot-reuse-scout` before new logic → code → `/tzurot-testing` → `/tzurot-git-workflow`

**Bug Fix**: fix → `/tzurot-testing` → `/tzurot-git-workflow` (recurring bug? → `/tzurot-bug-remediation`)

**Database Changes**: `/tzurot-db-vector` → `/tzurot-testing` → `/tzurot-git-workflow`

**Deploy Issue**: `/tzurot-deployment` → check logs

**Big Design**: `/tzurot-design-boulder` (grounding → council → ACCEPTED artifact)

**PR Review Lands**: `/tzurot-review-response` FIRST (edit-shape triage) → apply → batch-present the four sections

**Session End**: `/tzurot-docs` → update CURRENT.md

**Audits**: `/tzurot-doc-audit` (docs + memory) · `/tzurot-arch-audit` (boundaries + health) · `/tzurot-session-mining` (owner friction + agent-side misses and keepers → structural dispositions) · `/tzurot-usage-audit` (plan spend + delegation ratio)
