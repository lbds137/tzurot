# Backlog substrate — is markdown the wrong data structure?

**Status**: DRAFT — grounded 2026-07-25. Not yet councilled, no owner decisions taken.

**Owner directive (2026-07-25)**: _"I am starting to feel frustration with our current backlog scheme yet again, even though we've gone through multiple reorganizations to try to make it more tameable. really wishing we had a mini Jira without the Atlassian bullshit."_

---

## Correction to this artifact's first draft

The pre-compaction draft led with **"118 rows (35%) carry a trigger that by our own rule never fires."** That number does not survive grounding and is **withdrawn**.

Re-derived three ways: the original regex said 118, a second said 56, and a hand-read of all 56 flagged rows found **~24 (≈8%)** that are purely opportunistic. The rest carry a real observable arm — `"next touch of either file, **or the next z.ai catalog change**"`, `"next touching the persist handlers, **or a dual-write-doc-confusion report**"`. Counting the presence of opportunistic *language* is not counting stranded *rows*.

That correction inverts the artifact's thesis, so it leads. **The rows are not junk. The pile is honest.** The problem is not what is in the table; it is that nothing can be asked of it.

## The claim this artifact tests

Three reorganizations have not made the backlog tractable because **reorganizing does not change the substrate**. Every rule we have built — the admission bar, the granularity ladder, the three removal exits, the HOT/COLD split, the section caps, the aging nudge — is a **schema and a query planner, written as prose, executed by hand**.

The sharpened form, after grounding: we have **341 well-formed, correctly-triggered work items** in a store that can answer exactly one question — _what is oldest?_ — and cannot answer the only question that matters: _which of these triggers has fired?_

## Grounding

### The pile is honest — this is settled, not hypothesised

`6baa9b27a` (2026-07-24) hand-read **all 367 rows**. Result: **zero qualified for removal** under either exit (shipped / genuinely obsolete).

> "The pile is honest: entries uniformly carry a mechanism, a fix shape, a promote-when trigger, and a stated why-not-now. Several had already self-triaged... It grew because the work is genuinely queued, not because it rotted."

Any candidate whose value proposition is "this will let us delete a lot" is answering a question we already closed. **The backlog is not full of rot; it is full of work.**

### Measurements (all reproducible)

| | value |
| --- | ---: |
| `cold/follow-ups.md` data rows | **341** |
| file size | **367 KB** (~90k est. tokens) |
| **mean row length** | **1,058 chars** |
| median / p90 / max row | 957 / 1,707 / **2,845** chars |
| rows carrying a `Promote when:` trigger | 320 |
| …purely opportunistic (hand-verified) | **~24 (8%)** |
| rows filed in July 2026 alone | **165 (48%)** |
| rows removable at full triage | **0 of 367** |
| theme files | 28 · `cold/ideas.md` a further 150 KB |
| session-start hot surface | 246 lines / 44 KB across 5 files |

The header of that file calls its rows _"small, terse items."_ The median row is a **957-character paragraph**. The format's contract broke and nothing noticed, because nothing measures it.

### Why the query failures were mechanical, not sloppiness

A markdown table row **is a line**. `grep` is line-oriented. So:

```
grep -i memory backlog/cold/follow-ups.md   →  43 hits, 43,576 bytes  (~11k tokens)
grep    queue  backlog/cold/follow-ups.md   →  16 hits, 17,965 bytes
```

Every keyword search returns ~1 KB per hit, matching on incidental prose deep inside unrelated rows, **with no field to narrow on**. That is precisely the "jobs/queue pass returned 60+ rows of noise" failure — and it is a property of the store, not of the searcher. There is no query that does better, because there is nothing to query.

This reframes the three method failures recorded in the first draft. They remain real, and I own them. But "the agent must grep more carefully" is not an available fix when a single keyword costs 11k tokens of undifferentiated prose.

### A row silently swallowed another row

From the same triage commit:

> "Row 344 was TWO logical rows concatenated onto one line (6 pipes, not 3). The second item — two fake-optional columns from the retention 1c schema audit — **was hidden inside another row, so it could never be counted or surfaced by the nudge**."

