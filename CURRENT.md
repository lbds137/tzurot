# Current

> **Session**: 2026-03-04
> **Version**: v3.0.0-beta.87

---

## Session Goal

_Bugfix release: Discord custom ID overflow, security patch, interaction error resilience._

## Active Task

None — session complete.

---

## Completed This Session

- **fix(bot-client)**: Use UUID-only entityId in character settings/overrides custom IDs — was exceeding Discord's 100-char limit (`slug--uuid` → `uuid`, max 96 chars)
- **fix(deps)**: Patch tar hardlink path traversal vulnerability (GHSA #53) — override tar@<=7.5.9 to >=7.5.10 via pnpm overrides
- **fix(bot-client)**: Catch failed error replies on already-acknowledged interactions — prevents cascading DiscordAPIError[40060] in all 3 CommandHandler catch blocks

## Recent Releases

- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping
- **v3.0.0-beta.86** (2026-03-03) — LLM response quality fixes: stop sequence removal, leaked thinking detection+retry, vision fallback for multimodal models, reasoning capability gate, fallback model updates

## Next Steps

1. Continue CPD Clone Reduction (Phase 5: dashboard patterns)
2. Pull next item from Quick Wins or backlog

## CPD Epic Progress

| PR   | Phase          | Clones         | Delta         |
| ---- | -------------- | -------------- | ------------- |
| #599 | Phase 1        | 175 → 168      | -7            |
| #665 | Phase 2        | 168 → 155      | -13           |
| #666 | Phase 2 (cont) | included above | —             |
| #667 | Phase 3        | 155 → 146      | -9            |
| #668 | Phase 4        | 146 → 137      | -9            |
| #704 | Phase 6 (mem)  | 141 → 140      | -1            |
| —    | Target         | < 100          | -40 remaining |

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
