# Release Notification System

The release notification system automatically notifies authenticated users when a new version of the bot is deployed.

## Overview

When the bot starts up, it:
1. Checks the current version against the last notified version
2. Fetches release notes from GitHub (if a new version is detected)
3. Sends DMs to opted-in users based on their preferences
4. Records the notification to avoid duplicate messages

## User Experience

### Default Behavior
- Users are **opted in by default** to receive notifications for minor and major releases
- First-time users see clear opt-out instructions
- Users who don't interact with settings after receiving notifications are considered to have given implied consent

### Commands
```
!tz notifications status    # Check your current settings
!tz notifications off       # Opt out of all notifications
!tz notifications on        # Opt back in to notifications
!tz notifications level major  # Only major releases
!tz notifications level minor  # Minor + major releases (default)
!tz notifications level patch  # All releases including patches
```

### Notification Messages
The system sends personalized messages based on user history:
- **First notification**: "📌 First time receiving this? You're automatically opted in. Use !tz notifications off to opt out."
- **Subsequent notifications (no interaction)**: "✅ You're receiving these because you haven't opted out. Use !tz notifications off to stop."
- **After settings interaction**: "You can change your notification preferences with !tz notifications"

## Configuration

### GitHub API Authentication (Optional but Recommended)

The system works without authentication but has limitations:
- **Without auth**: 60 requests/hour per IP address
- **With auth**: 5,000 requests/hour

To enable authenticated access, set the `GITHUB_TOKEN` environment variable:

```bash
# Option 1: Set in .env file
GITHUB_TOKEN=your_github_personal_access_token

# Option 2: Set in environment
export GITHUB_TOKEN=your_github_personal_access_token

# Option 3: Set in Railway/deployment platform
# Add GITHUB_TOKEN to your environment variables
```

#### Creating a GitHub Token
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Tzurot Release Fetcher")
4. Select scopes:
   - For public repos: No scopes needed (just creates a token for rate limiting)
   - For private repos: Select `repo` scope
5. Generate and copy the token

### Configuration Options

The system can be configured when creating instances:

```javascript
// In src/core/notifications/index.js or initialization
const manager = new ReleaseNotificationManager({
  maxDMsPerBatch: 10,        // Users to notify per batch
  dmDelay: 1000,              // Delay between batches (ms)
  versionTracker: {
    staleDuration: 3600000,   // How old before refreshing (ms)
  },
  githubClient: {
    owner: 'lbds137',         // GitHub repo owner
    repo: 'tzurot',           // GitHub repo name
    githubToken: 'token',     // Optional: GitHub token
    cacheTTL: 3600000,        // Cache duration (ms)
  },
});
```

## Architecture

### Components

1. **VersionTracker** (`src/core/notifications/VersionTracker.js`)
   - Compares current version with last notified
   - Persists notification history
   - Determines change type (major/minor/patch)

2. **UserPreferencesPersistence** (`src/core/notifications/UserPreferencesPersistence.js`)
   - Stores user notification preferences
   - Tracks opt-out status and notification levels
   - Provides user filtering based on change type

3. **GitHubReleaseClient** (`src/core/notifications/GitHubReleaseClient.js`)
   - Fetches release information from GitHub API
   - Caches releases to minimize API calls
   - Parses release notes into categories

4. **ReleaseNotificationManager** (`src/core/notifications/ReleaseNotificationManager.js`)
   - Orchestrates the notification process
   - Creates personalized Discord embeds
   - Handles batch sending with rate limiting

### Data Storage

User preferences are stored in `data/releaseNotificationPreferences.json`:
```json
{
  "userId": {
    "optedOut": false,
    "notificationLevel": "minor",
    "lastNotified": "1.0.2",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-02T00:00:00.000Z"
  }
}
```

Version history is stored in `data/lastNotifiedVersion.json`:
```json
{
  "version": "1.0.2",
  "notifiedAt": "2024-01-01T00:00:00.000Z"
}
```

## Error Handling

The system handles various error scenarios gracefully:
- **DMs disabled**: Automatically opts out users who have DMs disabled
- **GitHub API errors**: Logs errors and continues without notifications
- **Missing releases**: Handles cases where GitHub release doesn't exist
- **Network failures**: Fails gracefully without crashing the bot

## Testing

Run tests with:
```bash
npm test tests/unit/core/notifications/
```

The system includes comprehensive tests for all components with injectable dependencies for deterministic testing.

## Monitoring

Monitor the system through logs:
- `[ReleaseNotificationManager]` - Main orchestration logs
- `[VersionTracker]` - Version comparison logs
- `[GitHubReleaseClient]` - API interaction logs
- `[UserPreferencesPersistence]` - Preference update logs

## Future Enhancements

Potential improvements for the future:
1. **Webhook notifications** - Post to announcement channels
2. **Rich media** - Include screenshots or GIFs in notifications
3. **Changelog aggregation** - Show all changes since user's last version
4. **Beta channel** - Opt-in for pre-release notifications
5. **Metrics tracking** - Analytics on opt-out rates and engagement