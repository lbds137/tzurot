## 📅 Next Theme: _open — to be picked next session_

The previous "Next Theme: CPD Clone Reduction" was **completed differently** by the 2026-05-16 campaign (5 PRs, #1038-1042) than its original "drive to <100 clones" framing — the campaign reframed the goal as **filtered-metric + CI ratchet + documented boundary** after three council models independently identified jscpd's raw count as a broken proxy in a well-abstracted codebase.

**Where the CPD work landed:**

- Close-out audit: [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../docs/reference/CPD_CAMPAIGN_AUDIT.md) — classification of all remaining clone pairs
- Helpers extracted: 7 thin helpers in `services/api-gateway/src/utils/configRouteHelpers.ts` + `normalizeConfigNameOnPromote.ts`
- Enforcement: `pnpm ops cpd:check` runs in CI lint job, baselined at `filteredLines=1752 + graceMargin=10`
- Documented boundary: `.claude/rules/02-code-standards.md` "Duplication, Helpers, and the CPD Ratchet" section + 2-callback ceiling rule

**Candidate next themes** (user to pick — each deserves its own council pass before plan-mode):

1. **Adjacent CPD follow-up campaigns** — see [`backlog/future-themes.md`](future-themes.md) → "Adjacent CPD Follow-Up Campaigns" — four independently-pickable mini-epics (service-layer parallel cleanup, override-route campaign, bot-client command-pattern, ai-worker voice providers)
2. **Self-Hosted TTS + BYOK Re-Eval** — Step-0 probes for OmniVoice / F5-TTS / CosyVoice (see `future-themes.md`)
3. **API Security Hardening** — rate limiter + helmet/CORS + slug-enumeration fix (see `future-themes.md`)
4. **Other future-themes** — see `backlog/future-themes.md` for the full queue

**For tomorrow's session-start**: read [`CURRENT.md`](../CURRENT.md) → [`backlog/quick-wins.md`](quick-wins.md) → pick from the candidates above OR sweep a quick-win first.

---

## Historical reference: CPD Clone Reduction (closed 2026-05-16)

The original phase-by-phase plan from when this was the queued Next Theme:

**Progress trajectory** (2026-04 through 2026-05-16):
175 → 127 (PRs #599, #665-#668); grew to 152 from features; PR #729 → 146; 2026-04-06 architecture day (PRs #766, #768, #769) → 137; PR #776 → 126; Session 1 (PRs #778, #779) → 118; PR #785 → 119; 2026-04-13 quick wins → 119; grew to 178 during the 2026-04 → 2026-05 TTS Epic; then the 2026-05-16 campaign (PRs #1038-1042) drove **raw count 178 → 113** (-65) and established the **filtered count metric at 109 / 1752 lines** as the actual enforcement target.

The original Phase 5-8 breakdown (dashboard patterns, command patterns, cross-service, ai-worker/tooling) was largely subsumed by the 2026-05-16 campaign's State-3 close-out — the work that's still left is documented as **deferred follow-up campaigns** in the audit doc and the future-themes umbrella entry. Future work picks up there with fresh council passes per-campaign rather than chasing the original phase list, which had absorbed assumptions that the council reviews invalidated.
