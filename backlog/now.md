## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- 🐛 `[FIX]` **TASK-1079**: the Share Chat History drill-down on both character dashboards builds a 107-character customId, and discord.js throws on it. It has been reachable on prod since beta.209. **Fixed on develop as #2508** (`22a9cb0cd`, 2026-09-24): UUID entity ids are compacted in the customId, and a ratchet builds every dashboard message and holds every id at ≤ 100. It ships with beta.230; remove this entry at that cut.

_(2026-09-21: the vxreddit Components-V2 entry REMOVED — fix #2461 verified on dev by the owner smoke, Emily described the art; prod verification is the same check after beta.228. The entry's capture, probe and PR history live on TASK-1024 and in git.)_



- 🐛 `[FIX]` **Vision chain terminates on a router `content_policy` refusal, so the Qwen tail is never reached** (owner report 2026-09-12; log-verified on the current prod ai-worker deployment: 67 vision invocations in ~11.7 h, ZERO on `qwen/qwen3.5-397b-a17b`; two sensitive images walked glm-flash `provider_content_refused` → advance → `openrouter/auto` `content_policy` → "terminate category, image itself rejected", then negative-cached so two re-asks terminated without a call). Mechanism: `VISION_TERMINATE_CATEGORIES` holds `content_policy` and `censored`, treating a provider's refusal as image-intrinsic, against TASK-747's recorded evidence that lower tiers describe what an upstream filter refused. **TASK-937 (high, S). Owner ruling 2026-09-12: both refusal kinds advance; only `media_not_found` stays terminal.** **Fix MERGED as #2399 (develop `3abdc6ad6`, 2026-09-12; ships with beta.223)**: the terminate set is `media_not_found` only, pinned by the invariant tests, single-hop advance tests for both refusal kinds, the three-hop prod walk, and a real-Redis test where a cached `content_policy` entry on tier 1 advances to a fresh tier-2 call. The two prod images already negative-cached at the router advance on their next ask without a flush (the cache is per model). TASK-899 (a less-filtered tail model) stays separate. **Runtime-UNVERIFIED until the deploy** — remove this entry when a prod log shows a qwen invocation following an auto-router `content_policy` advance (TASK-937 stays open as `state:observable` for that clause).

- **Runtime-unverified fixes and parked incidents moved to `state:observable` tracker tasks (2026-09-13 context-budget trim)**: TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.


---



### 🚢 Next Release — beta.230 (theme: dashboard index navigation, then doc-97 Phase 4 slice 2 if the read moves the register)

_beta.229 CUT 2026-09-24 11:28Z (07:28 EDT). **The numbers:** 30 PRs, 24 runtime, 402 files, 166 commits, no migrations; release PR #2501; `main` at `9cb29c9c4`. **How it merged:** `gh pr merge --rebase` refused ("This branch can't be rebased"), so it went through the documented fast-forward, and finalize was a no-op. **Contents:** the Vencord voice fix (#2499), db-sync single-flight (#2497), Node 24 everywhere (#2496), and the gateway manifest enforcement. **The second look:** a split local release review (four area reviewers) ran before the release PR; its two findings were fixed in #2500. **Owner rulings at the cut:** approve; keep the synced `summarized` same-channel mode live on prod for Emily and lilith-tzel-shani. **Deploy:** the first prod boots on Node 24 were clean on api-gateway, ai-worker and bot-client, with 0 error lines in the first 15 minutes._

- **Driver**: Opus 5.5 at medium for the drain; Fable for the theme design and council passes. Owner decisions carried (binding):
  - the memory-archive flips stay per character on their gates;
  - TASK-1038's promotion stays automatic and atomic across its three writes (the owner's 2026-09-21 ruling on TASK-1037 still governs);
  - TASK-1027 is the owner's call;
  - no model-parameter experiments;
  - the owner clears sessions with `/clear`, so every handoff lives on disk.
