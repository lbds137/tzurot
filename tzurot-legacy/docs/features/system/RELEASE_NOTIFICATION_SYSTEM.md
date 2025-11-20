# Release Notification System

This document provides comprehensive documentation for Tzurot's release notification system, which automatically notifies users when new versions are deployed.

## Table of Contents

1. [Overview](#overview)
2. [User Experience](#user-experience)
3. [Architecture](#architecture)
4. [Setup and Configuration](#setup-and-configuration)
5. [How It Works](#how-it-works)
6. [Webhook Integration](#webhook-integration)
7. [Testing and Monitoring](#testing-and-monitoring)
8. [Troubleshooting](#troubleshooting)

## Overview

The release notification system provides two complementary methods for notifying users about new releases:

1. **Webhook-triggered notifications** (immediate, preferred)
2. **Startup-triggered notifications** (fallback for missed webhooks)

This dual approach ensures users are notified regardless of timing issues between GitHub releases and bot deployments.

## User Experience

### Default Behavior

- Users are **opted in by default** to receive notifications for minor and major releases
- First-time users see clear opt-out instructions
- Users who don't interact with settings after receiving notifications are considered to have given implied consent

### Commands

```
!tz notifications status     # Check your current settings
!tz notifications off        # Opt out of all notifications
!tz notifications on         # Opt back in to notifications
!tz notifications level major  # Only major releases
!tz notifications level minor  # Minor + major releases (default)
!tz notifications level patch  # All releases including patches
```

### Notification Messages

The system sends personalized messages based on user history:

- **First notification**: "📌 First time receiving this? You're automatically opted in. Use !tz notifications off to opt out."
- **Subsequent notifications (no interaction)**: "✅ You're receiving these because you haven't opted out. Use !tz notifications off to stop."
- **After settings interaction**: "You can change your notification preferences with !tz notifications"

## Architecture

### Core Components

1. **ReleaseNotificationManager** (`src/core/notifications/ReleaseNotificationManager.js`)
   - Orchestrates the entire notification process
   - Handles user filtering and message sending
   - Integrates with both webhook and startup triggers

2. **VersionTracker** (`src/core/notifications/VersionTracker.js`)
   - Compares current version with last notified version
   - Persists notification history to prevent duplicates
   - Determines change type (major/minor/patch)

3. **UserPreferencesPersistence** (`src/core/notifications/UserPreferencesPersistence.js`)
   - Stores user notification preferences
   - Tracks opt-out status and notification levels
   - Provides user filtering based on change type

4. **GitHubReleaseClient** (`src/core/notifications/GitHubReleaseClient.js`)
   - Fetches release information from GitHub API
   - Parses release notes and categorizes changes
   - Handles authentication and rate limiting

5. **Webhook Server** (`src/webhookServer.js`)
   - Runs on separate port from main health check server
   - Handles incoming GitHub webhooks securely
   - Triggers immediate notifications upon release

### Data Flow

```
GitHub Release → Webhook → Bot → Check Users → Send DMs
       ↓
   Startup Check → Compare Versions → Notify Missing Users
```

## Setup and Configuration

### Basic Configuration

Set these environment variables:

```bash
# GitHub API (Optional but recommended for rate limiting)
GITHUB_TOKEN=your_github_personal_access_token

# Webhook integration (Required for immediate notifications)
GITHUB_WEBHOOK_SECRET=your_generated_secret_here
WEBHOOK_PORT=3001  # Optional, defaults to 3001
```

### GitHub Integration

#### 1. GitHub API Token (Recommended)

**Benefits**: 5,000 requests/hour vs 60/hour without authentication

**Setup**:
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Tzurot Release Fetcher")
4. Select scopes:
   - For public repos: No scopes needed (just for rate limiting)
   - For private repos: Select `repo` scope
5. Copy the token and set `GITHUB_TOKEN` environment variable

#### 2. Webhook Configuration (Immediate Notifications)

**Generate webhook secret**:
```bash
# Using OpenSSL
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Configure GitHub webhook**:
1. Go to repository Settings → Webhooks → Add webhook
2. Configure:
   - **Payload URL**: `https://your-bot-domain.railway.app/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: Use your generated secret
   - **Events**: Select "Releases" only
   - **Active**: ✓ Enabled

### Deployment Configuration

For Railway deployment:

```bash
# Add to Railway environment variables
GITHUB_TOKEN=your_github_token
GITHUB_WEBHOOK_SECRET=your_webhook_secret
```

### Advanced Configuration

```javascript
// Customizable options when initializing
const manager = new ReleaseNotificationManager({
  maxDMsPerBatch: 10,        // Users to notify per batch
  dmDelay: 1000,             // Delay between batches (ms)
  versionTracker: {
    staleDuration: 3600000,  // How long before refreshing (ms)
  },
  githubClient: {
    owner: 'lbds137',        // GitHub repo owner
    repo: 'tzurot',          // GitHub repo name
    githubToken: 'token',    // Optional: GitHub token
    cacheTTL: 3600000,       // Cache duration (ms)
  },
});
```

## How It Works

### Notification Triggers

#### 1. Webhook-triggered (Immediate)

1. GitHub release is published
2. GitHub sends webhook to bot
3. Webhook server verifies signature (HMAC-SHA256)
4. Triggers `ReleaseNotificationManager.checkAndNotify()`
5. Users are notified immediately

#### 2. Startup-triggered (Fallback)

1. Bot starts up after deployment
2. Compares `package.json` version with last notified version
3. Fetches release notes if version changed
4. Notifies users who haven't been notified yet

### Notification Process

1. **Version Check**: Compare current vs last notified version
2. **User Filtering**: Get opted-in users based on release type
3. **Batch Processing**: Send DMs in batches to avoid rate limits
4. **Record Keeping**: Update notification history to prevent duplicates

### User Preference Handling

| Preference Level | Major (1.0.0) | Minor (1.1.0) | Patch (1.0.1) |
|------------------|----------------|----------------|----------------|
| `major`          | ✅ Notify      | ❌ Skip        | ❌ Skip        |
| `minor`          | ✅ Notify      | ✅ Notify      | ❌ Skip        |
| `patch`          | ✅ Notify      | ✅ Notify      | ✅ Notify      |
| `off`            | ❌ Skip        | ❌ Skip        | ❌ Skip        |

## Webhook Integration

### Security Features

- **Signature Verification**: All webhooks verified using HMAC-SHA256
- **Secret Management**: Webhook secret stored securely in environment variables
- **Method Restrictions**: Only POST requests accepted on webhook endpoint

### Webhook Payload Processing

GitHub sends payloads like this for release events:

```json
{
  "action": "published",
  "release": {
    "tag_name": "v1.1.0",
    "name": "Version 1.1.0",
    "body": "## Added\n- New feature\n\n## Fixed\n- Bug fix",
    "published_at": "2023-12-01T10:00:00Z"
  },
  "repository": {
    "name": "tzurot",
    "full_name": "lbds137/tzurot"
  }
}
```

The bot processes this by:
1. Verifying the webhook signature
2. Extracting release information
3. Triggering the notification system
4. Running notifications in background (non-blocking)

## Testing and Monitoring

### Manual Testing

#### Test Webhook Endpoint

```bash
# Test webhook endpoint is accessible
curl -X POST https://your-bot-domain.railway.app/webhook/github

# Should return: "Missing signature" (expected for unsigned request)
```

#### Test Notification System

```javascript
// In bot console or test script
const manager = new ReleaseNotificationManager();
await manager.checkAndNotify();
```

### Logs and Monitoring

The system logs important events:

```javascript
// Successful notification
logger.info('[ReleaseNotificationManager] Successfully notified X users about version Y');

// Webhook received
logger.info('[WebhookServer] Received GitHub release webhook for version X');

// User preference changes
logger.info('[UserPreferences] User X changed notification level to Y');
```

### Testing Commands

```bash
# Check notification status
!tz notifications status

# Test notification preferences
!tz notifications level patch
!tz notifications off
!tz notifications on
```

## Troubleshooting

### Common Issues

#### Webhook Not Triggering

1. **Check webhook configuration**:
   - Verify payload URL is correct
   - Ensure secret matches environment variable
   - Confirm "Releases" event is selected

2. **Check bot logs**:
   ```bash
   # Look for webhook reception logs
   grep "Received GitHub release webhook" logs
   ```

3. **Test webhook endpoint**:
   ```bash
   curl -X POST https://your-domain.railway.app/webhook/github
   ```

#### Notifications Not Sent

1. **Check version comparison**:
   - Ensure `package.json` version changed
   - Verify version format is valid semver

2. **Check user preferences**:
   - Users might have opted out
   - Release type might not match user preferences

3. **Check GitHub API**:
   - Verify `GITHUB_TOKEN` is valid
   - Check rate limit status

#### Duplicate Notifications

- **Normal behavior**: The system should prevent duplicates
- **If occurring**: Check VersionTracker persistence and logs

### Debug Commands

```javascript
// Check current version tracking
const tracker = new VersionTracker();
console.log(await tracker.getCurrentVersion());
console.log(await tracker.getLastNotifiedVersion());

// Check user preferences
const prefs = new UserPreferencesPersistence();
console.log(await prefs.getUsersForNotification('minor'));
```

### GitHub Webhook Debugging

1. **GitHub webhook delivery tab**: Check delivery history and responses
2. **Bot webhook logs**: Monitor for signature verification issues
3. **Network issues**: Ensure Railway/deployment platform allows incoming webhooks

## Workflow Integration

### Development to Deployment

1. **Development**:
   - Create feature/fix on branch
   - Create PR to `develop`
   - Merge after review

2. **Release**:
   - Create release branch from `develop`
   - Update version in `package.json`
   - Update `CHANGELOG.md`
   - Create PR to `main`
   - Merge PR

3. **Deployment & Notifications**:
   - Railway automatically deploys from `main`
   - Create GitHub release with tag (e.g., `v1.1.0`)
   - GitHub sends webhook to bot
   - Bot immediately processes and sends notifications
   - Users receive DMs within seconds

This dual-trigger system ensures reliable notifications regardless of timing between GitHub releases and bot deployments.