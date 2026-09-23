---
id: TASK-1063
title: 'Node compile cache in tmpfs /tmp grew to 4.9G: find the writer, then guard it'
status: To Do
assignee: []
created_date: '2026-09-23 22:44'
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
Fix shape: (1) identify the writer: sample `find /tmp/node-compile-cache -type f | wc -l` per subdir over a normal working session and correlate growth with what ran (or inotifywait on the dir); (2) guard regardless of source: a check in pnpm ops health (or a doctor command) that warns when /tmp/node-compile-cache exceeds a threshold (e.g. 500M or 50k files) and names the prune command; (3) once the writer is known, either pin NODE_COMPILE_CACHE to a disk path for that process or set NODE_DISABLE_COMPILE_CACHE=1 there.
Acceptance: the writer is named with evidence; a health check warns past the threshold and is exercised against a synthetic oversized dir; the chosen pin/disable is applied where the writer runs.
<!-- SECTION:DESCRIPTION:END -->
