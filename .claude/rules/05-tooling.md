# Tooling Reference

## Essential Commands

Beyond `CLAUDE.md` § Commands: `pnpm lint` / `pnpm lint:errors` (errors only),
`pnpm depcruise` (architecture boundaries), `pnpm knip` (unused
code/exports/deps), `pnpm knip:dead` (files only imported by their own tests),
and `pnpm focus:lint` / `pnpm focus:test` (changed packages only).

**Two local gate caches are shaped for correctness, not speed.** `pnpm
depcruise` runs **uncached** by design — its content cache reported stale
results in both directions, so `.dependency-cruiser.cjs` carries no `cache`
block; don't add one back. `turbo run lint` hashes the root `eslint.config.js`
through `$TURBO_ROOT$`, so an ESLint **rule** change invalidates every lint
task; the custom rule sources under `packages/tooling/src/eslint/` reach the
hash via the `@tzurot/tooling#build` dependency and need no entry of their own.

### After a branch switch, and stale dist

- **After every branch switch in the main tree**, run `pnpm --filter "./packages/**" build` (~1 min) before any gate, not just common-types. Alternating the checkout between two PR branches leaves `clients`/`conversation-history` dist built from the other branch (symptoms: 155 bot-client files failing `Cannot find package '@tzurot/common-types/schemas/api/<file>'`, ai-worker typecheck missing an export). After ANY common-types edit, `pnpm --filter @tzurot/common-types build` before dependent tests. A new constant read from stale dist is `undefined`, so `size >= undefined` silently no-ops while the suite stays green; assert new limits through the constant, never a hardcoded copy.
- **Schema-divergent branches:** the generated Prisma client (`packages/common-types/src/generated/prisma/`) keeps whichever branch last ran `prisma generate`. Symptoms: component tests failing `The column X does not exist in the current database`, or TS2353 unknown-property errors. After switching: `npx prisma generate && cd packages/common-types && pnpm build`.
- **Hooks read dist, not src.** The pre-commit `codegen:routes` regenerates route clients from BUILT `packages/clients` dist, so a transferred diff that adds a route commits generated `user-client.ts`/`mounts.ts` WITHOUT it, silently. Before committing a transferred diff touching `packages/clients/src/routes/**`: `pnpm --filter @tzurot/clients build`, `pnpm ops codegen:routes`, and compare the route count to the orchestrator's report. In reverse, a pre-push on another branch rebuilds `clients` without this branch's route, and the api-gateway conformance test (`ROUTE_MANIFEST` from dist) fails with "no matching manifest route" until `clients` is rebuilt.
- **Stale dist despite clean-first builds** (dist `.d.ts` shows an old signature while `src/` is right; tsc no-ops via tsbuildinfo): purge cache, dist and tsbuildinfo TOGETHER, then rebuild. Partial remedies each failed.
  ```bash
  safe-clean .turbo                   # turbo 2 caches only here; safe-clean refuses anything but known cache names
  pnpm --filter @tzurot/<pkg> build   # clean-first: the build script removes dist and tsbuildinfo itself
  ```
  Worktrees share the main tree's turbo cache, and a restored `tooling#build` artifact can lack `dist/eslint/` (`ERR_MODULE_NOT_FOUND …/tooling/dist/eslint/index.js`). `--force` isn't durable across commits, so for a worktree that will push more than once: `safe-clean <main>/.turbo <wt>/packages/tooling/.turbo` then `npx turbo run build --filter=@tzurot/tooling --force` (the tooling build is clean-first, so its dist and tsbuildinfo go with it). Package builds stay clean-first (`rm -rf dist tsconfig.tsbuildinfo && tsc`; TASK-489).

## Resource Constraints (CRITICAL)

The Deck (~14 GB RAM) OOM-kills the IDE and Claude Code under heavy commands.