A tracked work item disappeared into a neighbouring record and was invisible to every tool and every reader until someone read all 367 rows by hand. Markdown tables have no record-boundary enforcement; any store with actual records makes this failure unrepresentable.

### The escalation nudge cannot be fixed within this substrate

`06-backlog.md` leans on the aging nudge as the one standing pressure against pile-up. It was starved — 27 undated rows monopolised 5 display slots, so **159 pre-July rows had never once surfaced**. That was fixed (`83b0bb395`). Today's output:

```
⏳ Oldest follow-ups (aging escalates — decide, don't delete):
   • 2026-01-26  Schema versioning for BullMQ jobs
   • 2026-01-26  Redis pipelining
   • 2026-01-26  BYOK lastUsedAt tracking
   • 2026-01-26  Handler factory generator
   • 2026-01-26  Scaling preparation (timers)
```

**The same five rows will print on every run forever**, until someone does them. The fix moved the starvation from undated-rows to oldest-rows; it did not remove it. A top-N-by-one-key report over a flat file can only ever surface N items, and 336 stay dark.

This is the load-bearing point. The nudge does not want to be sorted by age — it wants to answer _"which triggers fired since last week?"_ That query is not expressible here at any level of tooling effort, because `Promote when: next touch of either file, or the next z.ai catalog change` is prose in the middle of a 1 KB cell.

### Relocation does not generalise

Two passes moved 18 epic-scoped rows into their owning theme files. **UX worked** — its rows carry unambiguous markers (`§2.3`, `Wave 3`, `PR-4`). **Memory failed the same method** — "memory" is the feature, the RAM, and the retrieval subsystem at once, so a keyword pass returned 80+ noise hits; it only worked by falling back to the epic's private vocabulary (`1b council deferral D`, `FactStore`).

So relocation is **per-epic archaeology whose precision depends on whether that epic happened to leave distinctive strings in prose months ago**. 26 theme files remain. It is not a repeatable process.

Note what relocation actually bought: it did **not** reduce work — the rows still exist, moved. It made work **legible**. Same row, same trigger, opposite outcome, purely from location. That is itself evidence for the substrate claim.

### Filing rate

48% of rows were filed this month. Filing is cheap and drain is expensive, so the pool grows regardless of how honest each entry is. Any candidate must be judged on whether it changes that ratio — a store that merely holds the same items more neatly is a lateral move.

## Candidate directions (unevaluated — this is the council's job)

1. **GitHub Issues.** Grounded: issues are **enabled**, repo is **public**, **zero issues have ever been created**, only stock labels exist. Greenfield. Labels ≈ the ladder; milestones ≈ themes; `gh issue list --search --label --json` ≈ every regex fumbled above. Native PR↔issue closing links would mechanise the release-time sweep that keeps being missed. Costs: requires network; the hot surface must be regenerated rather than read; 341 items to migrate.
2. **Structured markdown + query tooling.** One file per item (or frontmatter rows), fields for trigger/type/area/date, `pnpm ops backlog query --trigger-fired`. Keeps git-native storage, offline work, and session-start loading. Costs: we build and maintain the query layer, and `backlogLint.ts` (341 lines) becomes a real tool with a real schema.
3. **Stay put, add guards.** Accept the substrate; add mechanical checks for the specific failure classes (reject opportunistic triggers at filing time, cap row length, enforce pipe count). Costs: does not make the store queryable, and the nudge starvation above is unfixable under it.
4. Something the council proposes.

## The objection any answer must clear

**The markdown backlog is loaded into agent context at session start.** `backlog/now.md` + `active-epic.md` + `references.md` + `BACKLOG.md` + `CURRENT.md` = 246 lines / 44 KB, read every session. That is *why* this substrate was chosen, and it is not a small thing.

Mitigations exist (a generated digest committed into the hot file; `gh issue list` at session start) but each has a cost, and a design that quietly degrades session-start context trades a visible problem for an invisible one. **This leads the council brief rather than being buried.**

Second constraint, weaker but real: git-native storage works offline and survives GitHub. Issues do not.

## Open calls (for council, then owner)

