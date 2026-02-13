# Current

> **Session**: 2026-02-12
> **Version**: v3.0.0-beta.71 (preparing beta.72 release)

---

## Session Goal

_Release prep: `/inspect` command shipped, backlog cleaned, smoke testing before version bump._

## Active Task

Smoke test on dev before bumping to beta.72.

---

## Smoke Test Checklist (beta.72)

### Easy to verify

- [ ] `/inspect` (no args) — browse list appears with recent logs
- [ ] `/inspect` — select a log from browse, verify embed + buttons work
- [ ] `/inspect <message-link>` — look up a specific message's diagnostic log
- [ ] `/admin` — verify debug subcommand is gone (only settings, servers remain)
- [ ] `/preset edit` — set both reasoning_effort and max_tokens, verify warning appears on save
- [ ] `/preset browse` (as admin) — should show all presets, not just owned

### Verified by tests / low risk (skip manual)

- Vision cache validation, `<reactions>` XML stripping, empty response diagnostics — all covered by unit tests, triggered by specific model behaviors
- `OPENROUTER_APP_TITLE` — env var only, visible in OpenRouter dashboard
- Blank forwarded image fix — edge case in extended context formatting
- ESLint warning reduction — code quality only, no runtime impact

---

## Completed This Session

- [x] ✨ **Move `/admin debug` → `/inspect`** (PR #623) — new top-level command, non-admin users see only their own diagnostic logs, admin sees all
- [x] ✨ **Preset validation: reasoning effort vs max_tokens warning** — actionable message when both are set
- [x] 🏗️ **Access denial audit logging** — inspect lookup logs userId on access control rejections
- [x] 🏗️ **Backlog cleanup** — removed completed items, triaged inbox
- [x] ✅ **Preset Dashboard: `max_tokens` UX** — verified already fully wired: field in Core Sampling section, flatten/unflatten, validation warnings (low value + reasoning conflicts)
- [x] 🐛 **Fix ByteString crash with non-ASCII `X-Title` header** — sanitize `OPENROUTER_APP_TITLE` before setting HTTP header (Hebrew chars caused Fetch API crash)
- [x] 🏗️ **Backlog reorganization** — cleared prod issues (→ Deferred), triaged inbox, promoted Package Extraction epic, moved nice-to-haves to Icebox

## Recent Highlights

- **beta.71**: Vision pipeline robustness (PR #617), forwarded messages (PR #616), message link fix + quote unification (PR #619), stored reference hydration (PR #620), vision cache warmup (PR #621)
- **beta.70**: Dep updates, NaN guard on browse embed timestamps, UUID validation on personalityId filter
- **beta.68**: Zod Schema Hardening epic complete (5 phases, PRs #601–#603+) — zero `req.body as Type` casts remain

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
