### Theme: User-feedback solicitation + revive v2 release-notes delivery

_Focus: structured channel for soliciting feedback from non-direct-contact users — feedback today only arrives ad-hoc._

As broader UX issues come up (channel-activation behavior, voice handling, persona switching, etc.), a structured channel for hearing from users who aren't in direct contact with the operator would be valuable. Could double as the delivery path for the v2 release-notes feature (announce each release to interested users) that was lost in the v3 rewrite.

**Phases:**

1. **Opt-in/opt-out persistence** — likely a new column on the user row or a separate `user_preferences` table. Default-opt-in vs default-opt-out is the key design question.
2. **DM-blast job worker** — BullMQ scheduled job that iterates the opt-in cohort and sends a DM. Rate-limit-aware (Discord caps DMs from bots; bulk needs throttling). Idempotent retries on failure.
3. **`/admin broadcast` command surface** — bot-owner-only; accepts a message template + dry-run preview + opt-out compliance check before send.
4. **Release-notes integration** — wire the same delivery path to a CHANGELOG-driven announcement on release-PR merge (or manual trigger).

**Owner spec detail (ingested 2026-07-05 from notes-Discord cleanup — answers phase-1's key question)**: default is OPT-IN, opt-out via command, persisted. Granularity preference per user: notify on bugfix vs minor vs major version bumps (default: minor). Delivery mechanism sketch: bot stores last-announced version, compares against package.json at startup, DMs the delta's release notes on bump. Open sub-question from the note: fetching notes dynamically from the GitHub release tag (release notes already follow the machine-parseable Conventional Changelog format per `05-tooling.md` — that was built for exactly this).

**Promote when**: ready to ship a meaningful UX change that benefits from broad-base feedback, OR when re-implementing the release-notes delivery feature. Surfaced 2026-05-17 in personal notes. Triaged 2026-05-19 to future-themes.