- **a.** Is the substrate diagnosis correct — or is a 341-item honest backlog simply what a one-person project with this quality bar produces, and the right move is to accept the pile and improve only its *surfacing*?
- **b.** If a tracker: GitHub Issues, or structured-markdown-plus-tooling? What breaks in each at this scale?
- **c.** Session-start agent context post-migration, concretely. What exactly does the agent read at turn one?
- **d.** What happens to the rules that exist only to compensate for the substrate (HOT/COLD, caps, the ladder, the aging nudge)? Retire or port?
- **e.** Migration cost for 341 rows — and is a partial migration coherent (themes stay markdown, follow-ups become issues), or does splitting the store make querying strictly worse?
- **f.** **The real question behind the nudge**: is _"which triggers fired since last week?"_ answerable in any candidate — including as a human-in-the-loop review rather than an automated query? If no candidate can answer it, trigger-gating is a fiction and items should be filed by priority instead.
- **g.** Filing outpaces drain 2:1. Does any candidate change that, or does it need a separate answer (WIP limits, a filing budget, mandatory drain-per-PR)?

---

## § Council record (2026-07-25)

Trio, identical adversarial brief, run in parallel: **GLM 5.2** · **Kimi K2.7-code** · **Qwen 3.7 Max**. All model IDs verified live via `list_models`.

### The council dissolved this artifact's central objection — 3/3, unprompted

I built the brief around "the markdown backlog is loaded into agent context at session start; that is why this substrate was chosen." **All three independently called that a self-inflicted architecture error**, and gave the same fix:

> "You are optimizing the database for the ORM rather than the user." — Qwen
> "You have conflated the transport with the product." — Kimi
> "A generated, git-committed context file... It does **not** contain 341 raw rows." — Kimi

The constraint was mis-stated. The agent must read **a** backlog context at turn one — not **the raw store**. Generate the hot surface from whatever the store is, and storage decouples from context loading entirely. **The objection that framed this whole boulder is the easiest thing in it to solve**, which means the substrate question was never actually gated on it.

This also collapses the (b) split: Issues' only serious disadvantage was "not loadable." That disadvantage does not exist once the digest is generated — and a digest generator is required by **every** candidate, so it is not a differentiator either.

### Unanimous verdicts (3/3)

| Call | Verdict |
| --- | --- |
| **(a)** | **My "the pile is honest, so it's not a rot problem" conclusion is WRONG.** Honest ≠ necessary. "Well-rationalized hoarding" (GLM); "you confused well-documented with necessary" (Qwen); "exactly what a one-person project with no intake cap produces" (Kimi). |
| **(c)** | Agent reads a **generated, capped, git-committed briefing** — never the raw store. |
| **(e)** | **Partial migration is incoherent** — two sources of truth, global queries get strictly worse. All-or-nothing. |
| **(f)** | **Trigger-gating is a fiction.** No candidate can evaluate "which triggers fired" without an event-ingestion layer watching file touches, metrics, and user reports. Replace with plain priority + a periodic human review; keep `Promote when:` as an annotation, never a gate. |
| **(g)** | **No substrate changes filing-vs-drain.** It needs a separate process answer: WIP cap, one-in-one-out, filing budget, or mandatory drain-per-PR. |

### The arithmetic finding — the one that outranks the substrate question

All three converged on this independently, and it is not a taste argument:

> **intake > drain, with deletion structurally forbidden, is unbounded by construction.**

`06-backlog.md` states "aging escalates priority — it never deletes" and permits only shipped / obsolete / ruled-out. Measured: 48% of the pool was filed in one month; the full triage removed **zero**. Every model independently concluded the rule guarantees the pile grows forever regardless of substrate. GLM and Qwen proposed hard time-based culling; Kimi proposed a "beyond horizon / not planned" exit plus a hard ceiling.

**This is an owner call and is NOT taken here** — the no-calendar-pruning rule was written deliberately, and `06-backlog.md` argues for it explicitly. But the council is unanimous that it is the load-bearing defect, and it outranks the storage question.

### Split verdict — (b) substrate

- **Qwen: GitHub Issues.** "`gh issue list` *is* the query layer, maintained by a multi-billion-dollar company." Custom tooling becomes a neglected meta-project.
- **Kimi: conditional.** "Issues win if you automate a git-committed context digest; structured markdown wins if you will not maintain custom tooling. If you will maintain neither, stay put with hard guards is the honest choice."
- **GLM: neither.** "If you move garbage to a new bin, it's still garbage" — culling first, substrate second.

