---
id: doc-108
title: 'Idea: Cloud nested dispatch (local driver, remote orchestrator+worker)'
type: other
created_date: '2026-09-23 22:58'
---

Status: proposed 2026-09-23 (owner request relayed by a sibling session). **Owner approved a pilot the same day** ("piloting makes sense … the essentially single threaded development model slows down work a lot"). Pilot unit: TASK-1059. **Owner ruling 2026-09-24 (AskUserQuestion, "Fix, then adopt"):** the routine pilot passed.
1. Fix TASK-1073 first (husky hooks under `sh`/dash).
2. Then fold the routine-based cloud mode into `/tzurot-orchestration` as a third dispatch mode. It allows at most one cloud unit alongside one local unit, and only for units that need no `.env` or local DB.
3. Routines bill the plan limits, not the $250 credit, and the owner accepted the higher weekly burn that comes with the extra throughput.

## Why

The Steam Deck caps the drain at one gate-running unit at a time (`reference_steamdeck_resource_limits` memory; `05-tooling.md` § Resource Constraints), and its RAM is shared with the owner's desktop load. On 2026-09-23 a tmpfs `/tmp/node-compile-cache` also reached 4.9 GB (TASK-1063). Moving installs, builds and gates off the Deck would allow more than one unit in flight and would stop dispatches competing with the IDE for memory.

## Shape

- **Driver stays local, one of it.** Fable (or the Opus backup) picks units, writes specs, does `.env`, local DB and migration work in the main tree (already the rule in `/tzurot-orchestration` § Nested dispatch), and reads every unit's FULL diff. That diff read, plus CI and claude-review, is the only review gate: the owner does not read code. Any variant must keep it. One driver, not N cloud drivers: N drivers multiply the scarcest budget and turn one independent diff read into N self-reviews.
- **Orchestrator + worker go remote**, one cloud VM per unit (Ubuntu 24.04, 4 vCPU / 16 GB, per the Claude Code on the web docs), via the same Agent call with `isolation: "remote"` instead of `"worktree"`. All installs, builds and gates run there.

## Contract points that change (they assume a shared filesystem)

1. **Deliverable.** "No commits, branches or pushes; a dirty worktree" becomes "push a branch". The driver reads the diff from the remote (`git fetch` + `git diff <base>..origin/<branch>`) instead of `worktree:transfer`.
2. **Base.** "A LOCAL-only commit is a valid base" breaks, because the cloud clones GitHub. The base, including any migration-precursor commit, must be pushed before dispatch.
3. **Environment.** The bare-worktree `pnpm install` plus per-package build moves into a cloud setup script: install Node 24 (the image defaults to 22), then pnpm install and build. The setup script runs as root and must finish in about 5 minutes; its disk state is cached for 7 days.
4. **`.env` and DB work** stays on the driver, unchanged.

## Unverified — pilot must answer

- (a) `isolation: "remote"` is described as gated; is it enabled on this account?
- (b) Does a remote Agent call honour `model: "opus"` / `"sonnet"`?
- (c) Do `pnpm test`, the contract tier and `pnpm quality` pass there? Expect `pnpm test` to need no live Postgres: the component tier uses PGLite. The pilot should confirm that and the network allowlist (npm, GitHub, anything else the gates fetch). Local-only hook assumptions also need checking: `~/.local/bin` wrappers, distrobox, WebStorm node paths.
- (d) How does the remote agent's report and branch come back to the parent? Cloud sessions cannot SendMessage; an Agent-spawned remote subagent should return its result to the parent.
- (e) Budget: parallel cloud units draw from the same 5h and weekly limits, so parallelism raises the burn rate. Remote orchestrators on Opus bill the non-binding bucket; the local Fable driver stays single.

## Pilot result so far (2026-09-23, TASK-1059)

