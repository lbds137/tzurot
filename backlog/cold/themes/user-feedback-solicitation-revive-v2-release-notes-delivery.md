### Theme: User-feedback solicitation + revive v2 release-notes delivery

_Focus: structured channel for soliciting feedback from non-direct-contact users — feedback today only arrives ad-hoc._

As broader UX issues come up (channel-activation behavior, voice handling, persona switching, etc.), a structured channel for hearing from users who aren't in direct contact with the operator would be valuable. Could double as the delivery path for the v2 release-notes feature (announce each release to interested users) that was lost in the v3 rewrite.

**Phases:**

1. **Opt-in/opt-out persistence** — likely a new column on the user row or a separate `user_preferences` table. Default-opt-in vs default-opt-out is the key design question.
2. **DM-blast job worker** — BullMQ scheduled job that iterates the opt-in cohort and sends a DM. Rate-limit-aware (Discord caps DMs from bots; bulk needs throttling). Idempotent retries on failure.
3. **`/admin broadcast` command surface** — bot-owner-only; accepts a message template + dry-run preview + opt-out compliance check before send.
4. **Release-notes integration** — wire the same delivery path to a CHANGELOG-driven announcement on release-PR merge (or manual trigger).

**Promote when**: ready to ship a meaningful UX change that benefits from broad-base feedback, OR when re-implementing the release-notes delivery feature. Surfaced 2026-05-17 in personal notes. Triaged 2026-05-19 to future-themes.
