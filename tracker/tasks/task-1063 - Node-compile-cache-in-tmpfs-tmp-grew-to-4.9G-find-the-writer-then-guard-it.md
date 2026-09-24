---
id: TASK-1063
title: 'Node compile cache in tmpfs /tmp grew to 4.9G: find the writer, then guard it'
status: Done
assignee: []
created_date: '2026-09-23 22:44'
updated_date: '2026-09-24 02:19'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1057000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-23 /tmp/node-compile-cache (tmpfs, RAM-backed on the Steam Deck) held 4.9G / ~700k files after 13 days uptime, pushing the machine into swap (another session found it and deleted it with owner approval). Three subdirs v24.11.1-x64-<hash>-1000, the largest 3.7G / 518k files. WebStorm-bundled pnpm (~/.config/JetBrains/WebStorm2026.1/node/versions/24.11.1/lib/node_modules/pnpm/bin/pnpm.cjs line 18) calls require(module).enableCompileCache() with no dir, so Node defaults to os.tmpdir().
Measured, not assumed (2026-09-23): pnpm exec children do NOT inherit it (NODE_COMPILE_CACHE unset in the child, module.getCompileCacheDir() undefined); a pnpm exec vitest run, and two pnpm ops runs, added 0 files (cache stayed at 2 files, ~880K each = the pnpm bundle, cached once). vitest dist mentions enableCompileCache only as a passthrough on its Module shim (chunks/vm.*.js), not a call. So the ~700k-file writer is NOT identified; tzurot commands measured so far do not grow it. Candidates to test: long-running node processes outside the repo commands (WebStorm-bundled node tooling, pnpm dev / tsx watch loops, dev servers).
Update (same day): after deletion the ef5a0af0 dir regrew to 580 files, 578 of them written within the single minute 18:44 local, so the writer is bursty and short-lived, not a daemon trickle. Isolated one at a time and measured +0: tracker task view, pnpm ops lines:check, pnpm backlog:lint, npx lint-staged --help, pnpm exec vitest run, pnpm ops --help, and a develop/feature branch switch (30s poll). npx prettier added +2 (npm bundle). Also ruled out: tsx@4.23.13 (no enableCompileCache in dist), Claude Code (native binary), env propagation (NODE_COMPILE_CACHE absent from a running tsx child). Not yet isolated from that minute: pre-push guard:env-example, dev:deferred-refs and guard:workflow-sync; the gh:ci-gate final phase (PR #2492 reached CI_COMPLETE about then); the sibling session itself. A watcher is running: script ~/.local/bin/compile-cache-watch, log ~/.cache/compile-cache-watch.log (8h from 18:48 on 2026-09-23); it logs the count delta plus the processes that exited in the prior ~3s, since Node writes the cache at process exit. Read that log first.
WRITER FOUND (same evening, sibling session's watcher; verified by reading the file): ESLint 10.10.0. node_modules/.pnpm/eslint@10.10.0_jiti@2.7.0/node_modules/eslint/bin/eslint.js calls `mod.enableCompileCache?.()` at startup (no dir argument, so os.tmpdir() unless NODE_COMPILE_CACHE is set). Bursts of +2,831 and +2,618 files landed as lint-staged eslint --fix and turbo lint processes exited; every commit touching .ts and every lint run adds a burst, and nothing evicts old entries. Machine-level fix applied by the owner-approved env cleanup: NODE_COMPILE_CACHE=$HOME/.cache/node-compile-cache in the shell profile (disk, not tmpfs) plus a deck-doctor prune above 2 GB. Remaining repo-side question: after the switch, verify ESLint's argument-less enableCompileCache() writes to the NODE_COMPILE_CACHE path (run one lint, check both dirs); if it does, the repo needs no change (keeping the speedup) and this task closes; if not, set NODE_DISABLE_COMPILE_CACHE=1 in the lint-staged and lint scripts.
Fix shape: (1) identify the writer: sample `find /tmp/node-compile-cache -type f | wc -l` per subdir over a normal working session and correlate growth with what ran (or inotifywait on the dir); (2) guard regardless of source: a check in pnpm ops health (or a doctor command) that warns when /tmp/node-compile-cache exceeds a threshold (e.g. 500M or 50k files) and names the prune command; (3) once the writer is known, either pin NODE_COMPILE_CACHE to a disk path for that process or set NODE_DISABLE_COMPILE_CACHE=1 there.
Acceptance: the writer is named with evidence; a health check warns past the threshold and is exercised against a synthetic oversized dir; the chosen pin/disable is applied where the writer runs.
CLOSED 2026-09-23 on the remaining-question criterion above. After the session restart NODE_COMPILE_CACHE=/home/deck/.cache/node-compile-cache was set; one `npx eslint packages/common-types/src/constants/ai.ts` run grew that dir 6.2M -> 24M (new subdir v24.21.0-x64-964aae3f-1000) while /tmp/node-compile-cache stayed at 164M (`du -sh` before and after). So ESLint's argument-less enableCompileCache() honours the env pin and the repo needs no change. The threshold guard is the machine-level deck-doctor prune above 2 GB (outside the repo, not exercised in this check). The 164M left in /tmp predates the pin and clears at reboot.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-24 01:24
---
REOPENED 2026-09-24: the close was wrong. It rested on one direct npx eslint run, which never goes through turbo. turbo 2.10.13 runs tasks in strict env mode (turbo.json declares only CI and NODE_ENV per task, no envMode or passThroughEnv), which strips NODE_COMPILE_CACHE, so ESLint under turbo run lint still writes to os.tmpdir(). Measured: with /tmp/node-compile-cache moved aside, npx turbo run lint --filter=@tzurot/identity --force recreated it with 2840 files; the same run with --env-mode=loose created nothing. Diagnosis first raised by the gh-rclone-mise-migration session (the dir reappeared at 20:54 local and reached 30 MB by 21:09). Fix: add globalPassThroughEnv NODE_COMPILE_CACHE at the top level of turbo.json (pass-through reaches tasks without entering the cache hash; CI leaves it unset, so no-op there). Acceptance: the same forced turbo lint writes to the NODE_COMPILE_CACHE dir and leaves /tmp untouched.
---
created: 2026-09-24 02:20
---
DONE 2026-09-24: PR #2495 (3eff99203) added globalPassThroughEnv NODE_COMPILE_CACHE to turbo.json. Acceptance met, measured through turbo this time: with /tmp/node-compile-cache moved aside, the same forced turbo lint left it absent; with NODE_COMPILE_CACHE pointed at a fresh scratch dir the run wrote 3,382 files there (positive control); a full turbo run lint --concurrency=1 (13 tasks run) also left /tmp absent. CI 22/22 green.
---
created: 2026-09-24 02:25
---
CORRECTION 2026-09-24: ESLint is not the only writer. TypeScript also calls it: node_modules/typescript/lib/tsc.js lines 3-5 run require("node:module").enableCompileCache() with no directory. The pass-through in #2495 is global, so it covers tsc under turbo too (a tsc-through-turbo probe is pending: run it after the concurrent worker finishes). Observed after the merge: /tmp/node-compile-cache reappeared with 1,598 files, all written in minute 22:21 local, while a worktree dispatch cut from 35f43e917 (before #2495, its turbo.json has no globalPassThroughEnv) ran its turbo typecheck gates. Likely cause, not caught at the process level: worktrees on a pre-fix base keep writing to /tmp until they are rebased past 3eff99203.
---
<!-- COMMENTS:END -->
