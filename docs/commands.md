# Tzurot Slash Command Reference

Complete reference for every `/` command Tzurot exposes in Discord. For a high-level overview of what the bot does, see the [project README](https://github.com/lbds137/tzurot#readme).

> **Convention**: subcommand groups (like `/voice tts`) are listed with their subcommands inline. Required argument prompts appear in the slash command UI; this reference focuses on what each command is for.

---

## Characters & Personas

| Command      | Subcommands                               | Purpose                                                |
| ------------ | ----------------------------------------- | ------------------------------------------------------ |
| `/character` | `create` `edit` `view` `browse`           | Manage AI characters                                   |
|              | `import` `export` `template`              | Character portability (JSON)                           |
|              | `chat` `avatar` `voice` `voice-clear`     | Interaction and per-character voice cloning enrollment |
|              | `settings` `overrides`                    | Per-character config and personal overrides            |
|              | `alias`                                   | Manage @mention aliases (list, add, remove)            |
| `/persona`   | `view` `edit` `create` `browse` `default` | User persona management                                |
|              | `override set` `override clear`           | Per-character persona overrides                        |

## Voice Configuration

TTS + STT provider selection and cloned-voice library lifecycle. Per-character TTS overrides cascade over user defaults; STT is user-scoped (your voice doesn't change per character).

| Command  | Subcommands                                    | Purpose                                                  |
| -------- | ---------------------------------------------- | -------------------------------------------------------- |
| `/voice` | `view <character>`                             | Resolved TTS + STT for a character (with cascade source) |
|          | `tts list set clear set-default clear-default` | Per-character + user-default TTS provider config         |
|          | `stt set clear`                                | Transcription provider preference (user-scoped)          |
|          | `voices browse delete clear`                   | Cloned-voice library lifecycle                           |

## Presets & Channels

| Command    | Subcommands                                 | Purpose                                                |
| ---------- | ------------------------------------------- | ------------------------------------------------------ |
| `/preset`  | `create` `edit` `browse`                    | Custom LLM presets (model + parameters)                |
|            | `export` `import` `template`                | Preset portability (JSON)                              |
|            | `global` (`default` `free-default`)         | System-wide defaults (owner only)                      |
| `/models`  | `browse` `view`                             | Browse and inspect available AI models (by capability) |
| `/channel` | `activate` `deactivate` `browse` `settings` | Channel auto-response management                       |

## Memory & History

| Command    | Subcommands                                        | Purpose                                            |
| ---------- | -------------------------------------------------- | -------------------------------------------------- |
| `/memory`  | `browse` `search` `stats`                          | Browse and search long-term memories               |
|            | `facts`                                            | Browse/correct facts a character learned about you |
|            | `delete` `purge`                                   | Memory management operations                       |
|            | `focus` (`enable` `disable` `status`)              | Temporarily disable LTM retrieval                  |
|            | `incognito` (`enable` `disable` `status` `forget`) | Privacy mode (no LTM writes)                       |
| `/history` | `clear` `stats` `undo` `hard-delete`               | Conversation history management                    |

## Settings & Tools

| Command          | Subcommands                                                   | Purpose                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/settings`      | `timezone` (`set` `get`)                                      | Timezone for timestamps                                                                                                                                                                                                                                                                                            |
|                  | `apikey` (`set` `browse` `remove` `test`)                     | BYOK API key management                                                                                                                                                                                                                                                                                            |
|                  | `preset` (`list` `set` `clear` `set-default` `clear-default`) | Per-character preset overrides                                                                                                                                                                                                                                                                                     |
|                  | `defaults` (`edit`)                                           | User default settings dashboard                                                                                                                                                                                                                                                                                    |
|                  | `data` (`export` `delete`)                                    | Data rights: export everything your account owns (ZIP, 24h link) or permanently erase the account (typed confirmation)                                                                                                                                                                                             |
| `/feedback`      | `message`                                                     | Send feedback to the developer — the bot's official contact channel alongside [GitHub issues](https://github.com/lbds137/tzurot/issues)                                                                                                                                                                            |
| `/notifications` | `view` `enable` `disable` `level` `cleanup`                   | Release-notes DM preferences — sent only to accounts that have actually used the bot, default level `major` (breaking releases only); levels come from release content (breaking→major, features→minor, fixes-only→patch); each new release DM replaces the previous one, and `cleanup` deletes them all on demand |
| `/shapes`        | `auth` `logout` `browse` `import` `export` `status`           | Shapes.inc character migration (legacy import)                                                                                                                                                                                                                                                                     |
| `/inspect`       | `[identifier]`                                                | Diagnostic log browser — omit to browse recent, provide to inspect specific                                                                                                                                                                                                                                        |
| `/help`          | _(optional command)_                                          | Show available commands                                                                                                                                                                                                                                                                                            |

## Administration (owner only)

| Command  | Subcommands                                                | Purpose                          |
| -------- | ---------------------------------------------------------- | -------------------------------- |
| `/admin` | `ping` `health` `servers` `kick` `usage`                   | Monitoring and management        |
|          | `cleanup` `db-sync` `settings` `presence` `stop-sequences` | Maintenance and configuration    |
| `/deny`  | `add` `remove` `browse` `view`                             | User and guild denial management |

> **`db-sync` deletion semantics**: hard deletes on synced tables PROPAGATE — deleting a row (preset, character, persona…) in either environment deletes it in the other on the next sync, instead of the old resurrect-from-the-other-side behavior. Corollary for one-off cleanup scripts: an accidental `DELETE` on one side now applies to both on the next sync (clear the matching `sync_tombstones` row to undo before syncing). Re-creating a row after deleting it wins over its tombstone.