- **In**: #2505 (TASK-1070, voice-engine on Python 3.13) · #2506 (TASK-1073, husky hooks under dash) · #2507 (doc-72 PR A, page navigation) · #2508 (TASK-1079, the settings customId cap fix) · #2509 (doc-72 PR B, the resets + TASK-1080) · #2510 (TASK-1083, `REDIS_IP_FAMILY`; the first cloud-built unit) · #2511 (TASK-1067, README podman commands on localhost-only ports; docker-compose.yml deleted).
- **Waiting on**:
  1. **The TASK-1039 read:** RUN 2026-09-24, inconclusive. One thread per day kept Emily under N 10, so none of her ON turns summarized. Owner ruling 2026-09-24: N=3 on Emily and Lilith for one more read day, set by the owner. The second read runs once that day's thread is complete. Slice 2 (the measured default for N, the override cascade, the facts-vocabulary slice) waits on that second read.
  2. **`doc-72` dashboard index navigation:**
     - PR A (navigation) MERGED 2026-09-24 as #2507 (`eb0983e98`, four review rounds), absorbing TASK-256.
     - PR B MERGED 2026-09-24 as #2509 (`1b9c8bd5d`, one review round): Reset page, the hub's Reset all, and TASK-1080 (TASK-1001 and TASK-1080 Done). Admin's System pages follow in TASK-1082; the orphaned DELETE routes are TASK-1085. doc-72's cut condition is met.
     - Owner ruling 2026-09-22: it lands before slice 2 adds more settings surface.
  3. **TASK-1070:** MERGED as #2505. It is open for its dev check: TTS plus a no-key transcription in dev.
  4. **The doc-61 economy pass**, due 2026-10-02.
