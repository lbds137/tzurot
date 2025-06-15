# Backup Command

The backup command allows administrators to save personality data and memories from the AI service to local JSON files.

## Features

- **Full Profile Backup**: Saves complete personality configuration including all settings
- **Smart Memory Sync**: Only downloads new memories since last backup (handles reverse chronological order)
- **Bulk Backup**: Backup all owner personalities with a single command
- **Individual Backup**: Target specific personalities
- **Incremental Updates**: Tracks last backup state to minimize API calls

## Usage

### Prerequisites

You must be authenticated with the AI service:
```
!tz auth <your-token>
```

### Commands

**Backup a single personality:**
```
!tz backup personality-name
```

**Backup all owner personalities:**
```
!tz backup --all
```

## Data Storage

Backups are saved to `data/personalities/` with the following structure:
```
data/personalities/
├── personality-name/
│   ├── personality-name.json     # Full profile data
│   ├── .backup-metadata.json     # Tracking info for incremental sync
│   └── memory/
│       ├── personality-name_memory_1.json
│       ├── personality-name_memory_2.json
│       └── ...
```

## Smart Memory Syncing

The backup system intelligently handles memory syncing:

1. **First Backup**: Downloads all memories
2. **Subsequent Backups**: Only downloads memories newer than the last sync
3. **Reverse Chronological Handling**: Correctly processes API's reverse order (newest first)
4. **Metadata Tracking**: Stores last memory ID and total count for efficient syncing

## Rate Limiting

The command includes built-in delays between API requests to respect rate limits:
- 1 second between individual requests
- 2 seconds between different personalities during bulk backup

## Security

- Only administrators can use this command
- Requires valid authentication token
- No sensitive data is logged

## Use Cases

1. **Pre-Migration Backup**: Before API pricing changes take effect
2. **Regular Backups**: Periodic snapshots of personality evolution
3. **Offline Development**: Work with personalities without API access
4. **Data Portability**: Export personalities for use in other systems