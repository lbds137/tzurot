## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

_(2026-09-21: the vxreddit Components-V2 entry REMOVED — fix #2461 verified on dev by the owner smoke, Emily described the art; prod verification is the same check after beta.228. The entry's capture, probe and PR history live on TASK-1024 and in git.)_



- 🐛 `[FIX]` **Vision chain terminates on a router `content_policy` refusal, so the Qwen tail is never reached** (owner report 2026-09-12; log-verified on the current prod ai-worker deployment: 67 vision invocations in ~11.7 h, ZERO on `qwen/qwen3.5-397b-a17b`; two sensitive images walked glm-flash `provider_content_refused` → advance → `openrouter/auto` `content_policy` → "terminate category, image itself rejected", then negative-cached so two re-asks terminated without a call). Mechanism: `VISION_TERMINATE_CATEGORIES` holds `content_policy` and `censored`, treating a provider's refusal as image-intrinsic, against TASK-747's recorded evidence that lower tiers describe what an upstream filter refused. **TASK-937 (high, S). Owner ruling 2026-09-12: both refusal kinds advance; only `media_not_found` stays terminal.** **Fix MERGED as #2399 (develop `3abdc6ad6`, 2026-09-12; ships with beta.223)**: the terminate set is `media_not_found` only, pinned by the invariant tests, single-hop advance tests for both refusal kinds, the three-hop prod walk, and a real-Redis test where a cached `content_policy` entry on tier 1 advances to a fresh tier-2 call. The two prod images already negative-cached at the router advance on their next ask without a flush (the cache is per model). TASK-899 (a less-filtered tail model) stays separate. **Runtime-UNVERIFIED until the deploy** — remove this entry when a prod log shows a qwen invocation following an auto-router `content_policy` advance (TASK-937 stays open as `state:observable` for that clause).

- **Runtime-unverified fixes and parked incidents moved to `state:observable` tracker tasks (2026-09-13 context-budget trim)**: TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.


---



### 🚢 Next Release — beta.232 (theme: the drain continues, plus the undecodable-audio reply; caching Phase 3 and doc-107 stay gated)

_beta.231 CUT 2026-09-25 23:53Z (19:53 EDT), a fix-forward train. **The numbers:** 8 PRs, 3 runtime, 68 files, no migrations; release PR #2543; `main` = `develop` = `f06f7cc30` after `release:finalize` (a normal rebase-merge this time; 35 commits). **Why now:** the owner's prod smoke of the beta.229 Vencord voice path failed on voice-engine (libsndfile rejected the stream-copied Ogg's jittered granule positions); the fix #2542 transcodes instead. Owner ruling: cut right after #2542 merges; TASK-1074 rides beta.232. **Contents:** #2542 (the transcode), #2538 (settings custom-id guard), #2537/#2539 (prompt-tags scanner), #2534, #2536/#2540, #2541. **The second look:** one holistic claude-review body, no blocking findings; its one note (a docs-only section in REASONING_MODEL_FORMATS.md not in the notes) needs nothing. **Preflight:** no advisories, no deletion-safety findings, no dependabot PRs. **Deploy watch:** the prod re-smoke of the no-key Vencord path is the one open confirmation (the container ffmpeg's `asetpts`/`libopus` premise); a `WebM-to-Ogg transcode failed` warn in ai-worker is the failure signal._

- **Driver**: Fable drove the beta.230 cut; the drain continues under whichever driver the owner picks (Opus 5.5 at medium for mechanical days, Fable for theme days). Owner decisions carried (binding):
  - the memory-archive flips stay per character on their gates;
  - TASK-1038's promotion stays automatic and atomic across its three writes (the owner's 2026-09-21 ruling on TASK-1037 still governs);
  - TASK-1027 is the owner's call;
  - no model-parameter experiments;
  - the owner clears sessions with `/clear`, so every handoff lives on disk.