- **(a) FAILED silently.** An Agent call with `isolation: "remote"` launched without error. The run landed in a LOCAL worktree (`.claude/worktrees/agent-<id>`, registered in `git worktree list` on the pilot branch), and its processes (turbo, vitest, tsc) ran on the Deck. The completion notification's `worktreePath` field was the only tell; nothing at launch said it fell back. It ran full-repo gates concurrently with a local pre-push hook: the concurrency the one-gate rule forbids. The driver told it mid-run to drop to package-scoped gates.
- **The unit itself shipped** (PR #2493, merged 2026-09-23): the diff read cleanly and passed the driver's full-repo gates, so the orchestration contract (push a branch, driver reads the remote diff) worked even though placement did not.
- **Budget update (sibling session, 2026-09-23):** cloud sessions went GA that day and the owner claimed a one-time $250 cloud-session credit. Cloud sessions draw from it FIRST, with plan limits applying only after it is spent or expires (2:59 AM EST 2026-11-05); it is NOT eligible for Projects or Routines. Unverified: whether an Agent `isolation: "remote"` spawn counts as a plain cloud session for the credit. This makes (e) moot until November and makes a re-test cheap. The next attempt should start a plain cloud session (`claude --cloud` or the web) on one unit, since the Agent-tool path is the one that fell back.
- **Lesson for any retry:** verify placement before trusting it. The remote agent's first action should report `hostname`, `nproc`, `free -g`, and whether its cwd is under `/home/deck`. The spec should say: if local, stop and report rather than run gates.
- **Next:** find out whether remote isolation needs enabling on the account (web/cloud setup, the gating the tool description mentions), rather than retrying blind.

## Re-test 2026-09-23 evening (Claude Code 2.1.281)

Owner steer: the pilot must exercise the REAL path, a local session spawning cloud work itself; a hand-opened cloud session only proves cloud sessions exist.
- **(a) failed again, reproducibly.** A placement-only Agent call (`isolation: "remote"`, `model: "sonnet"`) reported `uname -n` = steamdeck, 14Gi RAM, 8 cores, cwd `/home/deck/Projects/tzurot/.claude/worktrees/agent-<id>`. There was again no launch error and no notice. Two of two remote spawns landed locally.
- **The CLI spawn path is closed to an agent.** From the Bash tool, `claude --cloud "<task>"` exits 1: "--cloud requires an interactive terminal. Non-interactive invocations (piped stdout, --init-only, --sdk-url) run locally and would silently ignore --cloud." It refuses rather than falling back.
- **ListAgents showed no cloud section** with zero cloud sessions running. That empty result cannot tell "no cloud access" from "none running".
- **Why (a) fails: remote isolation is absent from the build, not gated per account.** In the 2.1.281 binary the only functional `isolation==="remote"` check is in the Workflow tool, and it throws "agent({isolation:'remote'}) is not available in this build". The Agent tool has no remote branch, so the value falls through to a local worktree (the other matches are progress/UI rendering, including a `remote ${remoteSessionId}` label for a future build). No account setting can enable it; only a later release can. The docs (code.claude.com sub-agents page) list only `worktree`.
- **RemoteTrigger is a working programmatic spawn path WITH a return channel.** Actions `create` + `run` start a routine run now; `list_runs` + `get_run_log` let the local driver read the run's log and final result, which is better than SendMessage to a cloud session (one-way: cloud sessions cannot message back, per the cross-session messaging docs).
- Remaining programmatic spawn path: routines (`/schedule`, the RemoteTrigger tool), which the $250 credit does not cover. So they bill the plan, the same budget a local nested dispatch already bills. Remaining semi-manual path: the owner opens an idle cloud session in a real terminal or the web, and the local driver dispatches to it with SendMessage; results come back as a pushed branch, since cloud sessions cannot message back.

## Routine pilot 2026-09-23 (owner: "probe, then one unit", plan-billed)

- **Placement probe PASSED.** A one-shot routine created by the local session ran in "Default (Trusted)" (`env_011CUR2aSkNzZj7jpJ2CoCrY`): hostname `vm`, 4 CPUs, 15Gi RAM, no swap, kernel 6.18.44-fc (Firecracker), root, cwd `/home/user/tzurot`. It finished in 18 s, and `get_run_log` returned its final message to the driver. It had Node v22.22.2, pnpm 10.30.3, Python 3.11.15; npm registry and api.github.com both answered HTTP 200; the repo's `.claude` hooks fired (19 hook events) without trouble. No setup script is configured on the environment.
- **Mechanics a spec must carry:**
  - The clone checks out the DEFAULT branch (`main`), so step 0 switches to `develop`.
  - Node 24 must be installed in step 0. The unit run installed it and reported v24.21.0.
  - Every `create` auto-attaches ALL the account's claude.ai connectors (Gmail, Drive, Calendar, PayPal, Claude_Code_Remote), even with `"mcp_connections": []`, so each create is followed by `update` with `clear_mcp_connections: true`, before `run_once_at`.
  - `run_once_at` must be in the future (2–3 min out works). The run starts about 1 min after it.
- **Unit run: TASK-1055**, Opus 5.5 orchestrator allowed one Sonnet worker, gates run in the cloud, deliverable a pushed `feat/task-1055-single-flight-sync`, and no PR (the driver opens it). It ran concurrently with the Deck's local gates for another PR, the first time two gate-running units were in flight at once.
  - **Result: the unit worked end to end.** The run ended `result: success` (40 turns) at 02:41 UTC, about 91 min after the routine was created (01:09:55 UTC), including provisioning and the slow split edits. It pushed `feat/task-1055-single-flight-sync` (97b77366b), its push log reading "All pre-push checks passed!" from the repo's own pre-push hook in the VM, and reported its four gates green and four canaries red-as-designed (the driver did not re-run them). The driver read the full diff (clean; every TASK-1055 acceptance clause pinned by a test), traced the one runtime premise (the 409 `code` field, producer to consumer), added a one-line comment fix, pushed through the Deck's own pre-push hook (43/43 and 25/25 turbo tasks green), and opened PR #2497. **Merged 2026-09-24 (`b39cf533d`) after six claude-review rounds, with CI green on every push.** Rounds 2–5 ran locally as ordinary worktree dispatches. What they found:
    - round 2: a missing startup-trigger test, and an owner ruling on the smoke 409 ("distinct note");
    - round 3: one real design gap. Dry runs took the guard, so a dry-run preview could make the nightly sync skip the day;
    - round 4: unlogged 503s and a missing dry-run-without-Redis test;
    - round 5: test isolation;
    - round 6: nothing blocking.
  
  That is the same shape as a comparable local unit: #2488 took five rounds. So the review load says nothing against the cloud mode. The dry-run gap was a spec omission, and the spec was written on the Deck.
  - **Frictions a cloud-mode spec must pre-empt:** (1) Node 24: `npm i -g node@24` failed with EEXIST on `/opt/node22/bin/node`, so the run repointed that binary at a node 24 install under `/root/node24`; an environment setup script should install Node 24 cleanly. (2) A `~/.bashrc` PATH edit was denied by the VM's auto-mode classifier as "Unauthorized Persistence" and reverted; the spec should say to set PATH per command, not persistently. (3) `.husky/pre-commit` uses a bash-only here-string while husky runs hooks under `sh`, which is dash in the VM; the run put a PATH-scoped sh-to-bash shim in front of git so every hook check still ran. Filed as TASK-1073. (4) The posture-gate edit splitting above. (5) The VM sets no locale (`LANG` and `LC_ALL` empty), so the board-commit-branch-gate probe's non-breaking-space cases failed inside `pnpm quality` until the run re-ran under `LC_ALL=C.UTF-8`. The spec should export `LC_ALL=C.UTF-8` for every gate command (run log, 2026-09-24 02:30Z). (6) The component tier needs a REAL Redis on localhost:6379 (`packages/test-utils/src/setup-pglite.ts`: no mock; it throws "Test Redis is unreachable"), while its Postgres is in-process PGLite. The run had a live Redis (it swept DBs 0–15 with `redis-cli`), then deleted a `dump.rdb` from the repo root. That suggests it started `redis-server` from the repo directory; inferred, since the start is on a log page not read. Step 0 should start it daemonized with `--dir` outside the repo. The real-Postgres integration tier (`*.integration.test.ts`) is not a cloud gate, and stays CI's, as it is on the Deck.
  - **Driver-side observation:** the owner saw the run's completion push notification on the phone but could not find the session again. The routine page lists every run; the driver should relay the session link when a run finishes.
  - Mid-run wrinkle, from the run log: in a routine the cloud orchestrator IS its session's main loop, so `dispatch-posture-gate.sh` applies to it. Instead of handing edits to the Sonnet worker, it made them itself, split into ≤5-line Edit calls after the hook blocked 6- and 8-line ones. That complies with the letter of the hook (its message offers splitting), but it is slow and fragments the edits. For the cloud mode in `/tzurot-orchestration`, the spec should say plainly that the orchestrator delegates ALL src edits to its worker.

## Billing and limits (2026-09-24)

- **The routine pilots billed the weekly plan, not the credit.** The owner's
  `/usage` screen showed the one-time cloud credit untouched ("$250 of $250
  left", expires 2026-11-05). The credit dialog reads: "It applies
  automatically to cloud sessions. Not eligible for Projects and Routines."
  Every cloud unit so far ran as a Routine (RemoteTrigger), so none of them
  drew on the credit. At the time, weekly all-models stood at 81%, 4.4 days
  into the 7-day window.
- **The credit-billed launch path is `claude --cloud "<prompt>"`, run under a
  pseudo-TTY.** The owner's meter showed the probe session below billed $3 to
  the credit. The CLI refuses a non-TTY call ("--cloud requires an interactive
  terminal"), so the driver wraps it:
  `script -qfec '<script that runs claude --cloud "$(cat prompt.md)">' /dev/null`.
  It prints "Created cloud session", then a `claude --teleport <id>` line,
  and exits. The driver reads the run with RemoteTrigger `get_run_log` on
  that id; the log truncates long final messages, so a unit's report must
  put its key results in its tool output or keep the final message short.
  The Agent tool's `isolation: "remote"` is NOT a cloud path: on 2026-09-24
  it ran the agent in a local worktree on the Deck, as it had on 09-23.
- **After the credit (2026-11-05 expiry, or used up):** the docs do not
  say. Routines "draw down subscription usage the same way interactive
  sessions do" (routines docs), so plan-limit billing is the likely
  fallback. That is an inference, not a documented fact.
- **Owner directive (2026-09-24):** every assumed cloud limitation gets
  confirmed by a probe before it constrains the mode, with a mitigation tried
  where possible.

### Capability probe results (2026-09-24, one `--cloud` session, ~20 min, $3)

The VM is Ubuntu 24.04 with 4 CPUs, 15 GiB RAM, no swap and 30 GB of disk, running as root.

| Assumed limit | Result | Mitigation |
| --- | --- | --- |
| No local DB | FALSE. PG 16.13 is preinstalled (not on PATH); `apt install postgresql-16-pgvector` gives pgvector 0.6.0 (CI's image is newer). `db:migrate` applies 137/137 with both IVFFlat indexes; `db:safe-migrate` produces only the sanitized protected-index DROPs; `test:generate-schema` works. | `db:safe-migrate` loads the full config: set `BOT_OWNER_ID`, `DISCORD_CLIENT_ID` and `GUILD_ID` to numeric placeholders in a throwaway `.env` |
| Component tier | PASS: 59 files, 780 passed, 13 skipped, 196 s | Start Redis (installed, not running) |
| Integration tier | 46/50 files pass, peak ~1.4 GB. The integration DB name must end in `_test` (a suite guard). One suite fails: the Redis clients force `family: 6`, and the VM kernel has no IPv6 | TASK-1083 (an env override for the Redis IP family); a runtime shim did not take |
| `pnpm quality` | PASS unthrottled, ~7.5 min | Needs a local `main` ref: `git fetch origin main:main` |
| Node 24 | Image ships Node 22; the nodejs.org v24 tarball into `/opt/node24` works in 4 s | Set PATH per command, not in `~/.bashrc` |
| Husky hooks | PASS natively (pre-commit and commit-msg; TASK-1073 holds) | — |
| Push | Authenticates. Pre-push demands a `type/description` branch name | Name branches per convention |
| PRs | `gh` is absent | The local driver opens the PR from the pushed branch |
| Subagents | PASS (an Explore subagent ran inside the VM) | — |
| Railway | No CLI and no token. The API host answers a POST | Owner's call: a token in the environment's secrets. Default: Railway ops and data probes stay local |

**Setup-script candidate** for the cloud environment's Setup script field (claude.ai/code → environment settings; it runs as root before the session and is cached). Reconstructed from the probe's commands and not yet run as a setup script; the first cloud unit validates it:

```bash
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
curl -fsSL https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz | tar -xJ -C /opt
ln -sfn /opt/node-v24.21.0-linux-x64 /opt/node24
apt-get update && apt-get install -y postgresql-16-pgvector
```

**Per-session step 0 for a cloud unit** (processes do not survive the cache):
- `export LC_ALL=C.UTF-8 PATH=/opt/node24/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0`
- `redis-server --daemonize yes --dir /tmp`
- start the PG 16 cluster
- `git fetch origin develop main:main`, then check out the base
- `pnpm install --frozen-lockfile`, then `pnpm --filter "./packages/**" build`

## Pilot

One ordinary `state:ready` backlog unit, dispatched remotely, with the local gates skipped:
- If the remote gates pass, and the pushed diff reads cleanly in the driver's full-diff review, fold contract points 1–3 into `/tzurot-orchestration` as a third mode beside the worktree mode.
- If (a) or (b) fails, record it here and close the idea as blocked on the platform, not on merit.
