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

- Constraint/standard → `.claude/rules/` — **only if it applies repo-wide**; one service's conventions go in that service's `CLAUDE.md`
- Service-scoped standard → `services/<name>/CLAUDE.md` (loads only when working under that directory, e.g. `services/voice-engine/CLAUDE.md`)
- Procedure/workflow → `.claude/skills/` (step-by-step how-tos)
- Living intent (LLD + EARS specs) → `docs/intent/<segment>/` (per-segment design + `@spec`-linked requirements; pilot: memory-archive)
- Under `docs/reference/`: architecture decisions (after implementation) → `architecture/`; cache patterns, pub/sub → `caching/`; schema, drift, Prisma → `database/`; Railway, production → `deployment/`; user-facing behavior → `features/`; how-tos for common tasks → `guides/`; maintenance, backups → `operations/`; patterns to follow → `standards/`; reusable doc scaffolding → `templates/`; manual test plans, setup → `testing/`; CLI, ops commands → `tooling/`
- The user-facing slash-command list → `docs/commands.md`
- Future idea (good, not scheduled) → `docs/proposals/backlog/`
- Post-mortem (after resolution) → `docs/incidents/`
- Research note (distilled AI insights **with a public audience** — see "Audience check" below) → `docs/research/`
- Local working notes without a public audience → `docs/local/` (gitignored)
- Steam Deck dev-environment guides → `docs/steam-deck/`
- Work tracking → root `CURRENT.md` and `BACKLOG.md` (the load manifest), curated files under `backlog/**/*.md`, the small-item pool in `tracker/` (query via `pnpm tracker`)
- Per-Claude memory → `~/.claude/projects/*tzurot*/memory/` (per-user context, preferences, time-bound state; not git-tracked)

## Audience check (public repo)

This is a public repository, so document placement is also an **audience decision**. Before committing any research, analysis, or notes document, ask: who is the audience? Material written for users or contributors is a tracked doc; working material written for the operator — internal analyses, decision notes, drafts of legal or business documents — belongs in `docs/local/` (gitignored, machine-local). This is the ordinary distinction any organization draws between internal notes and published documentation.

Two corollaries: tracked surfaces (commit messages, PR bodies, backlog entries) reference tracked documents only, and the public record describes **outcomes** (the shipped policy, the fix, the decision's effect) rather than internal deliberation. When in doubt, start the document in `docs/local/` — promoting a local note to a tracked doc later is one copy; the reverse is a history rewrite.

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
- **Post-mortems** -- an entry is _incident (≤3 lines) → operationalization shipped (rule/hook/guard link)_. The point of a post-mortem is not the narrative but what got operationalized in its wake; narrative beyond that is deleted (git preserves it). An entry with no operationalization outcome is a red flag to fix, not a keepsake.
- **Rules/skills carry constraints, not archaeology** -- a rule states the constraint plus at most a one-sentence why; multi-paragraph incident stories, adoption dates, and council-derivation notes don't belong in always-loaded surfaces. The operationalized outcome IS the record.

## Command Blocks Are Code

A command block in a rule, skill, or reference doc is code that a future session runs verbatim. It ships only after it has been executed in the state it is written for, including the failure or edge state it exists to detect, not only the ordinary one. The prose beside it records what that run observed, not what the author expected. Reading cannot substitute for running, because the reader brings the same model of the command that the author used when writing it. An example commit message, branch name, or config snippet counts as a command too: run it through the hook or validator that will judge it. This is the documentation form of the execute-before-trust rules in `00-critical.md` (the end-to-end dev exercise for ops tooling, and the probe before an external-system claim).

## Reference Root Files

Files that live directly in `docs/reference/` (not in a subdirectory) are indexed in `docs/README.md`.

## Related

- Full rationale and decision flowchart: `docs/reference/DOCUMENTATION_PHILOSOPHY.md`
- Audit procedure: `/tzurot-doc-audit` skill
- Session workflow: `/tzurot-docs` skill
