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



### 🚢 Next Release — beta.234 (theme: open — the joint Spacebar/Machloket boot, the dependency follow-ups, and whichever horizon item matures first; caching Phase 3 and doc-107 stay gated)

_beta.233 CUT 2026-10-01 20:52Z, "the parity train". **The numbers:** 17 PRs, 12 runtime, ~200 files / 32.5k lines (62% the generated conformance snapshot), no migrations; release PR #2566 merged via the documented fast-forward fallback at 118 commits (the rebase-merge mechanical failure — threshold confirmed at/below 117); `main` = `develop` = `91ee1f9f0` (finalize a no-op on the FF path); tagged `latest`, beta.232 demoted. **Contents:** #2548 quoted/forwarded voice, #2551 card importer, #2552 filename logging, #2553 DM-worker ready-gate, #2554 instance origin, #2558 avatar path, #2560 foreign-interaction guard, #2561 redis db-index, #2562 surface inventory + drift gate, #2563 skills economy pass, #2564 fast-uri/undici overrides (clearing all 12 GitHub advisories at merge), #2565 claude-code-action main-cut (superseding #2555), #2567 CodeQL assertion fix, #2549/#2556/#2559 chores. **The second look:** two holistic claude-review bodies, both "No findings". **Preflight:** 12 advisories listed pre-merge — all resolved BY the merge (develop's lockfile carried the fixed versions; the tool reads main's tree); no deletion-safety findings. **Slope:** re-measure at the next cut (TASK-1152/1153 filed this window)._