**The split resolves once (c) is settled**: Kimi's condition (automate the digest) is exactly what all three require anyway. That leaves Issues ahead on the one remaining axis — who maintains the query layer — with GLM's objection redirected at sequencing rather than choice.

### What the council caught that I missed

1. **The agent can be part of the DRAIN, not just the audience** (Kimi, Qwen). I designed this entire artifact treating the agent as a passive reader of the backlog. It could be executing triage, evaluating candidate triggers, and rewriting prose into fields.
2. **Capture and commitment are different things** (Kimi). `ideas.md` and `follow-ups.md` share a removal policy and an anxiety budget but should not — ideas are reference material, follow-ups are commitments.
3. **Stable IDs.** Markdown rows have none, so no commit, PR, or query can reference an item. Any migration must assign them.
4. **The meta-work trap** (GLM, Qwen). A 341-line lint script, three reorganizations, regex classifiers, and now a design boulder. "The backlog system has become the project." Fair, and worth weighing against any candidate that adds tooling.
5. **Issues arguably belong to user-facing work**, with internal nits kept private (Kimi) — a scoping option this artifact never considered.

### Declined / pushed back on

- **GLM's "delete 90% immediately" and Qwen's "auto-close after 180 days"** are not adopted as recommendations. They contradict a deliberate, reasoned owner rule, and the full triage found every row carries a mechanism and a fix shape. The *arithmetic* concern is escalated to the owner; the *specific remedy* is the owner's to pick.
- **GLM's "stop loading backlog context at turn one; the agent should read the code"** is rejected on evidence. Session-start context is why work resumes correctly across compactions in this project; the failure mode it prevents is well documented here. Kimi's and Qwen's generated-briefing answer achieves the same decoupling without giving up continuity.

## Where this leaves the design

Three things are now decided by evidence rather than preference: **generate the hot surface** (so storage is free), **trigger-gating is not a real gate** (so it should stop pretending to be one), and **no substrate fixes intake** (so a process answer is required regardless).

The genuinely-owner calls that remain are in the next section.

---

## THE DESIGN CONSTRAINT THAT OUTRANKS EVERYTHING ABOVE (owner, 2026-07-25)

Every council model — across two passes, six model-runs — treated the priority churn as a **defect to be corrected**, and proposed mechanisms to make the owner justify pivots. The owner then supplied the fact none of them had:

> "part of this side project is me having an outlet for a life that is generally pretty stressful. It's really nice to be able to focus on something else, something that I have personal control over. And, unfortunately, at times, my whims do kind of go back and forth."

**The jumping is partly the point.** It is what makes this an outlet rather than a second job. A design that suppresses it removes the thing that makes the project worth having, and would be rejected in use even if adopted on paper — which is a plausible read of why three prior reorganizations didn't take.

### The target inverts

**Do not make jumping harder. Make the haystack cheap to jump around in.**

Jumping is expensive today because landing somewhere new yields nothing findable: `grep -i memory` returns 43 KB of undifferentiated prose with no field to narrow on. With real fields, landing on any area and asking _"what's here, what's small, what's ready"_ is one query, and the whim costs nothing.

This is the **strongest argument for the substrate work in this document**, and it is _pro_-whim rather than corrective. It also supplies the acceptance test the owner actually stated:

> "there's probably low hanging stuff that can be fixed and addressed, but it's hard when the haystack gets so big with, you know, hundreds of items."

**Success is not "a nicer place to store 341 items." Success is answering "here are the 20 items you could close this week."** Any candidate that does not deliver that query has not solved the stated problem.

### What this does to the council's mechanisms

- **GLM's and Qwen's intercept/"constitution hook"** — already demolished by K3 on independent grounds; this constraint independently disqualifies them. They tax the owner's genuine strength (evidence-driven adaptation) identically to the whim, and their enforcement lives in a tool the constrained party configures.
- **K3's "force the park, don't block it"** — SURVIVES, but must be reframed. Writing a re-entry condition when parking is **not** a guilt tax on leaving; it is a **resumption aid** for the version of the owner who wants to jump back in three weeks. Under the whim-robust framing it is pro-whim: cheap return is what makes leaving safe. Frame it that way or it will be experienced as nagging and deleted.
- **K3's "agent as mirror, not gatekeeper"** — SURVIVES unchanged. A neutral read-only line with no required response cannot be resented, gamed, or debated.

