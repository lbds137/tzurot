### Theme: First-Use Onboarding DM (+ data-training disclosure)

_Focus: send every user a one-time onboarding DM on first bot use — orienting them to core features and disclosing how free-tier model routing handles their data — via reusable "system DM" infrastructure that characters ignore and users can dismiss._

#### Why (captured 2026-07-02, user dictation)

**The trigger is a real policy/liability change already made in prod**: OpenRouter's account-level setting allowing free-model providers that **train on user data** has been DISABLED on the system API key (the key free users route through by default). Rationale: with awareness of the training-data implications now explicit, leaving it enabled for users who never consented is a Discord-ToS liability the platform can't carry — the bot must not be bannable over data handling users never agreed to.

**Operational consequence to watch** (live NOW, independent of this theme): the free-model router now has slimmer pickings — only non-training free providers. Expect lower quality and possibly more free-tier routing failures. The beta.144 compound-fallback-error work means double-failures at least surface fully; if free-tier failure rates climb in prod logs, that's this setting's footprint.

**The disclosure principle**: models that train on user data are never enabled by default by the system. Users who bring their own API key / OpenRouter account decide their own settings — that's their business, not the platform's. The onboarding DM is where this is communicated so the policy is visible, not just true.

#### Design sketch (from the dictation — needs proper scoping)

1. **First-use flag on the user row** — e.g. `users.onboardedAt` (nullable timestamp, state-machine pattern per `03-database.md` null-semantics). Sent once; set on send.
2. **Backfill semantics**: when the feature ships, existing users get the flag CLEARED — everyone sees the onboarding DM on their next use, not just brand-new users.
3. **System-DM hygiene** (the can of worms, and the reusable part):
   - The DM must not pollute character conversations: **characters must ignore system messages** (it's from the system, not a persona — the context builders need to filter it or it needs a shape they already skip).
   - It needs a lifecycle: **self-destruct after a while, or a way to clear it**. v2 had a command to clear ONLY system messages (not character messages) from the bot DM — still in the v2 archive in-repo; port candidate.
4. **Content**: orientation to what users care about doing (getting started with characters, BYOK existing and what it unlocks) + the data-training disclosure above.

#### Relationship to other themes

- [`user-feedback-solicitation-revive-v2-release-notes-delivery.md`](user-feedback-solicitation-revive-v2-release-notes-delivery.md) — release-notes DMs are the SAME system-DM class (characters-ignore + clearable). Whichever theme goes first should build the shared system-DM primitive; the other consumes it.
- The broader "port the remaining v2 features, then get rid of v2 for good" umbrella the user has mentioned — this + release notifications are both members. If more v2-port members accumulate, consider a dedicated umbrella theme.

#### Phases (rough)

### Phase 1 — System-DM primitive

- [ ] Message shape/marker that context builders skip (characters never see system DMs)
- [ ] Lifecycle: TTL self-delete or a clear command (port the v2 system-message-clear from the archive)

### Phase 2 — Onboarding flag + send

- [ ] `users.onboardedAt` (migration, null-semantics doc comment)
- [ ] First-use detection point (user-provisioning path?) → send + stamp
- [ ] Ship-time backfill: flag cleared for all existing users

### Phase 3 — Content

- [ ] Orientation copy + the data-training/BYOK disclosure