- **In**: (empty at the cut; grows as PRs merge).
- **Waiting on**:
  1. **TASK-1074, the undecodable-audio reply** (owner ruling 2026-09-25: rides this train) — voice-engine answers 415/422 for a body its decoder cannot read, ai-worker maps it to a distinct non-retryable reason, bot-client renders a could-not-read-this-format reply instead of the outage message. size:M, three services, one PR.
  2. **The beta.231 prod re-smoke** (owner, `CURRENT.md` § beta.229 item 1): one no-key Vencord voice message on prod. Closes TASK-1069; not a cut blocker.
  3. **TASK-1070's dev check** (owner smoke, `CURRENT.md` § beta.230 item 1): one TTS reply and one no-key transcription in dev on the Python 3.13 voice-engine. Not a cut blocker; it closes the task.
  4. **The doc-61 economy pass**, due 2026-10-02.
  5. Owner call carried: N back to 10 on Emily and Lilith after the TASK-1039 read (recommended; numbers on TASK-1039).
- **Watches (agent-run, no owner action)**:
  - beta.230's: the first forwarded message with images and the first cross-channel quoted reply on prod (#2528, #2529, read the prompt block); the first mid-stream send failure on prod (#2530, the persisted row carries the delivered chunks and the owner alert dedups on the partial's cause frames); the next nightly db-sync run on the new build (the 07Z slot);
  - carried: the same-channel `summarized` register on Emily and lilith on prod; TASK-937, TASK-991/992's runtime clause, the doc-17 caching reading, TASK-901, the Emily pre-warm gate (TASK-971), and the `/inspect` masked-link render (#2259).