## § Council record — second pass (2026-07-25)

Same trio re-briefed with C1/C2 corrections + the Backlog.md candidate + the system-model problem. `kimi-k2.7-code` returned an **empty body** (superseded model; operationalized in the council skill — an empty body is a split, not a consensus); `kimi-k3` ran as the tiebreaker.

**Both errors the council caught in my own thinking** (independently, 2/2):

1. **Drain-per-PR at 1:1 will be gamed.** A typo fix or dependency bump maps to no backlog item, so the rule either blocks trivial PRs or is satisfied by closing whatever is cheapest. Fix: **drain one item OR log a one-sentence skip reason** to a churn file. Adopt the escaped version, never the bare one.
2. **A mechanically-generated system map is not a system model.** It yields a structural graph, not the narrative "why" — _"a generated map of 1,260 files will just be a massive, unreadable hairball… it will just give the agent a larger context window to get lost in"_ (Qwen). This invalidated the Phase 0 originally filed in [`system-model-and-intent-linkage.md`](../../../backlog/cold/themes/system-model-and-intent-linkage.md); that theme has been rewritten to K3's spec.

**Unanimous**: the system-model gap **outranks** the backlog substrate — a backlog is a set of intentions, and intentions built on a stale model of the code are likely wrong. Migrating first codifies the misunderstanding into a better store.

**Backlog.md flips both prior objectors to adopt.** Residual risks all three name: 341 items ≈ 170k tokens, so the digest layer remains ours to build (`--json` gives filtering, not summarization); labels-as-`area` degrades at scale; the generated-briefing integration is a custom script regardless.

**Sequencing (K3 tiebreak, rule: marginal harm per day of delay, with a perishability override):**
`retention PR-D → observability → drain-per-PR → system-model → substrate → UX`. All three agree drain-per-PR is early, system-model precedes substrate, substrate is late, UX is last.

**Correction to the brief I gave them**: I wrote that PR-D "closes the epic to zero." **False** — PR-D closes **Phase 2 of 4**; Phases 3 (reachable branch) and 4 (policy + autonomous) remain. K3's A-vs-F argument rested partly on that. Its surviving prong — one PR, perishable completion window, _"if A were three weeks instead of one PR, this flips"_ — still holds, and the better reason is that `active-epic.md` already names PR-D as the gate on promoting the drain theme.

## § Owner pass close-out (2026-07-26)

Batched owner pass taken 2026-07-26. Four calls, all recorded:

1. **Trial: full shadow import — APPROVED.** One script converts all ~340 follow-up rows into Backlog.md (v1.48.0) task files in an isolated scratch repo outside this checkout (sidesteps the `backlog/` directory collision for the trial; the collision is moot at full migration because our tree would be retired). Markdown stays authoritative throughout; nothing dual-writes; the artifact is disposable. **Pre-set trial kill criteria**: import needs more than ~a day of hand-massaging · area fields can't be derived mechanically for most rows · the owner's acceptance query ("the 20 items you could close this week") returns no better than today's grep · `--json` output can't produce a ≤300-line session-start briefing. If it passes, the import script **is** the migration tool.
2. **Trigger-gating: RETIRED as a gate; survives as an annotation.** Selection becomes priority/area/size queries plus a periodic review. The `06-backlog.md` rewrite rides the migration PR — rules get rewritten once, not twice.
3. **Migration boundary: DEFERRED to post-trial.** The trial must specifically evaluate whether Backlog.md's drafts/docs surfaces can hold document-shaped material (themes, ideas) — that answer decides follow-ups-only vs. everything.
4. **System-model Phase 0 precedes migration** (council-unanimous, adopted). Sequence if the trial passes: retention Phase 3 → system-model Phase 0 (elicited map + owner interview) → migration → drain campaign.

