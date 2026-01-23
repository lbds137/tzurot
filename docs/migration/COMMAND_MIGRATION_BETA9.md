# Command Migration Guide - v3.0.0-beta.9

> **⚠️ HISTORICAL DOCUMENT**: This guide was written for v3.0.0-beta.9. The current version is beta.46+. These command renames have been in effect since November 2025 and are no longer "new". Kept for reference only.

This guide documents the slash command changes in v3.0.0-beta.9. Users familiar with previous beta versions should review this to update their workflows.

## Command Renames

### Profile and Settings Commands

The `/profile`, `/model`, and `/settings` commands have been consolidated under the `/me` command group for better organization.

| Old Command          | New Command            | Description                            |
| -------------------- | ---------------------- | -------------------------------------- |
| `/profile`           | `/me profile`          | View or edit your personal profile     |
| `/profile view`      | `/me profile view`     | View your profile                      |
| `/profile edit`      | `/me profile edit`     | Edit your profile                      |
| `/profile override`  | `/me profile override` | Set a profile override for a character |
| `/model`             | `/me model`            | View or change your AI model settings  |
| `/model view`        | `/me model view`       | View current model settings            |
| `/model set`         | `/me model set`        | Set your preferred model               |
| `/settings timezone` | `/me timezone`         | Set your timezone                      |

### Character Management Commands

The `/personality` command has been renamed to `/character` for clarity.

| Old Command           | New Command         | Description                |
| --------------------- | ------------------- | -------------------------- |
| `/personality list`   | `/character list`   | List all your characters   |
| `/personality create` | `/character create` | Create a new character     |
| `/personality edit`   | `/character edit`   | Edit an existing character |
| `/personality view`   | `/character view`   | View character details     |
| `/personality delete` | `/character delete` | Delete a character         |

### Model Preset Commands

The `/llm-config` command has been renamed to `/preset` for simplicity.

| Old Command          | New Command      | Description             |
| -------------------- | ---------------- | ----------------------- |
| `/llm-config list`   | `/preset list`   | List available presets  |
| `/llm-config create` | `/preset create` | Create a new preset     |
| `/llm-config edit`   | `/preset edit`   | Edit an existing preset |
| `/llm-config view`   | `/preset view`   | View preset details     |
| `/llm-config delete` | `/preset delete` | Delete a preset         |

## Why These Changes?

1. **Better Organization**: Grouping personal settings under `/me` makes it clearer these affect your personal experience
2. **User-Friendly Names**: `/character` is more intuitive than `/personality` for AI personas
3. **Consistency**: `/preset` is shorter and more descriptive than `/llm-config`

## Autocomplete Support

All commands support autocomplete:

- Character names autocomplete when typing
- Preset names autocomplete when selecting
- Timezone names autocomplete with search

## Migration Notes

- **No data migration required**: Your existing profiles, characters, and presets remain intact
- **Old commands removed**: The old command names are no longer available
- **Discord may cache old commands**: If you see old commands, wait a few minutes or restart Discord

## Need Help?

If you encounter issues with the new commands, please report them on [GitHub Issues](https://github.com/lbds137/tzurot/issues).
