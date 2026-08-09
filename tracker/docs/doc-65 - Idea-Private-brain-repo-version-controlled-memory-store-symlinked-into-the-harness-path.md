---
id: doc-65
title: >-
  Idea: Private brain repo - version-controlled memory store symlinked into the
  harness path
type: other
created_date: '2026-08-09 16:40'
---

_Focus: the auto-memory store is untracked and unrecoverable; move it into a PRIVATE git repo and symlink it back into the harness path, so memory gets history, off-machine backup, and auditability._

Owner directive (2026-08-09, verbatim): "not having version control on memory files is dangerous and your backup idea is right, but it is an interim solution that we can and should improve on."

### Shape

- Private repo (e.g. `claude-brain`, GitHub private) holding per-project subdirs keyed by harness slug: `tzurot/` holds what is now `~/.claude/projects/-home-deck-Projects-tzurot/memory/`.
- Move the dir into the repo, symlink from the harness path to it. The harness path lives under `~/.claude`, NOT inside any public repo — zero leak surface into Tzurot; the symlink is invisible to Tzurot's git.
- **Commit cadence is the make-or-break design point**: an uncommitted brain repo is the same fragility with extra steps. Candidates: a SessionEnd/Stop hook that auto-commits (`brain: session <date>` — deterministic trigger, mechanical correction, exactly the hook tier), or a cron. Manual commits will rot.
- Candidate additional residents, decide at build time: the mined-corpus dir (machine-local session-mining reports — currently unversioned), `docs/local/` content (per-repo gitignored), the memory backup tarballs (superseded by history once this exists).

### Cautions

- The repo MUST stay private; nothing in any public surface may reference its URL or contents (same boundary as mined-corpus in /tzurot-session-mining).
- Multi-machine sync is a feature (remote = off-machine backup) but pull/push conflict handling for memory files needs a simple rule (last-write-wins is probably fine for a single owner).
- Owner-action items: create the private repo, pick its scope (memory-only vs memory+corpus+local-docs).

### Relations

- doc-64 (meta-harness spinoff): this is the PRIVATE layer of the same split — plugin = public portable, brain = private personal. Build order is independent; brain is smaller and can go first. **Owner refinement 2026-08-09: the brain-management MECHANISMS ship in the plugin** ("the brain itself stays private but the mechanisms for setting it up and managing it would belong in the plug-in") — the setup skill, the session-end auto-commit hook, and any status commands are plugin payload; this repo holds only data. If the brain is built before the plugin exists, build those mechanisms as clearly-portable pieces destined for extraction.
- doc-62 (memory promoter): version control makes promote-and-delete auditable (the deletion commit IS the record).
- doc-63 (ratchet bidirectionality): a tracked brain could carry its own size measurement, closing the "memory is ungated" inventory row.
