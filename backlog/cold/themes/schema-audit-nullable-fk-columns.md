### Theme: Schema Audit for Nullable-That-Isn't FK Columns

_Focus: find other schema concessions like the Phase 5b `default_persona_id` nullability that was a code-convention workaround, not a real application state._

Phase 5b's NOT NULL fix revealed a pattern: `users.default_persona_id` was nullable at the DB level not because `null` was a meaningful application state, but because one code path (`getOrCreateUserShell`) was inconvenient to fix properly. Similar concessions likely exist elsewhere — this epic has found three load-bearing workaround patterns (`discord:XXXX` dual-tier, shell-user, null `default_persona_id`) in ~6 months of v3 development, suggesting more are hiding.

**Audit recipe**: (a) grep `prisma/schema.prisma` for `?` (optional) on FK columns and columns that are "always set" in application logic — for each, ask "can this actually be null in production, or is the app enforcing non-null via convention?"; (b) grep for default-value-that-never-applies patterns (columns with `@default` that callers always override); (c) grep Prisma `findUnique` / `findFirst` callers for `?.fieldName ?? fallback` patterns where `fallback` is never actually used in production; (d) grep for wide union types in TypeScript (`string | null`, `string | undefined`, domain enums widened to `string`) that the app narrows at runtime.

**Why it matters**: every schema concession is a place where a future refactor can silently re-introduce a bug class — the 5b class was the persona-snowflake bug that shipped undetected for 4 months.

**Why out of scope of Identity Epic**: audit doesn't have a single unifying theme — it's a discovery pass that will spawn multiple independent fix PRs. Best done as its own mini-epic after Phase 6 integration tests land (so we can lean on those tests when tightening invariants).

**Start**: `prisma/schema.prisma` — enumerate every `?` on non-timestamp columns, cross-reference with `.findUnique` usage sites to identify which nullable values are never null at rest.

**Audit run 2026-05-21**: discovery pass executed. Phase 5b had already eliminated the largest class of nullable-that-isn't (the original `default_persona_id` case + the shell-user pattern). Remaining findings filed to `backlog/cold/follow-ups.md` are narrow: (1) stale doc claim in `syncTables.ts:246` calling `default_llm_config_id` NOT NULL when it's actually nullable; (2) opportunity to tighten `users.default_llm_config_id` + `default_tts_config_id` to NOT NULL post-Phase-5b (no bug today, dead-code removal in resolvers). The bulk of the optional columns (description fields, error messages, voice/avatar data, override columns, state-machine columns like ExportJob.fileContent) are genuinely optional — null carries meaningful application state. Theme stays open for opportunistic future findings.
