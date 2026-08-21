---
id: TASK-598
title: >-
  Pre-push should rebuild tooling dist when eslint plugin entry is missing in a
  worktree
status: To Do
assignee: []
created_date: '2026-08-14 00:40'
updated_date: '2026-08-14 12:18'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 598000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in a git worktree, the shared turbo cache restores an artifact set that lacks packages/tooling/dist/eslint/index.js, which the ROOT eslint.config.js imports. The pre-push hook then fails with ERR_MODULE_NOT_FOUND on that path, and the push is rejected after the full turbo run has already executed.

The failure is confusing because it names an eslint module error rather than a build problem, so the first read is "my lint is broken" rather than "my dist is incomplete". A pnpm-filter build does NOT reliably fix it - only `npx turbo run build --force --filter @tzurot/tooling` sticks.

RECURRENCE (this is why the priority moved to high for a size:S fix): 2 hits on 2026-08-13, then 3 more on 2026-08-14 across both active worktrees - 5 push cycles lost, each costing a rejected push plus a ~27s forced rebuild.

Sharper mechanism, measured 2026-08-14: the clobber is caused by the PRE-PUSH TURBO RUN ITSELF, not by some earlier unrelated restore. A direct `pnpm --filter @tzurot/tooling lint` succeeded minutes before each failure - so dist was complete at that point - and the pre-push turbo invocation then restored the incomplete cached artifact over it and immediately linted against the result. That means a "rebuild once at the start of the session" workaround cannot hold, and the check has to sit INSIDE the hook after any turbo step that can restore.

Fix shape: in .husky/pre-push, after the turbo build/lint step is set up but before eslint runs, test for packages/tooling/dist/eslint/index.js and run the forced tooling build when it is absent. Guard it on absence so the normal main-checkout path pays nothing. Emit one line naming WHY it is rebuilding, so the next person sees a build message instead of a module-resolution stack trace.

Acceptance: pushing from a worktree whose cache restore lacked the eslint dist succeeds without a manual rebuild; the main checkout path is unchanged and adds no measurable time. Probe the hook per the after-editing-any-hook rule.

MECHANISM CORRECTED — live repro captured on hit 6 (PR 2101 push). The premise above is WRONG in a way that changes the fix. dist is not INCOMPLETE in the worktree, it is ENTIRELY ABSENT: `ls packages/tooling/dist/` returned "No such file or directory" while the same turbo run reported `Tasks: 4 successful, 7 total / Cached: 4 cached, 7 total` — so turbo counted build as a cache HIT and put nothing on disk. The main checkout had a complete dist at the same moment. Turbo also printed "Remote caching disabled, using shared worktree cache".

So there is no poisoned or partial cache artifact to detect, and the outputs declaration is fine — root turbo.json declares `outputs: ["dist/**"]` for build, and dist/eslint/index.js is ordinary tsc output from src/eslint/. Checked both, neither is the bug.

HYPOTHESIS A (weakened by hit 7): the shared cache is keyed such that turbo believes the outputs are already materialized because they exist in the MAIN checkout, so it reports a hit and skips the restore into the worktree. Weakened because hit 7 occurred with dist present in the worktree beforehand — it was not a skipped restore into an empty tree, it was a REMOVAL.

HYPOTHESIS B (leading, from hit 7): the cache entry itself is empty for some build hashes, and a turbo restore CLEARS the output directory before extracting, so restoring an empty entry deletes dist rather than filling it. Hit 7 is the discriminating observation: lint-staged ran `eslint --fix` successfully during the commit (which loads eslint.config.js, which imports dist/eslint/index.js — so dist existed), then a rebase and a turbo run later, dist was gone with build reported cached. Something actively removed it, and the only actor touching build outputs is turbo. Editing src produces a new hash, which is why a --force that fixes one hash does not protect the next push.

Discriminating test for B: pick a build hash, note the cache entry, inspect turbo cache contents for that hash (the shared cache lives at the MAIN repo root, not node_modules/.cache/turbo — verified absent there), and confirm whether the archive is empty. If B holds, the fix is cache hygiene plus possibly turbo config, and the hook guard is a workaround, not the fix.

RECURRENCE: 7 hits over three days. Hits 6 and 7 were in the same PR (2101), both after a rebase.

FIX SHAPE, REVISED: a presence check for packages/tooling/dist/eslint/index.js is still the right guard, but the trigger is "no dist at all after a reported cache hit", and it must run AFTER the turbo invocation that reports the hit. Note .husky/pre-push:146 runs `build lint test` in ONE invocation, so nothing can be inserted between the restore and the lint — the check either splits that invocation or wraps it as a retry-once-on-ERR_MODULE_NOT_FOUND. Prefer investigating the shared-cache hypothesis first: if turbo has a config for per-worktree output materialization, that is the real fix and the hook guard becomes unnecessary.