- **Driver**: GLM-routed deputy drove the beta.233 cut end-to-end (deputy posture). Owner decisions carried (binding): the memory-archive flips stay per character on their gates; no model-parameter experiments; the owner clears sessions with `/clear`, so every handoff lives on disk.
- **In** (2026-10-04, `release:range`: 5 PRs / 3 runtime / 55 files): #2569 deepmerge-ts override (TASK-1152) · #2570 avatar root containment (F4/F7) · #2572 OpenRouter-wrapped provider refusals now retarget instead of dead-ending (TASK-1161, owner-reported prod bug) · #2568 develop-code-commit-guard override block · #2571 surface inventory fixes (TASK-1156).
- **Owner ruling 2026-10-04 — cut after TASK-1172**: land TASK-1172 (vision specimen real-shape fixture, size S, test-only), then cut beta.234 so the #2572 prod fix ships. TASK-1171 (generic guest footer note, owner-decided same day) rides beta.235. The waiting-on items below do NOT block this cut.
- **Waiting on**:
  1. **The joint Spacebar/Machloket boot** (TASK-1137 continuation): the fork's rename settled (machloket-server, history rewritten — e3e84c9ef tips, re-derive SHAs by subject); the boot recipe is updated at `docs/local/boot-b/relaunch-raw.txt` + README. ~~First verification: the deferred live CLIENT LIST check for TASK-1146~~ **DONE 2026-10-01**: boot-b relaunched on the beta.233 build, 45/45 app connections on db=1 (TASK-1146 Done); the boot-race residue (DenylistCache hydrate has no retry) filed as TASK-1154. Boot-b is UP — interactive TR exercise pending (Lila + the Machloket client session).
  2. ~~**TASK-1152** (deepmerge-ts >=8.0.0 override)~~ MERGED 2026-10-04 as #2569 (prisma CLI verified at 8.0.2: migrate diff/status/generate + a no-op dev `db:migrate`).
  3. **TASK-1153** (overrides pin-form audit): conditional vs unconditional forms, next time the block is touched.
  4. **TASK-1150/1151** (skills structure-gate line + review-lows batch): ride the next skills PR.
  5. **The doc-61 successor**: the economy pass ran 2026-10-01 (#2563); next pass due ~2026-10-31.
  6. Owner call carried: N back to 10 on Emily and Lilith after the TASK-1039 read. (TASK-1027 / TASK-960 / TASK-961 decided 2026-10-04 with the owner-queue sweep: 1027 ready, 960 and 961 closed.)
- **Watches (agent-run, no owner action)**: the beta.233 deploy's first hours on prod (boot lines, 0-error windows); the first quoted/forwarded voice transcription on prod (#2548); the reminder-DM first prod cohort (can form on/after 2026-10-04); the nightly db-sync on the new build; the `/inspect` masked-link render (#2259, carried).
- **🧑‍💻 Owner to-do**: (1) the PROD smokes still open: beta.230 item 2 (settings-dashboard walk) and the beta.232 item (plain voice re-upload) — both in `CURRENT.md`; (2) the TASK-1039 second read day at N=3; (3) TASK-907 commitment-facts review; (4) TASK-1049 break-it pass in a fresh session (owner-run, decided 2026-10-04); (5) TASK-104 voice-reference trims; (6) leisure: card-level examples for Emily, the voice-harness blind review.
- **Explicitly NOT in**: the memory-archive flips (settings, not code) · browse/UI waves 4–6 · doc-86 · the vitest 5 bump (TASK-913 watches) · the agentic `/memory remember` · caching Phase 3 until the doc-17 reading · doc-107 until the digest shape settles.
- **Deploy notes**: no migrations pending at the write. **GH007 watch**: the owner's GitHub "block command line pushes that expose my email" setting misfired on noreply-email commits during this cycle (turned off to unblock; root cause not fully isolated — if pushes start failing with GH007 again, check that setting first). Keep ranges small enough for a normal `gh pr merge --rebase`: beta.233 confirmed the threshold at ≤117 commits (118 needed the FF).
- **Cut when**: TASK-1172 merges (owner ruling 2026-10-04, above); the standing backstops (~10 runtime PRs / ~250 files) still apply if anything balloons.

### 🚢 beta.233 — SHIPPED 2026-10-01 (the record below is the pre-cut plan; contents as-listed above in the beta.234 header)

### 🚢 Next Release — beta.233 (theme: the drain, the harness-migration follow-ups, and the character-card import tool; caching Phase 3 and doc-107 stay gated)

_beta.232 CUT 2026-09-27 10:52Z (06:52 EDT), "the voice-retry fixes". **The numbers:** 2 PRs, 2 runtime, 69 files (35 code and tests, 17 version bumps, 14 tracker tasks, 3 docs/backlog), no migrations; release PR #2546; `main` = `develop` = `db576a093` after `release:finalize`. **Contents:** #2544 (TASK-1074, undecodable audio gets a format reply), #2545 (TASK-1112, a plain re-uploaded voice file is transcribed), the getting-started guide fix. **The second look:** one holistic claude-review body, no findings. **Preflight:** no advisories, no deletion-safety findings, no dependabot PRs. **Deploy watch:** the owner's prod smoke (`CURRENT.md` § beta.232 item 1); ai-worker's `Plain WebM upload is audio-only; routing to STT` is the success line, `Voice engine rejected audio as undecodable` is #2544's. **Slope (beta.231 → beta.232):** filed 11 (TASK-1113–1123), closed 9, open 375 (`status: To Do`)._

- **Driver**: Fable drove the beta.230 cut; the drain continues under whichever driver the owner picks (Opus 5.5 at medium for mechanical days, Fable for theme days). Owner decisions carried (binding):
  - the memory-archive flips stay per character on their gates;
  - TASK-1038's promotion stays automatic and atomic across its three writes (the owner's 2026-09-21 ruling on TASK-1037 still governs);
  - TASK-1027 is the owner's call;
  - no model-parameter experiments;
  - the owner clears sessions with `/clear`, so every handoff lives on disk.
- **In**: (empty at the cut.)
- **Waiting on**:
  1. **TASK-1117, the doc-audit memory pass moves to the harness** (owner steer 2026-09-27; agreed with the Harness session): cut the Tzurot skill's § 0 to a pointer at `harness:doc-audit`, fix `07-documentation.md`'s memory note. Spec at `docs/local/dispatch/task-1117-spec.md` (its header notes the reshape). Skill + rule, so a PR.
  2. **TASK-1116, the quoted/forwarded sibling of #2545** (size M): a quoted or forwarded plain audio-only WebM still renders as a file stub.
  3. **TASK-1070's dev check** (owner smoke, `CURRENT.md` § beta.230 item 1): one TTS reply and one no-key transcription in dev on the Python 3.13 voice-engine. Not a cut blocker; it closes the task.
  4. **The doc-61 economy pass**, due 2026-10-02.
  5. Owner call carried: N back to 10 on Emily and Lilith after the TASK-1039 read (recommended; numbers on TASK-1039).
  6. **Dependabot #2555** (claude-code-action 1.0.231→1.0.235): must land MAIN-CUT — it touches `claude-code-review.yml` + `claude.yml` (guard:workflow-sync; a develop merge silently disables claude-review until release) — and its lint check is red, so it is NOT develop-mergeable as-is. Handle during the release procedure (cherry-pick the workflow hunks into a main-cut PR, fix the lint there). #2556 merged 2026-09-30 (4 patch bumps, all green, review skipped by workflow); its lockfile change made #2557 DIRTY and dependabot superseded it with **#2559** (dev group, 11 updates) — #2559 merges on its own fresh green round.