Held item (c) — the generated briefing — is settled by evidence rather than decision: every candidate requires it, so it's adopted at substrate time without a separate call.

## § Trial record (2026-07-26) — full shadow import: **PASS, no kill criterion fired**

Executed same-day as the owner pass. Backlog.md **v1.48.0** via npx; isolated scratch repo at `~/Projects/backlog-md-trial` (own git history, disposable — commit `377662a`); import script + digest demo in the session scratchpad. Markdown remained authoritative throughout; nothing dual-written.

### Against the four pre-set kill criteria

| Criterion | Result |
| --- | --- |
| Import needs >~1 day of hand-massaging | **CLEARED** — ~30 min including parser iteration. 340/340 rows imported, zero pipe anomalies (the swallowed-row class is structurally unrepresentable: one file per record). Three historical row shapes (Surfaced-led / title-led / short-item-long-why) all handled by one parser. |
| Area fields can't be derived mechanically for most rows | **CLEARED, with the migration's real cost named** — 186/340 (55%) labeled from a conservative first-pass vocabulary; the remaining 154 need one agent labeling pass (bounded: one session of reading ~1KB rows). 319/340 triggers found (matches the board's own 320 count). |
| The acceptance query returns no better than today's grep | **CLEARED** — the literal failing query (`memory`): grep 43,576 bytes / ~11k tokens of undifferentiated prose → `task list --search memory --plain` 6,194 bytes / ~1.5k tokens of scannable one-line titles (**7×**), composable with `-l`, `-s`, `--limit`, `--sort`. Full 340-task list renders in 1.6 s. |
| Can't produce a ≤300-line session-start briefing | **CLEARED, better than specced** — **58 lines / ~2.9 KB (~725 tokens)** vs today's 44 KB hot surface: per-area counts, 20-oldest (the nudge's starvation dissolves — any slice is queryable on demand), 10-newest. Caveat: the council's "`--json` gives filtering" premise was wrong for v1.48.0 (`task list` has no `--json`) — moot, and better: the task files ARE the structured store; the digest generator parses frontmatter directly, offline, no CLI dependency. |

### Bonus findings

- **The directory collision closes**: `init --backlog-dir <path>` exists — the one wound left open by the research pass is a config flag.
- **The Q3 evidence the owner asked for**: `backlog doc create` + pasting the full system-model theme file verbatim → lives as `doc-1`, body untouched (no flattening), and the **shared search index spans tasks + documents + decisions in one query** with sane relevance ranking (`search "intent linkage"` → doc-1 top at 0.627). **Boundary recommendation: follow-ups → tasks, themes/ideas → docs — one store, one index, no split-brain, no flattening.** (Owner deferred this call to post-trial; not yet ratified.)
- `backlog browser` (web kanban) exists but is untested here (headless) — for the owner to poke at: `cd ~/Projects/backlog-md-trial && npx backlog.md browser`.
- Honest caveats: 16 rows got dates via an any-date fallback (may have grabbed a referenced date, not the surfaced date); mechanical titles are serviceable but truncation-shaped — the labeling pass should polish them; low-score noise hits appear in search output (ranked last, ignorable).

### What migration now consists of (if/when it executes)

1. Re-run the import script (it IS the migration tool) with `--backlog-dir` decided.
2. One agent labeling pass: area for the 154 unlabeled + size/priority fields + title polish.
3. The `06-backlog.md` rewrite (trigger-gating retirement rides here, per owner call #2).
4. Wire the digest generator into the session-start surface; retire `now.md`'s hand-maintained role.
5. Themes/ideas → `docs/` surface (pending owner ratification of the boundary).

## Next steps

1. ~~Ground candidates~~ ✅ · 2. ~~Council~~ ✅ (two passes) · 3. ~~Owner pass~~ ✅ **CLOSED 2026-07-26** (§ above).
4. ~~Retention PR-D~~ ✅ shipped (beta.177 — Phase 2 complete).
5. ~~Full shadow trial~~ ✅ **PASS 2026-07-26** (§ above). **The boulder is done.**
6. Per the ratified sequence: retention Phase 3 → system-model Phase 0 → **migration** (steps above) → drain campaign. Pending from the owner: ratify the follow-ups→tasks / themes→docs boundary.