- **Watches (agent-run, no owner action)**:
  - beta.229's: the next nightly db-sync logs one run (#2497). The sync fires in the 07:00 UTC hour (the `nightlySyncHourUtc` fallback), and the prod boot at 11:29Z came after the 09-24 slot, so the first post-cut run is 2026-09-25 07Z. The scheduler registered cleanly at boot. Then the next account export's README line (#2500): no export has run on prod since the cut (checked 09-24 20:22Z). Then the same-channel `summarized` register on Emily and lilith on prod;
  - carried: TASK-937, TASK-991/992's runtime clause, the doc-17 caching reading, TASK-901, the Emily pre-warm gate (TASK-971), and the `/inspect` masked-link render (#2259).
- **🧑‍💻 Owner to-do**: (1) the beta.229 smoke, in `CURRENT.md`: a Vencord/Vesktop voice message in dev, direct and as a reply's referenced message, once with the Mistral key and once without; TASK-1069 stays open until it passes; (2) TASK-907: review the commitment facts with `/memory facts character:<Emily> tag:commitment:promise` (the tag filter is on prod now; the Sort A-Z workaround is retired) and note any welcomed pet name NOT extracted (TASK-950); (3) TASK-1027's call: strip look-alike brackets by Unicode category (recommended — fails safe, at the price of a mangled CJK filename) or accept the pass-through; (4) TASK-960's call: keep the multi-tag fan-out parallel (siblings blind to each other within the turn, recommended) or serialize it so later slots see earlier replies; (5) TASK-961's call: keep `/history clear` as a context boundary (recommended) or make a soft clear forget too; (6) TASK-104: trim and re-upload the 8 over-cap voice references, then `pnpm ops voice-refs:audit --env prod`; (7) leisure, unchanged: card-level examples for Emily; the voice-harness blind review.
- **Explicitly NOT in**: the memory-archive flips themselves (settings, not code — TASK-1038 automates the write, the gate still decides) · browse/UI (`doc-14`, incl. the `/shapes export` UX row) · `doc-86` · TASK-906/TASK-910 residue unless a prompt-version bump is planned · the vitest 5 bump (TASK-913 watches) · further lookahead on the strip matchers (TASK-921/923, TASK-1012) · TASK-933 · the agentic `/memory remember` (the agentic proposal owns it) · a digest prompt-version bump (nothing observed warrants one) · TASK-1026 until a seventh header label appears · caching Phase 3 until the doc-17 reading arrives · `doc-107` (the archive/digest consolidation) until the same-channel mode settles the digest shape.
- **Deploy notes**:
  - No migrations pending at the write.
  - The `summarized` same-channel mode is live on prod for Emily and lilith-tzel-shani from beta.229 (owner ruling at the cut). It is reversible live from the dashboard; a prod edit syncs back to dev by last-write-wins.
  - Keep ranges small enough for a normal `gh pr merge --rebase`. beta.229's 166 commits needed the fast-forward fallback, and its 402 files needed the split local review.
  - The digest sweep on prod runs only for the listed pairs (spend ceiling = listed pairs × ≤12/day, D8) — TASK-1038's promotion widens that list automatically, so its spend line is part of its spec; retention is live and autonomous from beta.222 (kill switch: `RETENTION_AUTORUN_ENABLED=false` on bot-client); the reminder DM (beta.223) forms its first prod cohort on or after 2026-10-04. Prod ops writes under auto mode: `release:premigrate` and `db:safe-migrate` are `autoMode.soft_deny` at user scope by design; `release:premigrate` also carries a `permissions.ask` rule, so it prompts (forwarded to the phone) instead of reaching the classifier.
- **Cut when**: `doc-72` is merged, and doc-97 Phase 4 slice 2 is merged if the TASK-1039 read moves the register. If the read does not move it, the cut goes when `doc-72` lands. The standing backstops are ~10 runtime PRs and ~250 files; `release:range` reads 0 PRs at the write.
- **🗺️ Horizon (rolling three releases, re-touched at every cut)**:
  - **beta.230**: this block.
  - **beta.231**:
    - caching Phase 3, if the doc-17 reading arrives;
    - `doc-107`, once the digest shape settles;
    - the UX-epic slice (`doc-14` waves 4–6);
    - slice C's dead-row report (TASK-971);
    - the TASK-802 escaping sweep, which now includes the edit-dashboard name sites.
  - **Backlog slope**: not measured at the beta.229 cut; re-measure at beta.230. The beta.229 window filed TASK-1041–1076 and closed at least TASK-1038, 1043, 1052–1056, 1058, 1059, 1063, 1064 and 1068 (each reads `status: Done` in the tracker at the write); the list is not exhaustive.

### 🎯 Current Focus (max 3)

**🐛 `[FIX]` Character voice drift in long conversations — `doc-97` (owner intake 2026-09-05, HIGH; the beta.219 opener and the re-entry into `doc-8`)** — a character's replies no longer match its card after months of use. Measured from prod memories on 2026-09-05 (aggregates only, read-only one-off script stored under `docs/local/handoffs/`, copied into `scripts/analysis/` to run): the card register faded through spring and collapsed in August 2026 — exclamation marks per 1k chars 1.3–3.8 (winter) → 0.7–1.0 (Apr–Jul) → 0.06 (Aug) → 0.01 (Sep); a courtroom vocabulary absent through July appears in August and doubles in September; average reply length 830 → 1,652 chars. Mechanism: the card sits ~45k tokens upstream behind the cache prefix while ~43k tokens of the character's own prose (cross-channel history + memory archive, which stores replies verbatim) sit at the generation point. Phase 1 (the `voice_anchor` V-tier section) shipped in beta.219 (#2348), and every build phase of the memory-archive design (`doc-8`) is on main behind switches that ship OFF; what remains is Phase 2 (the owner-applied directive) and the owner-run rollout in `CURRENT.md`. Owner rulings 2026-09-05: anchor before caching Phase 2, LID starts at the design pass. Evidence, handoff, and payload under `docs/local/handoffs/` (gitignored).

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(2026-09-16: the Dependabot batch + claude-workflow main-cut entry SHIPPED in beta.225 — `claude-code-action@v1.0.222` on both `main` and `develop`, #2424 merged, #2425/#2426 superseded by #2430/#2431; the `adm-zip` alerts cleared with beta.227 — TASK-947 CLOSED 2026-09-21. Quick Wins is empty.)_



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic. 2026-08-23: the slash-chat-mirrors-tagging directive routed to idea doc `doc-82` — Untriaged is empty.)_