- **🧑‍💻 Owner to-do**: (1) the beta.230 smoke in `CURRENT.md`: the TASK-1070 dev check (item 1) and the settings-dashboard walk on prod (item 2: page index, Reset page, Reset all); (2) the beta.231 prod re-smoke of the Vencord/Vesktop voice path with no STT key (`CURRENT.md` § beta.229 item 1; the 2026-09-25 prod run passed on Mistral and failed on voice-engine, #2542 is the fix; TASK-1069 closes on the pass); (3) the TASK-1039 second read day at N=3; (4) TASK-907: review the commitment facts with `/memory facts character:<Emily> tag:commitment:promise` and note any welcomed pet name NOT extracted (TASK-950); (5) TASK-1027's call: strip look-alike brackets by Unicode category (recommended, fails safe) or accept the pass-through; (6) TASK-960's call: keep the multi-tag fan-out parallel (recommended) or serialize it; (7) TASK-961's call: keep `/history clear` as a context boundary (recommended) or make a soft clear forget too; (8) TASK-104: trim and re-upload the 8 over-cap voice references, then `pnpm ops voice-refs:audit --env prod`; (9) leisure, unchanged: card-level examples for Emily; the voice-harness blind review. (The `doc-83` un-park was decided 2026-09-25: the Spacebar spike is TASK-1108 in Current Focus.)
- **Explicitly NOT in**: the memory-archive flips themselves (settings, not code — TASK-1038 automates the write, the gate still decides) · browse/UI (`doc-14` waves 4–6, incl. the `/shapes export` UX row) · `doc-86` · TASK-906/TASK-910 residue unless a prompt-version bump is planned · the vitest 5 bump (TASK-913 watches) · further lookahead on the strip matchers (TASK-921/923, TASK-1012) · TASK-933 · the agentic `/memory remember` (the agentic proposal owns it) · a digest prompt-version bump (nothing observed warrants one) · TASK-1026 until a seventh header label appears · caching Phase 3 until the doc-17 reading arrives · `doc-107` (the archive/digest consolidation) until the same-channel mode settles the digest shape.
- **Deploy notes**:
  - No migrations pending at the write.
  - The `summarized` same-channel mode is live on prod for Emily and lilith-tzel-shani from beta.229 (owner ruling at that cut). It is reversible live from the dashboard; a prod edit syncs back to dev by last-write-wins.
  - `hook-posix-parse` is a main-required check from 2026-09-25; any rename of that job is the two-step change in `.github/rulesets/README.md`.
  - Keep ranges small enough for a normal `gh pr merge --rebase`: beta.229 (166 commits) and beta.230 (117 commits) both needed the fast-forward fallback, so the threshold is below 117 commits, not the ~200 the skill cites. The always-loaded line budget on `CURRENT.md` is checked by CI's lint job on the release PR but NOT by a code-bearing pre-push (TASK-1101 is the classifier gap); run `pnpm ops lines:check` before opening the release PR.
  - The digest sweep on prod runs only for the listed pairs (spend ceiling = listed pairs × ≤12/day, D8) — TASK-1038's promotion widens that list automatically, so its spend line is part of its spec; retention is live and autonomous from beta.222 (kill switch: `RETENTION_AUTORUN_ENABLED=false` on bot-client); the reminder DM (beta.223) forms its first prod cohort on or after 2026-10-04. Prod ops writes under auto mode: `release:premigrate` and `db:safe-migrate` are `autoMode.soft_deny` at user scope by design; `release:premigrate` also carries a `permissions.ask` rule, so it prompts (forwarded to the phone) instead of reaching the classifier.
- **Cut when**: TASK-1074 has merged (the theme item), or the standing backstops fire first (~10 runtime PRs and ~250 files); `release:range` at the 2026-09-25 cut: 0 PRs.
- **🗺️ Horizon (rolling three releases, re-touched at every cut)**:
  - **beta.232**: this block.
  - **beta.233**:
    - caching Phase 3, if the doc-17 reading arrives;
    - `doc-107`, once the digest shape settles;
    - the UX-epic slice (`doc-14` waves 4–6);
    - slice C's dead-row report (TASK-971);
    - the TASK-802 escaping sweep, which now includes the edit-dashboard name sites;
    - TASK-1112 if the owner answers yes (audio-only plain uploads transcribed without the voice flag).
  - **Backlog slope (measured at the beta.231 cut from the tracker's `created_date`/`updated_date`, window 2026-09-25 11:05 → 19:53 local, the beta.230 → beta.231 span)**: filed 10, closed 7, open 367 (`status: To Do`). A one-day window on a filing-heavy day; re-measure at the beta.232 cut over its full span before reading a trend.
### 🎯 Current Focus (max 3)

**🐛 `[FIX]` Character voice drift in long conversations — `doc-97` (owner intake 2026-09-05, HIGH; the beta.219 opener and the re-entry into `doc-8`)** — a character's replies no longer match its card after months of use. Measured from prod memories on 2026-09-05 (aggregates only, read-only one-off script stored under `docs/local/handoffs/`, copied into `scripts/analysis/` to run): the card register faded through spring and collapsed in August 2026 — exclamation marks per 1k chars 1.3–3.8 (winter) → 0.7–1.0 (Apr–Jul) → 0.06 (Aug) → 0.01 (Sep); a courtroom vocabulary absent through July appears in August and doubles in September; average reply length 830 → 1,652 chars. Mechanism: the card sits ~45k tokens upstream behind the cache prefix while ~43k tokens of the character's own prose (cross-channel history + memory archive, which stores replies verbatim) sit at the generation point. Phase 1 (the `voice_anchor` V-tier section) shipped in beta.219 (#2348), and every build phase of the memory-archive design (`doc-8`) is on main behind switches that ship OFF; what remains is Phase 2 (the owner-applied directive) and the owner-run rollout in `CURRENT.md`. Owner rulings 2026-09-05: anchor before caching Phase 2, LID starts at the design pass. Evidence, handoff, and payload under `docs/local/handoffs/` (gitignored).

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

**🔎 `[FEAT]` Spacebar fork — `doc-83` (owner ruling 2026-09-25: fork Spacebar; TASK-1108 spike DONE the same day, both parts on `doc-83`)** — the fork lives in its own private repo and its own driver session (Deck management sets both up; not this board's work). What stays on THIS board: the Tzurot-side host override the fork needs before bot-client can point at an instance (the Client's `rest` option, `utils/deployCommands.ts`'s bare `new REST()`, the hard-coded CDN hosts in `discordCdnGuard.ts` and ai-worker's `attachmentFetch.ts`), gated behind config so Discord stays the default; the Fermo client check is on the owner queue. The fork's first milestone is the nine-patch list on `doc-83`, with the callback-route token check landing before any instance is reachable by others.

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(2026-09-16: the Dependabot batch + claude-workflow main-cut entry SHIPPED in beta.225 — `claude-code-action@v1.0.222` on both `main` and `develop`, #2424 merged, #2425/#2426 superseded by #2430/#2431; the `adm-zip` alerts cleared with beta.227 — TASK-947 CLOSED 2026-09-21. Quick Wins is empty.)_



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic. 2026-08-23: the slash-chat-mirrors-tagging directive routed to idea doc `doc-82` — Untriaged is empty.)_

