# Backlog substrate — is markdown the wrong data structure?

**Status**: DRAFT — grounding captured 2026-07-25, pre-compaction. Not yet councilled, no owner decisions taken.

**Owner directive (2026-07-25)**: _"I am starting to feel frustration with our current backlog scheme yet again, even though we've gone through multiple reorganizations to try to make it more tameable. really wishing we had a mini Jira without the Atlassian bullshit."_

---

## The claim this artifact tests

Three reorganizations have not made the backlog tractable because **reorganizing does not change the substrate**. Every rule we have built — the admission bar, the granularity ladder, the three removal exits, the HOT/COLD file split, the section caps, the aging nudge — is a **schema and a query planner, written as prose, executed by hand**.

If that framing is right, a fourth reorganization also fails, and the real question is what the records should live in.

## Grounding: what 2026-07-25 actually cost

Captured while fresh. This is the evidence the council brief should carry.

### Measurements (reproducible by grep)

| | value |
| --- | ---: |
| `cold/follow-ups.md` data rows (after two relocation passes) | **342** |
| rows carrying a `Promote when:` trigger | 338 |
| …whose trigger is **"next time someone touches X"** | **118 (35%)** |
| theme files that could own rows | 28 |
| rows relocated in two passes (UX + memory) | 18 |

The 118 matter most. Per the admission bar — a rule we shipped *that same morning* — "next time someone touches this" resolves to **never**, because nobody greps a 342-row table before unrelated work. Those rows are not waiting; they are **stranded**. They exist because they were filed under a rule that permitted an unobservable trigger, and there is no way to *filter on trigger type* to find them systematically.

### Failure evidence (the part that is hard to argue with)

**The agent got the query method wrong three separate times in one session**, on a corpus read that same morning, with a written warning against that exact error in front of it:

1. Whole-row keyword pass for a "jobs/queue" cluster → 60+ rows including STT transcripts and file-naming conventions. The drain theme **explicitly documents having tried and rejected this method**. Repeated anyway.
2. "Exhaustive" sweep for a dead symbol run with `--include=*.md --include=*.ts` → missed `codecov.yml` entirely. A file-type filter on an exhaustive sweep.
3. Classified a whole *file* as historical prose when lines 8, 12, and 18 of it were three different kinds of claim — one of them a live, wrong, present-tense assertion about what a CI guard enforces.

Each was caught by a reviewer or the owner, not by any mechanism.

**And a fourth, structural**: a follow-up row was filed with an opportunistic trigger *twenty minutes after* measuring that opportunistic triggers never fire. The owner caught it. Nothing else could have.

### The relocation finding (why "just sweep it" is not the answer)

Two relocation passes moved 18 epic-scoped rows into the theme files that own them. **The method does not generalize.**

- **UX worked** because UX rows carry unambiguous markers: `§2.3`, `Wave 3`, `PR-4`, `CATALOG.error`. 15 candidates → 9 kept.
- **Memory failed the same approach** — "memory" is simultaneously the feature, the RAM, and the retrieval subsystem, so a keyword pass returned 80+ rows of noise (Pocket TTS "memory savings", vision error "recall"). It only worked by falling back to the epic's own slice vocabulary (`1b council deferral D`, `slice 4a`, `FactStore`). 10 candidates → 9 kept, 1 rejected as belonging to the quota epic.

So relocation is **per-epic archaeology whose precision depends on whether that epic happened to leave distinctive strings in prose months ago**. There are 26 more theme files. That is not a repeatable process.

### What relocation does and does not buy

It does **not** reduce work — the rows still exist, moved. It makes work **legible**: a row triggered by "when UX wave 7 ships" is stranded in a flat table and actionable in the epic's file. Same trigger, opposite outcome, purely from location.

That is itself evidence for the substrate claim: the *only* thing that changed was which file the record sat in.

## Candidate directions (none evaluated yet)

1. **GitHub Issues** — the owner already has it, no Atlassian. Labels ≈ the granularity ladder; milestones ≈ themes; `gh issue list --label` ≈ every regex fumbled above; native PR↔issue closing links would mechanize the release-time sweep that keeps getting missed.
2. **Structured markdown + tooling** — frontmatter/fields per row, `pnpm ops backlog query --trigger=opportunistic`. Keeps git-native storage and session-start loading; requires building and maintaining the query layer.
3. **Stay put, invest in guards** — accept the substrate, add mechanical checks for the specific failure classes (a lint that rejects opportunistic triggers at filing time, etc.).
4. Something else the council proposes.

## The one genuine objection to (1)

**The markdown backlog is loaded into agent context at session start.** `backlog/now.md` + `active-epic.md` + `references.md` are read every session; that is why this substrate was chosen and it is not a small thing. Issues are not loaded.

Mitigations exist (a generated digest written into the hot file; `gh issue list` at session start) but each has a cost, and **this is the objection the council brief must lead with** rather than bury — a design that quietly degrades session-start context would trade a visible problem for an invisible one.

## Open calls (for council, then owner)

- **a.** Is the substrate diagnosis correct, or is this a discipline problem being blamed on tooling?
- **b.** If a tracker: GitHub Issues, or structured-markdown-plus-tooling? What breaks in each?
- **c.** How does session-start agent context work post-migration, concretely?
- **d.** What happens to the rules that exist only to compensate for the substrate (HOT/COLD, caps, the ladder, the aging nudge)? Do they retire, or port?
- **e.** Migration cost for 342 rows, and is a partial migration coherent (e.g. themes stay markdown, follow-ups become issues) or does splitting make it worse?
- **f.** The 118 stranded rows: does the new substrate change their disposition, or do they need a decision regardless?

## Next session must

1. Load `/tzurot-design-boulder` and `/tzurot-council-mcp` (verify the model roster via `list_models` — IDs drift).
2. Ground candidates 1–3 against real constraints before drafting — do not council a vision statement.
3. Council the open calls above, then one batched owner pass.
4. Landing = ACCEPTED status + absorption wiring per the boulder skill.

**Do not start migrating anything before (3).**