- **At most ONE gate-running unit at a time, across agents:** one live worktree dispatch OR main-tree gates, never both. Pre-staging the next unit means writing specs, not dispatching. Each bare worktree is a full `pnpm install` + build.
- **Commit before any heavy command.**
- Never run heavy commands in parallel (`pnpm test`, `test:component`, `quality`, `typecheck`). Never run `pnpm test:int` locally; CI is its gate.
- Run heavy gates in the FOREGROUND, in ≤10-minute chunks; background runs get killed by the harness memory stop.
- **`pnpm quality`:** first warm lint with `npx turbo run lint --concurrency=1 --output-logs=errors-only`, then `LOW_RESOURCE_MODE=1 NODE_OPTIONS=--max-old-space-size=3072 pnpm quality`. The 3072 heap cap is mandatory; `knip` is the second OOM site and the lint warm-up doesn't protect it. If the chain still dies, run it in four sequential pieces with the cap exported: (1) lint, format:check, both `codegen:*` `--check`, topology:check; (2) knip; (3) knip:dead, cpd, `ops cpd:check`, `ops test:audit`, depcruise; (4) typecheck, typecheck:spec, backlog:lint and the `guard:*` commands. Read `package.json` `scripts.quality` for the current composition, and say plainly in the report that the pieces were run rather than implying the one command passed.
- **Full test suite:** after one watchdog kill of `pnpm test`/`test:low-mem`, go straight to the per-package loop: `for p in common-types api-gateway ai-worker bot-client tooling; do pnpm --filter @tzurot/$p test -- --maxWorkers=2; done`. Cap workers with `--maxWorkers=2`, never `--poolOptions.forks.maxForks` (vitest's CAC rejects it). Root `pnpm test` runs through the resource-profile wrapper (`packages/tooling/src/resource/exec.ts`), which resolves `low` on the Deck and caps turbo concurrency and vitest workers; `pnpm test:low-mem` pins the low profile (`docs/reference/tooling/resource-profiles.md`).
- **Pre-push first-attempt flake** (bare `husky - pre-push script failed (code 1)`): retry once; if it persists, set `LOW_RESOURCE_MODE=1` in `.env`. The ai-worker full-run flake isn't cured by it: run `pnpm --filter @tzurot/ai-worker test` alone, and if green, rerun the full suite once.
- **Capture exit codes directly:** `cmd > log 2>&1; echo EXIT=$?`, never `| tee log; echo $?` (that reports tee's status), and send full-run output to a file so the failing test name survives.
- **Before blaming the agents for a lockup,** read `journalctl -k -o cat` and rank the OOM dump's `[pid]` rows by rss+swapents×4KB, and ask what else was open. The last measured lockup was a browser at a 7.6 GB peak with zero node processes in the dump.

## Ops CLI (`pnpm ops`)

**Every command, with its flags and examples:
[`OPS_CLI_REFERENCE.md`](../../docs/reference/tooling/OPS_CLI_REFERENCE.md).**
`pnpm ops guard:ops-doc` fails CI when a registered command has no row there,
so the reference cannot lag the CLI. This section keeps only the
decision-point triggers — when to reach for a command, and what never to do
with one. The tooling-internals commands — Xray, the mutation / test-audit /
CPD ratchets, guards and hook probes, backlog lint, audit-tool infrastructure,
model-call routing — live in `08-tooling-internals.md`; which paths load it is
that file's `paths:` frontmatter.

### GitHub (Use instead of broken `gh pr edit`)

`gh pr edit` is broken — use `pnpm ops gh:pr-edit`. The three read commands
(`gh:pr-info`, `gh:pr-reviews`, `gh:pr-comments`) are the review-fetch step of
§ PR Monitoring below, and `pnpm ops gh:ci-gate` is its wait step.

### Secret Rotation

Never rotate `API_KEY_ENCRYPTION_KEY` by hand-replacing the variable — always
the staged command, `pnpm ops secrets:rotate-byok --env prod --stage 1|2|3`
(stage, reencrypt, finalize; dual-key window in
`common-types/utils/encryption.ts`). Intervals: BYOK 180d, others 365d; a
daily bot-client check nags the owner channel when one lapses.

Rotating any other shared service secret is `pnpm ops secrets:rotate-env
--env <env> --name <KEY>`, never the dashboard. For a name whose verifier
dual-accepts `<KEY>_PREVIOUS` (`INTERNAL_SERVICE_SECRET`) `--stage 1|2|3` is
REQUIRED; stage semantics and the single-shot 401 window:
`OPS_CLI_REFERENCE.md` § Secrets Commands.

### Security Advisories

`pnpm ops security:advisories` classifies each open Dependabot advisory from
the resolved lockfile tree: **direct** (Dependabot auto-PRs the fix),
**transitive**, or **direct+transitive** (declarations patched, a vulnerable
copy still resolves) — the last two never get a Dependabot PR and need a manual
`pnpm.overrides` bump. **Decision-point trigger:** the release
security-preflight (`/tzurot-git-workflow` § Release) — ride any transitive or
direct+transitive advisory that has a fix into the release via an override.

### Gate and count traps

- A unit that adds a column or a job type lists the api-gateway component tier (sync column guard) and `pnpm --filter @tzurot/tooling build` (job-type topology map, and tooling's only tsc pass) among its gates. A text-pinned SQL string needs a live dev dry run before the PR opens.
- `release:range` counts dependency groups and root-config chores as runtime; hand counts that exclude them under-read the backstop trigger.
- Classify runtime commits with a POSITIVE path pattern: `^(services/|packages/(common-types|identity|clients|embeddings|cache-invalidation|config-resolver|conversation-history)/|prisma/)`. A negative-exclusion regex once reported 0 runtime commits for a release that shipped nine.
- `git status --porcelain` quotes any path with a space (every tracker filename), so whole-tree counts use `-z`. A line-oriented grep for import consumers is blind to multi-line imports; positive-control it.
- Design-doc prose describing code outlives the code change by about one merge. Sweep it at the close-out of the PR that changed the mechanism.

## Git Workflow

**Procedures**: See `/tzurot-git-workflow` skill for commit, PR, rebase, and release procedures.

### Commit Message Format

`type(scope): subject`, a body saying what and why, then the generated-with line and the `Co-Authored-By:` trailer (the heredoc template: `/tzurot-git-workflow` § 2. Create Commit).

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `debug` (+ standard `build`, `ci`, `revert`, `style`; every valid type is also a valid branch prefix)
**Scopes:** every `packages/` + `services/` directory name (generated), plus `tests` and the static root set — `backlog`, `ci`, `deps`, `docs`, `hooks`, `husky`, `legal`, `prisma`, `repo`, `rules`, `skills`. Source of truth is `allScopes` in `commitlint.config.cjs`; read it rather than trusting a list here.

**Commitlint gotchas** (the hook catches these, but every trip costs a retry): the **full header must be ≤100 chars** (`header-max-length` — the most-tripped rule in practice; count before writing a long subject), the subject must start **lowercase** (`subject-case`), and the scope must be in the configured enum **or omitted entirely** — an unknown scope is rejected, no scope is fine.

#### The `debug` type

`debug` = temporary diagnostic instrumentation in a production path, added to
confirm a bug's runtime behaviour and removed in a cleanup PR — use it for BOTH
the add and the remove. Permanent observability is `feat`: the distinction is
lifecycle. `git log --grep '^debug[:(]' origin/develop..HEAD` surfaces
instrumentation still live on a branch (empty = clean); `pnpm ops
dev:stale-debug` (weekly `ops health`) catches older forgotten scaffolding.

When a `fix`/`feat` commit removes a probe instead of a dedicated `debug:`
remove commit, it carries the trailer `Retires-debug: <sha>` (one SHA per line)
so `dev:stale-debug` stops tracking it. Git parses trailers from the FINAL
paragraph only, so the line goes beside `Co-Authored-By`, below the
generated-with line (probe: `git log -1 --format=%B | git interpret-trailers
--parse`).

### PR Monitoring (automatic — do not wait to be asked)

**Whenever you create a PR or push commits to an open PR, arm a `Monitor` that waits for CI to finish and then reports on new reviewer comments.** Don't wait for the user to ask whether CI passed or whether a review landed. Verify the push landed first (the `-> branch` ref-update line, or `git status -sb` in-sync) — a monitor on a push that never landed reports a stale run as fresh.

**One monitor per PR: `TaskStop` this PR's previous monitor before arming a
new one** (a release PR alongside a feature PR keeps one each) — the reporting
half is not SHA-pinned, so a stale watcher reports current state under an older
push's label. **If the id is gone** (compaction): `TaskList` cannot enumerate
monitors, so `TaskStop` the `task-id` carried by the next event that fires for
a PR already reported at this SHA.

Arm the Monitor with this as its `command`, **substitution included** — copy it verbatim and only replace `N` with the PR number; never transcribe the SHA by hand:

```bash
pnpm -C "$(git rev-parse --show-toplevel)" ops gh:ci-gate N --sha $(git rev-parse HEAD)
```

Pass `timeout_ms: 1800000` (30 min) and `persistent: false`. **The `false` is a deliberate departure from the Monitor tool's own guidance — don't "correct" it back**: `TaskList` cannot see a watcher, so its own timeout is the only thing bounding it. If it expires, re-arm. **Arm it immediately, from the checkout that holds the branch** — the substitution resolves when the Monitor executes, and a branch hop or a foreign shell cwd resolves a different `HEAD`. **Wait on the gate (`gh:ci-gate`), never on a `sleep` or a hand-written poll loop** — both were measured emitting a premature `CI_COMPLETE` (outcome table: `pr-monitoring.md` § Outcomes).

**This invocation is duplicated in three places on purpose** — here, the hook heredoc, and `/tzurot-git-workflow`. `pnpm ops guard:monitor-command` fails CI if the copies diverge, so change all three.

**When the monitor fires**, read WHICH sentinel printed before anything else — only `CI_COMPLETE` means CI finished. Then, in order:

- Every other outcome (timeout, startup failure: `gh run rerun` first, missing review run, the Monitor's own timeout) means re-arm or re-query; the full outcome table is in [`pr-monitoring.md`](../../docs/reference/tooling/pr-monitoring.md). A bare `exit 1` from the Monitor script can be cosmetic — `fixup-check` is red on purpose on fixup branches — so read the event stream for the sentinel rather than assuming failure.
- Fetch new reviewer feedback from all three read commands above and report CI pass/fail and findings in one message; apply feedback via `/tzurot-review-response` — and read every `###` section of a review body, not only its Summary.
- Run the SHA-pinned run-list query before reporting green (`pr-monitoring.md` § Outcomes): a run that dies before dispatch creates zero check-runs, so a green `gh pr checks` list alone is not proof CI ran. A green review run with no new `claude[bot]` body means the action completed but posted nothing — `gh run rerun <run-id>`.
- CI failures and new CodeQL alerts surface via `PushNotification`.
- Numbers and enumerations in the PR body and commit bodies are re-derived against the head REF, never the working tree.

## No Standalone Scripts

**All tooling lives in `packages/tooling/`** as TypeScript, never as bash
scripts. New dev tool: `src/dev/<name>.ts` + colocated test + registration
in `src/commands/dev.ts` (+ a root `package.json` shortcut if frequent).
**Exception:** `scripts/` may hold one-off migration/codegen scripts that run
once and are deleted.

## References

`packages/tooling/README.md` (full tooling guide), `docs/reference/tooling/OPS_CLI_REFERENCE.md`, `docs/reference/STATIC_ANALYSIS.md`, `docs/reference/RAILWAY_CLI_REFERENCE.md`, `docs/reference/GITHUB_CLI_REFERENCE.md`, `docs/reference/tooling/pr-monitoring.md` (gate reasoning + fire-time procedure).
