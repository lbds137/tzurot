# Resource Profiles

One resolver derives every concurrency/heap knob from ONE profile with an
auto-on rule, so the paths that OOM the Deck throttle by default instead of
depending on a hand-exported flag. Implementation:
`packages/tooling/src/resource/profile.ts` (pure) + `envFile.ts` (key-scoped
.env read) + `exec.ts` (the wrapper the root scripts call) + `spawnEnv.ts`
(the shared resolve-and-layer step the wrapper and the ops runners use) and
`vitestProfile.ts` (the root vitest config's entry).

## Input precedence (first match wins)

1. `RESOURCE_PROFILE` in the process env: `low` / `cloud` / `full`
   (case-insensitive); `auto` or empty continues; anything else is rejected
   with the valid values named.
2. `LOW_RESOURCE_MODE` in the process env: `1/true/yes/on` -> low;
   `0/false/no/off` -> full (the explicit opt-out of the auto rule); empty
   continues; anything else is rejected.
3. The same two keys from the `.env` layer, same parsing. `readEnvFileValues`
   reads ONLY these keys (never the whole file into the environment) and
   falls back per key to the main checkout's `.env` for linked worktrees.
   Parsing mirrors `.husky/pre-push`'s shell reader: last line wins, CR
   stripped, inline ` #` comment and whitespace trimmed, one quote layer
   removed, empty reads as unset.
4. The auto rule — `CI` truthy (non-empty, not `false`/`0`) -> full,
   trigger `CI`; `<= 16 GiB` total memory -> low (checked BEFORE the cpu
   count, so a 4-cpu/8 GiB machine is low, not cloud); else `<= 4` cpus ->
   cloud; else full. Triggers name the measured values (memory to one
   decimal GiB). Memory is `min(os.totalmem(), process.constrainedMemory())`,
   so a container with a cgroup memory limit is judged by that limit. A CFS
   cpu quota (`docker --cpus=N`) is NOT seen: `availableParallelism()`
   follows CPU affinity only, so such a container should set
   `RESOURCE_PROFILE` explicitly.

The `<= 16 GiB` bound deliberately includes 16 GiB machines: the Deck reports
14.45 GiB and a 16 GiB laptop reports just under 16, so both resolve low.

Vitest runs read the `.env` layer inside the root `vitest.config.ts` itself
(via `vitestProfile.ts`): every run that loads that config — wrapped or not,
including a bare `vitest`, `pnpm --filter <pkg> test`, and unwrapped turbo
test tasks — anchors the key-scoped read on the config file's own directory
(never `process.cwd()`: turbo runs package tasks from the package directory),
falling back per key to the main checkout's `.env` for linked worktrees.
Unwrapped turbo runs (`dev`, a bare `turbo run ...`) still get no turbo
concurrency cap: nothing exports `TURBO_CONCURRENCY` for them.

Once a layer matches, lower layers are not consulted (or validated). An
invalid value in a consulted layer throws a `UsageError` naming the valid
values; the exec wrapper prints it and exits 2 before spawning anything, and
the ops runners (`dev:focus` and its shortcuts, `dev:test-summary`) let it reach cli.ts's
`reportUsageError`, which exits 1.

## Knob table

Exported as `PROFILE_KNOBS` in profile.ts — the single source:

| Profile | TURBO_CONCURRENCY       | VITEST_MAX_WORKERS | NODE_OPTIONS heap           |
| ------- | ----------------------- | ------------------ | --------------------------- |
| low     | 1                       | 1                  | `--max-old-space-size=3072` |
| cloud   | 2                       | 2                  | (none)                      |
| full    | (unset = turbo default) | 3                  | (none)                      |

Explicit per-knob env (`TURBO_CONCURRENCY`, `VITEST_MAX_WORKERS`, positive integers)
wins over the table. An existing `--max-old-space-size` inside NODE_OPTIONS
wins over the heap knob, which is then not exported.

## Exported env

`buildProfileEnv` returns the additions the wrapper exports on top of the
inherited environment: `RESOURCE_PROFILE=<resolved>` (children resolve identically
without re-reading .env), `VITEST_MAX_WORKERS=<n>`, `TURBO_CONCURRENCY=<n>` when the
profile sets one (turbo also reads it natively as `--concurrency`), and
`NODE_OPTIONS="<existing> --max-old-space-size=<n>"` when the low profile's
heap applies and no cap is present yet.

## Turbo repos: pass-through env is REQUIRED

turbo 2 runs tasks in strict env mode — a task process sees only what
turbo.json allows, which is why a shell-exported `LOW_RESOURCE_MODE` never reached
the previous vitest throttle (probed: the flag arrives empty while NODE_OPTIONS
arrives). Add the keys to `globalPassThroughEnv` — NOT `env`/`globalEnv`, which
would enter the task hash:

```json
"globalPassThroughEnv": ["NODE_COMPILE_CACHE", "RESOURCE_PROFILE", "LOW_RESOURCE_MODE", "VITEST_MAX_WORKERS"]
```

Pass-through keys are hash-neutral by turbo's design; probed for
`LOW_RESOURCE_MODE` on `@tzurot/identity#test` (turbo 2.11.13), whose task hash
was identical with the key set and unset. `TURBO_CONCURRENCY` is also read
natively by turbo (`--concurrency`); an invalid value is a turbo flag error,
which doubles as a positive control that the key is live.

## CI behaviour

CI sets `CI=true`, so the auto rule resolves full and the wrapper exports
`VITEST_MAX_WORKERS=3` with no concurrency/heap additions — CI behaviour is
unchanged. CI's coverage step runs `pnpm turbo run test:coverage` unwrapped and
still resolves full: `CI` reaches the vitest process under an unwrapped turbo
run (driver-probed), and the root config resolves from it.
`STRYKER_CONCURRENCY` is not a profile knob and is never touched. Different CI
numbers: export the explicit knob env, which wins over the table.

## Commands

`pnpm ops resource:env` prints the resolved profile + eval-able exports
(`--format json` for the structured form) for consumers that cannot route
through the wrapper. Root scripts `build`, `lint`, `lint:errors`, `test`,
`test:coverage`, `test:failures`, `lint:fix`, `typecheck`, `typecheck:spec`,
`knip` run through the wrapper; `quality` inherits the wrapping through those
scripts. `test:low-mem` pins `RESOURCE_PROFILE=low` through the wrapper, so its
heap is the low profile's 3072 — one value, per TASK-1066. The `focus:*`
scripts (`dev:lint`, `dev:test`, `dev:focus build`, `dev:typecheck`, all through
focus-runner.ts) and `test:summary` (`dev:test-summary`) resolve the profile
in-process, with the same inputs as the wrapper (including the key-scoped .env
read), and hand the additions to their turbo spawn. `dev` stays unwrapped on purpose:
its persistent tasks must all run at once, so a concurrency cap below their
count is wrong for it. `pnpm ops resource:env` and those ops runners run after
`cli.ts` has loaded the whole `.env` into process.env, so they resolve against
a pre-dotenv snapshot of the profile and knob keys (`RESOURCE_PROFILE`,
`LOW_RESOURCE_MODE`, `TURBO_CONCURRENCY`, `VITEST_MAX_WORKERS`, `NODE_OPTIONS`;
`resource/preDotenvEnv.ts`): a shell-exported value still outranks `.env`, as
in § Input precedence. The wrapper reads only the two profile keys from `.env`.

An unrecognised `LOW_RESOURCE_MODE` or `RESOURCE_PROFILE` value is a
`UsageError` at vitest config load (every vitest run), whereas
`.husky/pre-push`'s shell reader still treats any non-empty, non-off value as
on until slice 2 moves the hook onto the resolver.

## Later slices

Stryker concurrency and the pre-push migration to the wrapper are later
slices of TASK-1553; this PR ships the resolver, the wrapper and the turbo
pass-through.

Until the pre-push migrates, `.husky/pre-push` reads only `LOW_RESOURCE_MODE`
and auto-throttles at <= 4 cpus. So on a <= 4-cpu machine with more than
16 GiB the hook resolves low while a bare `pnpm test` resolves cloud, and
`RESOURCE_PROFILE` in `.env` does not affect the hook.

`.husky/pre-push` also exports `CI=true` before its turbo run, so an unflagged
hook run resolves `full` in the vitest config today. Slice 2 must resolve the
profile before that export (or keep `CI` out of the resolver's input).
