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
- **Lesson for any retry:** verify placement before trusting it. The remote agent's first action should report `hostname`, `nproc`, `free -g`, and whether its cwd is under `/home/deck`. The spec should say: if local, stop and report rather than run gates.
- **Next:** find out whether remote isolation needs enabling on the account (web/cloud setup, the gating the tool description mentions), rather than retrying blind.

## Pilot

One ordinary `state:ready` backlog unit, dispatched remotely, with the local gates skipped:
- If the remote gates pass, and the pushed diff reads cleanly in the driver's full-diff review, fold contract points 1–3 into `/tzurot-orchestration` as a third mode beside the worktree mode.
- If (a) or (b) fails, record it here and close the idea as blocked on the platform, not on merit.
