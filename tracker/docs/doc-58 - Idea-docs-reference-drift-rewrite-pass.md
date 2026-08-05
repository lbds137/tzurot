---
id: doc-58
title: 'Idea: docs-reference drift rewrite pass'
type: other
created_date: '2026-08-03 18:27'
---

_Focus: rewrite or retire the `docs/reference/` files the 2026-08-03 drift audit found materially wrong — the ones needing real current-code knowledge, not line fixes (those shipped in the audit's sweep PR)._

**OWNER CALLS RESOLVED 2026-08-04 — the pass is now fully agent-runnable.** Delete `architecture/POSTGRES_SCHEMA.md` (schema.prisma self-documents) and `architecture/group-conversation-design.md` (diverged-planning-doc lifecycle). `operations/DATABASE_BACKUP_STRATEGY.md`: do NOT delete — move to `docs/proposals/backlog/` AND edit it there so its content matches reality (strip the fictional scripts/workflows; reframe as an honest un-started proposal for backup posture).

One PR's worth of sweeping, roughly in danger order. Per-file disposition:

- **`operations/PRISMA_PGVECTOR_REFERENCE.md`** — DANGEROUS: claims Railway auto-runs `prisma migrate deploy` in Dockerfiles (no Dockerfile does; migrations are operator-driven via `ops db:migrate` / `release:premigrate`). Whole workflow section predates the ops CLI, `drift-ignore.json`, and protected indexes. Rewrite around the real flow, or gut to a pointer at `.claude/rules/03-database.md` + `/tzurot-db-vector`.
- **`operations/ENCRYPTION_KEY_ROTATION.md`** — scripts a nonexistent `scripts/rotate-encryption-key.ts` (with `new PrismaClient()`, which throws under Prisma 7) and a nonexistent `railway service scale` command. Real path is staged `pnpm ops secrets:rotate-byok --stage 1|2|3` + `maintenance on|off`. Rewrite or delete in favor of `05-tooling.md` § Secret Rotation.
- **`architecture/POSTGRES_SCHEMA.md`** — describes `users.global_persona_id`, `user_personality_settings`, `activated_channels`; none exist (now `UserDefaultPersona` relation, `user_personality_configs`, `channel_settings`). DELETE-CANDIDATE (owner call): `prisma/schema.prisma` is self-documenting per the null-semantics rule.
- **`operations/DATABASE_BACKUP_STRATEGY.md`** — reads as a strategy in force; none of its scripts/workflows exist and every checklist box is unchecked. It is an un-started proposal. Move to `docs/proposals/backlog/` or DELETE-CANDIDATE (owner call — backup posture is an owner decision).
- **`architecture/group-conversation-design.md`** — pre-implementation plan in reference/; its schema shipped, its runtime shape diverged (`ParticipantContextCollector` etc., no `ConversationContextBuilder`). Diverged-planning-doc lifecycle says delete. DELETE-CANDIDATE (owner call).
- **`features/CHANNEL_ACTIVATION.md`** — "How It Works"/"Files Changed"/"Unit Tests" sections describe a 6-stage processor chain with three processors that do not exist; real chain is 7 stages in `composition.ts` with `PersonalityTriggerProcessor` unifying reply/activation/mentions. Rewrite those sections.
- **`standards/INTERACTION_PATTERNS.md`** — documents an `activeCollectorRegistry` module (four symbols) that exists nowhere; `paginationBuilder.ts` also gone. Delete the Registry Pattern section, repoint pagination references at `dashboard/settings/` builders.
- **`standards/DATABASE_COLUMN_GUIDELINES.md`** — the `LlmConfig` "Schema Pattern" snippet (maxMessages/maxAge/memoryLimit/memoryScoreThreshold columns) reads as live schema; those live in the config-overrides cascade now. Rewrite the example on the real cascade.
- **`operations/REDIS_MAINTENANCE.md`** — procedures cover only 2 of the 5 queues and predate `ops inspect:queue`/`inspect:dlq`. Extend. (Low.)

Related shipped context: the audit's trivial fixes (STATIC_ANALYSIS.md, OPS_CLI_REFERENCE.md rows, system-model.md counts/paths, CASCADING_CONFIG_PATTERN/TRI_STATE/COVERAGE_AUDIT/REDIS_TIMEOUT path repoints, ARCHITECTURE_DECISIONS.md historical-status header) went out in the sweep PR and are not members of this pass.
