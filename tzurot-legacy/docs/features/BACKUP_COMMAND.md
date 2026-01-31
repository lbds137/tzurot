# Backup Command

The backup command allows administrators to save personality data and memories from the AI service to local JSON files. It supports both token-based authentication and browser session cookies for maximum flexibility.

## Features

- **Full Profile Backup**: Saves complete personality configuration including all settings
- **Complete Chat History**: Backs up full conversation history using pagination (beyond 50-message limit)
- **Smart Memory Sync**: Only downloads new memories since last backup (handles reverse chronological order)
- **Knowledge & Training Data**: Captures knowledge base, training examples, and user personalization
- **Bulk Backup**: Backup all owner personalities with a single command
- **Individual Backup**: Target specific personalities
- **Incremental Updates**: Tracks last backup state to minimize API calls

## Usage

### Prerequisites

You must be authenticated with the AI service using browser session cookies:

**Browser Session Cookie Authentication**
```
!tz backup --set-cookie <cookie-value>
```

To get your session cookie:
1. Open the service website in your browser and log in
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies
4. Find the `appSession` cookie
5. Copy its value (the long string)
6. Use the command above (preferably in DMs for security)

### Commands

**Backup a single personality:**
```
!tz backup personality-name
```

**Backup all owner personalities:**
```
!tz backup --all
```

**Set browser session cookie:**
```
!tz backup --set-cookie <cookie-value>
```
⚠️ **Security Note:** Only use this command in DMs to avoid exposing your session cookie

## Data Storage

Backups are saved to `data/personalities/` with the following structure:
```
data/personalities/
├── personality-name/
│   ├── personality-name.json               # Full profile data
│   ├── personality-name_memories.json      # All memories in chronological order
│   ├── personality-name_messages.json      # Complete chat history (oldest to newest)
│   ├── personality-name_knowledge.json     # Knowledge base entries
│   ├── personality-name_training.json      # Training examples
│   ├── personality-name_user_data.json     # User personalization data
│   └── .backup-metadata.json              # Tracking info for incremental sync
```

### Memory Storage Format

- All memories are stored in a single `personality-name_memories.json` file
- Memories are sorted chronologically (oldest to newest)
- The system handles Unix timestamps (e.g., `"created_at": 1721828935.24231`)
- New memories are appended during incremental syncs

## Smart Memory Syncing

The backup system intelligently handles memory syncing:

1. **First Backup**: Downloads all memories and sorts them chronologically
2. **Subsequent Backups**: Only downloads and appends new memories
3. **Automatic Sorting**: Memories are explicitly sorted by timestamp, not relying on API order
4. **Deduplication**: Uses memory IDs to prevent duplicate entries
5. **Metadata Tracking**: Stores last memory timestamp and total count for efficient syncing

## Chat History Backup

The backup command now includes complete conversation history:

1. **Full History**: Uses undocumented `before_ts` parameter for pagination
2. **No Limits**: Retrieves messages beyond the standard 50-message API limit
3. **Chronological Order**: Stores messages from oldest to newest for easy reading
4. **Character Stats**: Shows total character count for backed-up conversations
5. **Incremental Ready**: Structured for future incremental backup support

## Rate Limiting

The command includes built-in delays between API requests to respect rate limits:
- 1 second between individual requests
- 2 seconds between different personalities during bulk backup

## Security

- Only administrators can use this command
- Uses session cookie authentication (token auth not supported for internal API)
- Session cookies can only be set in DM channels for security
- No sensitive data is logged (cookies are truncated in logs)
- Session cookies are stored in memory only (not persisted)

## Important Notes

- The backup command uses an undocumented internal API that doesn't support standard token authentication
- Only browser session cookies work for authentication
- This is designed specifically for backing up data before migrating away from the service

## Use Cases

1. **Pre-Migration Backup**: Before API pricing changes take effect
2. **Regular Backups**: Periodic snapshots of personality evolution
3. **Offline Development**: Work with personalities without API access
4. **Data Portability**: Export personalities for use in other systems
5. **Session-Based Services**: Backup from services that require browser authentication

## Configuration

The backup command uses these environment variables:
- `SERVICE_WEBSITE`: Base URL of the AI service
- `PROFILE_INFO_PRIVATE_PATH`: API path for authenticated profile access

## Standalone Backup Script

For bulk operations or automated backups, use the standalone script:

```bash
SERVICE_COOKIE="your-cookie-value" \
SERVICE_WEBSITE="https://service.example.com" \
PROFILE_INFO_PRIVATE_PATH="personalities/username" \
node scripts/backup-personalities-data.js personality1 personality2
```

### Script Features
- Direct file system access (no Discord required)
- Batch processing of multiple personalities
- Same chronological memory storage format
- Clear progress indicators
- Automatic cookie format handling

### Getting Your Cookie for the Script
1. Log into the service in your browser
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies
4. Find the `appSession` cookie
5. Copy its VALUE (not the whole cookie)
6. Use it in the `SERVICE_COOKIE` environment variable