- **Watches (agent-run, no owner action)**:
  - beta.230's: the first forwarded message with images and the first cross-channel quoted reply on prod (#2528, #2529, read the prompt block); the first mid-stream send failure on prod (#2530, the persisted row carries the delivered chunks and the owner alert dedups on the partial's cause frames); the next nightly db-sync run on the new build (the 07Z slot);
  - carried: the same-channel `summarized` register on Emily and lilith on prod; TASK-937, TASK-991/992's runtime clause, the doc-17 caching reading, TASK-901, the Emily pre-warm gate (TASK-971), and the `/inspect` masked-link render (#2259).
- **🧑‍💻 Owner to-do**: (1) the beta.230 smoke in `CURRENT.md`: the TASK-1070 dev check (item 1) and the settings-dashboard walk on prod (item 2: page index, Reset page, Reset all); (2) the beta.232 prod smoke (`CURRENT.md` § beta.232 item 1): re-upload a Vencord voice message as a plain file, the character answers the transcript; (2b) ~~TASK-1121 and TASK-1123~~ RULED 2026-09-27 as recommended: filenames are content (TASK-1121 now ready, size M); the privacy policy now names attached audio files (TASK-1123 Done, Last updated 2026-09-27; beta.233's notes must say so, per the policy's own § on material changes); (3) the TASK-1039 second read day at N=3; (4) TASK-907: review the commitment facts with `/memory facts character:<Emily> tag:commitment:promise` and note any welcomed pet name NOT extracted (TASK-950); (5) TASK-1027's call: strip look-alike brackets by Unicode category (recommended, fails safe) or accept the pass-through; (6) TASK-960's call: keep the multi-tag fan-out parallel (recommended) or serialize it; (7) TASK-961's call: keep `/history clear` as a context boundary (recommended) or make a soft clear forget too; (8) TASK-104: trim and re-upload the 8 over-cap voice references, then `pnpm ops voice-refs:audit --env prod`; (9) leisure, unchanged: card-level examples for Emily; the voice-harness blind review. (The `doc-83` un-park was decided 2026-09-25: the Spacebar spike is TASK-1108 in Current Focus.)
- **Explicitly NOT in**: the memory-archive flips themselves (settings, not code — TASK-1038 automates the write, the gate still decides) · browse/UI (`doc-14` waves 4–6, incl. the `/shapes export` UX row) · `doc-86` · TASK-906/TASK-910 residue unless a prompt-version bump is planned · the vitest 5 bump (TASK-913 watches) · further lookahead on the strip matchers (TASK-921/923, TASK-1012) · TASK-933 · the agentic `/memory remember` (the agentic proposal owns it) · a digest prompt-version bump (nothing observed warrants one) · TASK-1026 until a seventh header label appears · caching Phase 3 until the doc-17 reading arrives · `doc-107` (the archive/digest consolidation) until the same-channel mode settles the digest shape.
- **Deploy notes**:
  - No migrations pending at the write.
  - The `summarized` same-channel mode is live on prod for Emily and lilith-tzel-shani from beta.229 (owner ruling at that cut). It is reversible live from the dashboard; a prod edit syncs back to dev by last-write-wins.
  - `hook-posix-parse` is a main-required check from 2026-09-25; any rename of that job is the two-step change in `.github/rulesets/README.md`.
  - Keep ranges small enough for a normal `gh pr merge --rebase`: beta.229 (166 commits) and beta.230 (117 commits) both needed the fast-forward fallback, so the threshold is below 117 commits, not the ~200 the skill cites. The always-loaded line budget on `CURRENT.md` is checked by CI's lint job on the release PR but NOT by a code-bearing pre-push (TASK-1101 is the classifier gap); run `pnpm ops lines:check` before opening the release PR.
  - The digest sweep on prod runs only for the listed pairs (spend ceiling = listed pairs × ≤12/day, D8) — TASK-1038's promotion widens that list automatically, so its spend line is part of its spec; retention is live and autonomous from beta.222 (kill switch: `RETENTION_AUTORUN_ENABLED=false` on bot-client); the reminder DM (beta.223) forms its first prod cohort on or after 2026-10-04. Prod ops writes under auto mode: `release:premigrate` and `db:safe-migrate` are `autoMode.soft_deny` at user scope by design; `release:premigrate` also carries a `permissions.ask` rule, so it prompts (forwarded to the phone) instead of reaching the classifier.
