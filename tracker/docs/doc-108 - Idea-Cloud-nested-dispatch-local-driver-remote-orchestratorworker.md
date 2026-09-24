---
id: doc-108
title: 'Idea: Cloud nested dispatch (local driver, remote orchestrator+worker)'
type: other
created_date: '2026-09-23 22:58'
---

Status: proposed 2026-09-23 (owner request relayed by a sibling session). **Owner approved a pilot the same day** ("piloting makes sense … the essentially single threaded development model slows down work a lot"). Pilot unit: TASK-1059. Skill edits still wait for the pilot's result.

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

## Pilot

One ordinary `state:ready` backlog unit, dispatched remotely, with the local gates skipped:
- If the remote gates pass, and the pushed diff reads cleanly in the driver's full-diff review, fold contract points 1–3 into `/tzurot-orchestration` as a third mode beside the worktree mode.
- If (a) or (b) fails, record it here and close the idea as blocked on the platform, not on merit.
