# Documentation Standards

## Three-Layer System

| Layer     | Directory         | Purpose              | Loaded    |
| --------- | ----------------- | -------------------- | --------- |
| Rules     | `.claude/rules/`  | Constraints ("what") | Always    |
| Skills    | `.claude/skills/` | Procedures ("how")   | On invoke |
| Reference | `docs/`           | Rationale ("why")    | On read   |

Each layer points down. No upward references. No duplicated content.

**A note on Claude auto-memory**: there is also a per-Claude-instance, machine-local memory store at `~/.claude/projects/*tzurot*/memory/` that accumulates knowledge across sessions. It is **not** a fourth durable layer — it's volatile, not git-tracked, and visible only to one Claude instance. Use it for per-user context, working preferences, and time-bound state. Anything that should be visible to every developer or apply to every session belongs in one of the three layers above. Placement criteria and migration triggers live in the `/tzurot-doc-audit` skill (Section 0).

## Where to Put New Docs

| Doc Type              | Location                                    | When                                                                                        |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Constraint/standard   | `.claude/rules/`                            | Enforced during all work                                                                    |
| Procedure/workflow    | `.claude/skills/`                           | Step-by-step how-tos                                                                        |
| Architecture decision | `docs/reference/architecture/`              | After implementation                                                                        |
| Caching design        | `docs/reference/caching/`                   | Cache patterns, pub/sub                                                                     |
| Database reference    | `docs/reference/database/`                  | Schema, drift, Prisma                                                                       |
| Deployment procedure  | `docs/reference/deployment/`                | Railway, production                                                                         |
| Feature docs          | `docs/reference/features/`                  | User-facing behavior                                                                        |
| Developer guide       | `docs/reference/guides/`                    | How-tos for common tasks                                                                    |
| Operations runbook    | `docs/reference/operations/`                | Maintenance, backups                                                                        |
| Coding standard       | `docs/reference/standards/`                 | Patterns to follow                                                                          |
| Templates             | `docs/reference/templates/`                 | Reusable doc scaffolding                                                                    |
| Test procedure        | `docs/reference/testing/`                   | Manual test plans, setup                                                                    |
| Tooling reference     | `docs/reference/tooling/`                   | CLI, ops commands                                                                           |
| Future idea           | `docs/proposals/backlog/`                   | Good idea, not scheduled                                                                    |
| Post-mortem           | `docs/incidents/`                           | After incident resolution                                                                   |
| Research note         | `docs/research/`                            | Distilled AI insights                                                                       |
| Steam Deck setup      | `docs/steam-deck/`                          | Dev environment guides                                                                      |
| Work tracking         | `CURRENT.md`, `BACKLOG.md` + `backlog/*.md` | Root-level, always visible. `BACKLOG.md` is the index; per-section files live in `backlog/` |
| Per-Claude memory     | `~/.claude/projects/*tzurot*/memory/`       | Per-user context, preferences, time-bound state (not git-tracked)                           |

## Naming Conventions

- `UPPERCASE_WITH_UNDERSCORES.md` for major documents
- `lowercase-with-dashes.md` for specific topics
- Be descriptive: `memory-and-context-redesign.md` not `memory.md`
- No dates in filenames (use git history or frontmatter)

## Lifecycle Rules

- **Completed proposals** -- verify feature is documented in `reference/`, then delete
- **Raw AI transcripts** -- distill to `docs/research/` (2-5KB TL;DR), then delete raw
- **Abandoned plans** -- delete (git preserves history)
- **Build process docs** -- delete after shipping (document the feature, not the process)
- **Diverged planning docs** -- delete when implementation took a meaningfully different shape than what the doc describes; the code is the source of truth. Test: would a reader following this doc end up confused about what currently exists?

## Reference Root Files

These live directly in `docs/reference/` (not in a subdirectory):

| File                          | Contents                              |
| ----------------------------- | ------------------------------------- |
| `DOCUMENTATION_PHILOSOPHY.md` | Full rationale and decision flowchart |
| `STATIC_ANALYSIS.md`          | dependency-cruiser, knip, cpd         |
| `GITHUB_CLI_REFERENCE.md`     | gh CLI patterns                       |
| `RAILWAY_CLI_REFERENCE.md`    | Railway CLI patterns                  |
| `REASONING_MODEL_FORMATS.md`  | LLM reasoning output formats          |
| `v2-patterns-reference.md`    | Legacy v2 patterns                    |

## Related

- Full rationale and decision flowchart: `docs/reference/DOCUMENTATION_PHILOSOPHY.md`
- Audit procedure: `/tzurot-doc-audit` skill
- Session workflow: `/tzurot-docs` skill