- **Cut when**: TASK-1117 and TASK-1116 have merged, or the standing backstops fire first (~10 runtime PRs and ~250 files); `release:range` at the 2026-09-27 cut: 0 PRs. TASK-1122 (the bulk card importer, size L) is NOT a cut blocker: it waits on the characters session's final cards (their download at the Deck, then a slug reconciliation), and it can ride whichever train it finishes in.
- **🗺️ Horizon (rolling three releases, re-touched at every cut)**:
  - **beta.233**: this block.
  - **beta.234**:
    - caching Phase 3, if the doc-17 reading arrives;
    - `doc-107`, once the digest shape settles;
    - the UX-epic slice (`doc-14` waves 4–6);
    - slice C's dead-row report (TASK-971);
    - the TASK-802 escaping sweep, which now includes the edit-dashboard name sites;
    - TASK-1118 and TASK-1119 (retire Tzurot's machine-wide cadences and pr-monitor hook copies), once the Harness session reports the versions that ship them.
  - **Backlog slope**: beta.230 → beta.231 filed 10 / closed 7 / open 367; beta.231 → beta.232 filed 11 / closed 9 / open 375. Two short, filing-heavy windows: net +8 open. Re-measure at the beta.233 cut.
### 🎯 Current Focus (max 3)

**🐛 `[FIX]` Character voice drift in long conversations — `doc-97` (owner intake 2026-09-05, HIGH; the beta.219 opener and the re-entry into `doc-8`)** — a character's replies no longer match its card after months of use. Measured from prod memories on 2026-09-05 (aggregates only, read-only one-off script stored under `docs/local/handoffs/`, copied into `scripts/analysis/` to run): the card register faded through spring and collapsed in August 2026 — exclamation marks per 1k chars 1.3–3.8 (winter) → 0.7–1.0 (Apr–Jul) → 0.06 (Aug) → 0.01 (Sep); a courtroom vocabulary absent through July appears in August and doubles in September; average reply length 830 → 1,652 chars. Mechanism: the card sits ~45k tokens upstream behind the cache prefix while ~43k tokens of the character's own prose (cross-channel history + memory archive, which stores replies verbatim) sit at the generation point. Phase 1 (the `voice_anchor` V-tier section) shipped in beta.219 (#2348), and every build phase of the memory-archive design (`doc-8`) is on main behind switches that ship OFF; what remains is Phase 2 (the owner-applied directive) and the owner-run rollout in `CURRENT.md`. Owner rulings 2026-09-05: anchor before caching Phase 2, LID starts at the design pass. Evidence, handoff, and payload under `docs/local/handoffs/` (gitignored).

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

**🔎 `[FEAT]` Spacebar fork — `doc-83` (owner ruling 2026-09-25: fork Spacebar; TASK-1108 spike DONE the same day, both parts on `doc-83`)** — the fork lives in its own private repo and its own driver session (Deck management sets both up; not this board's work). What stays on THIS board: **TASK-1137** (queued after TASK-1133), the Tzurot-side host override the fork needs before bot-client can point at an instance (the Client's `rest` option, `utils/deployCommands.ts`'s bare `new REST()`, the hard-coded CDN hosts in `discordCdnGuard.ts` and ai-worker's `attachmentFetch.ts`), gated behind config so Discord stays the default; the Fermo client check is on the owner queue. The fork's first milestone is the nine-patch list on `doc-83`, with the callback-route token check landing before any instance is reachable by others.

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(2026-09-16: the Dependabot batch + claude-workflow main-cut entry SHIPPED in beta.225 — `claude-code-action@v1.0.222` on both `main` and `develop`, #2424 merged, #2425/#2426 superseded by #2430/#2431; the `adm-zip` alerts cleared with beta.227 — TASK-947 CLOSED 2026-09-21. Quick Wins is empty.)_



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic. 2026-08-23: the slash-chat-mirrors-tagging directive routed to idea doc `doc-82` — Untriaged is empty.)_