Note: assistant-generated tooling-friction task - counts against the session net.
HIT 8 (2026-08-20, PR 2166 worktree) — AND A THIRD MECHANISM THAT NEITHER HYPOTHESIS NAMES. Read this before running the discriminating test for B, because hit 8 is evidence AGAINST B being the whole story and points at something structural that is cheap to check.

The discriminating detail: the failing turbo run reported `Tasks: 23 successful, 38 total / Cached: 1 cached, 38 total`. Only ONE task of 38 came from cache. So on this hit there was essentially no restore to clear anything — hypothesis B (a restore wiping the output directory) cannot explain it. Builds were EXECUTING, and lint still could not find the artifact.

HYPOTHESIS C, from turbo.json rather than from cache archaeology: the lint task never declares a dependency on the build that produces the file it needs. turbo.json declares lint as dependsOn ["^build"]. The caret means the builds of a package's DEPENDENCIES — it does NOT include the package's own build. So @tzurot/tooling#lint has no ordering edge to @tzurot/tooling#build. Meanwhile the ROOT eslint.config.js line 9 is a static import of ./packages/tooling/dist/eslint/index.js, which is exactly that package's own build output. Nothing in the task graph makes the build finish first, so turbo is free to schedule lint against a dist that does not exist yet.

This is an UNDECLARED DEPENDENCY, not a cache defect. Note the same task declares eslint.config.js in lint.inputs, so the config file is tracked as an input while the artifact it imports is not expressed at all.

It also explains the pattern better than A or B: the main checkout almost always has a dist lying around from an earlier run, so the missing edge is invisible there; a worktree is where an empty-or-cleared dist actually coincides with a lint. It explains why a forced tooling build sticks only until something removes dist again, and why a session-start rebuild cannot hold — neither adds the missing edge.

STATUS: code-read, NOT runtime-confirmed. What is verified is the turbo.json declaration and the eslint.config.js import; the causal claim that this ordering produced these eight failures is inference. Cheap test: run the pre-push turbo invocation in a worktree with packages/tooling/dist removed and see whether lint is scheduled before build completes.

REVISED FIX SHAPE if C holds: add the missing edge rather than a hook guard — lint dependsOn ["^build", "@tzurot/tooling#build"] (turbo supports that explicit cross-package form). That fixes every consumer of the root config at once, needs no hook change, and costs the main checkout nothing because the build is already cached there. The hook presence-check stays a fallback worth having only if the edge turns out not to be sufficient.

HIT 9 (2026-08-20, PR 2167 worktree) — B AND C COMPOSE; THEY ARE NOT COMPETING EXPLANATIONS.

The observation that separates this hit from hit 8: a standalone `pnpm lint` PASSED in this same worktree minutes earlier, 26 of 26 tasks, with dist present. The very next turbo invocation — the pre-push `build lint test` at .husky/pre-push:146 — failed with dist/eslint/index.js missing, reporting `Cached: 22 cached, 38 total` and `@tzurot/bot-client:lint: cache miss, executing`.

So the artifact was present, one invocation later it was gone, and the difference between the two invocations is that the failing one ALSO ran build tasks and restored 22 of them from cache. Nothing else touched the tree.

That is the composition:
- C (no ordering edge) is why a lint task is free to be scheduled concurrently with the restore of @tzurot/tooling#build at all. bot-client does not depend on tooling, so `dependsOn: ["^build"]` gives bot-client:lint no edge to it whatsoever.
- B (a restore clears the output directory before extracting) is what makes that concurrency destructive rather than merely unordered. Without B a racing lint would read a stale-but-valid dist; with B it reads an emptied one.

Neither alone accounts for hit 9. C alone predicts a failure only when dist is absent beforehand — it was present. B alone predicts a failure only on a restore that clears — but the standalone lint run also had cache hits and did not fail, because it scheduled no build to race against.

This sharpens the fix rather than changing it: the explicit edge (`lint dependsOn ["^build", "@tzurot/tooling#build"]`) is still the right first move, because it removes the race window without depending on turbo's restore semantics being fixed. It is now predicted to be SUFFICIENT rather than merely necessary — if C is what admits the concurrency, closing the edge closes the window B exploits.

STATUS: still code-read plus observational inference, NOT runtime-confirmed. The discriminating test is unchanged and now cheaper to interpret: in a worktree with dist PRESENT, run the pre-push `build lint test` invocation and check whether dist disappears mid-run. If it does, B is confirmed directly, and the edge is the fix.

RECURRENCE: 9 hits. Both hits 8 and 9 came from agent worktrees on consecutive PRs (2166, 2167) — the worktree orchestration pattern makes this near-per-PR now, which is what moves it off "annoyance" and onto the drain queue.
<!-- SECTION:DESCRIPTION:END -->
