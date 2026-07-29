# Why `guard:boundaries` exists

## What it does

Scans every source file across services and packages for forbidden imports defined in `BOUNDARY_RULES`. The current rules enforce:

- `bot-client` never imports from `@prisma/client` directly (must go through `api-gateway` HTTP endpoints)
- `bot-client` never imports the runtime exports of the Prisma-backed `@tzurot/common-types` modules (currently `services/prisma` and `services/SystemSettingsService`), from **any** common-types subpath — the package's wildcard exports make each module importable at its own subpath. The authoritative set is `BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS` in `check-boundaries.ts`, and a colocated drift test asserts **set equality in both directions**: it discovers Prisma-importing modules by scanning common-types source (type-only imports are erased from built JS), enumerates their runtime exports, and fails on a stale ban entry (symbol renamed/deleted) AND on a new Prisma-backed export missing from the list — so widening the Prisma surface forces the ban decision instead of silently escaping the guard
  - **Not this rule**: the former Prisma-backed _services_ (`PersonaResolver`, `PersonalityService`, `ConversationHistoryService`, the cache invalidators) moved to dedicated packages and are banned by their own per-package **depcruise** rules. They are a different enforcement mechanism with a different failure message — look there, not here, when one of them trips
- No cross-service imports (services may only import from `@tzurot/common-types`)
- `ai-worker` internals are not exposed outside the service

The scanner matches **whole import statements**, not single lines — a multi-line `import {\n  getPrismaClient,\n} from '@tzurot/common-types'` is collapsed to one logical unit before the rule patterns run, so symbol names on their own lines are visible. (A symbol-level rule is meaningless against the older line-by-line scan, which never saw the symbols.)

Adds errors and warnings; CI fails on errors. Complementary to `pnpm depcruise` (the heavier dependency-cruiser config), but tighter and faster — runs in the lint job in under a second. **This symbol-level reach is also why guard:boundaries, not depcruise, owns the Prisma re-export rule**: dependency-cruiser matches resolved module paths, and common-types is a legitimately-shared package — a path-level rule cannot ban its Prisma-backed subpaths without banning the package wholesale, so the symbol-level guard is the enforcement layer here.

## Why it was built

The architecture rules in `.claude/rules/01-architecture.md` were getting violated at the import level despite being documented. The most common breach: a `bot-client` slash command would directly import a Prisma type or call `getPrismaClient()` rather than going through the gateway HTTP API. Once the import landed, the type was available, the runtime worked, and the violation only surfaced months later when someone tried to deploy bot-client without Prisma access.

`pnpm depcruise` catches the same class of issue, but it's slow (multi-second) and its config is a 100+ line file most contributors don't read. `guard:boundaries` is the fast first-line check: a regex-shaped boundary rule that runs in lint-time, written in ~150 lines of code that's easy to skim. Anyone adding a new boundary just adds an entry to `BOUNDARY_RULES`.

## Threshold rationale

Zero errors. Warnings are surfaced but don't fail CI — they're for soft boundaries that may be tightened later. The current rules all have `severity: 'error'` because the boundaries they enforce are load-bearing for the deployment topology.

If a rule starts producing false positives, the fix is to refine its `pattern` regex or add an exception condition — never to suppress the check wholesale.

## Decay check

When this tool's reminder fires:

- Has the service topology collapsed (e.g., merged services back into a monolith)? Delete the rules that no longer apply.
- Did `depcruise` get fast enough that two boundary checkers is redundant? Pick one.
- Are the rules producing too many warnings nobody acts on? Promote them to errors or delete them.

The tool's job is to be both small enough that a contributor can read the rule list in 30 seconds and strict enough that the architectural commitments hold. Keep it as long as both are true.
