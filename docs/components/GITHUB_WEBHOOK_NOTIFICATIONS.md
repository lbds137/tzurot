# GitHub Webhook Notifications

This document describes the GitHub webhook integration that allows Tzurot to send release notifications immediately when a new GitHub release is published.

## Overview

The webhook system solves the timing issue where release notifications might be missed if the GitHub release is created after the bot has already started. Instead of only checking at startup, the bot can receive a webhook from GitHub when a release is published and immediately send notifications.

## Architecture

### Components

1. **Webhook Server** (`src/webhookServer.js`)
   - Runs on a separate port from the health check server (default: 3001)
   - Handles incoming webhooks from GitHub
   - Verifies webhook signatures for security
   - Triggers the release notification system

2. **Integration with Release Notifications**
   - Uses the existing `ReleaseNotificationManager`
   - Calls `checkAndNotify()` when a release webhook is received
   - Runs notifications in the background (non-blocking)

### Security

- **Signature Verification**: All GitHub webhooks are verified using HMAC-SHA256
- **Secret Management**: The webhook secret is stored in environment variables
- **Method Restrictions**: Only POST requests are accepted on the webhook endpoint

## Setup

### 1. Generate a Webhook Secret

Generate a secure random secret:

```bash
# Using OpenSSL
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Configure Environment Variables

Add to your `.env` file:

```env
GITHUB_WEBHOOK_SECRET=your_generated_secret_here
WEBHOOK_PORT=3001  # Optional, defaults to 3001
```

### 3. Configure GitHub Webhook

1. Go to your repository settings on GitHub
2. Navigate to **Settings** → **Webhooks** → **Add webhook**
3. Configure the webhook:
   - **Payload URL**: `https://your-bot-domain.railway.app/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: Use the same secret from your `.env` file
   - **Which events?**: Select "Let me select individual events"
     - Check only: **Releases**
   - **Active**: ✓ Check this box

### 4. Railway Configuration

If deploying on Railway:

1. Add the webhook secret to your Railway variables:
   ```
   GITHUB_WEBHOOK_SECRET=your_generated_secret_here
   ```

2. Ensure the webhook port is exposed (Railway typically handles this automatically)

## Workflow

1. **Development**:
   - Create feature/fix on a branch
   - Create PR to `develop`
   - Merge to `develop` after review

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
   - No timing issues!

## Webhook Payload

GitHub sends a payload like this for release events:

```json
{
  "action": "published",
  "release": {
    "tag_name": "v1.1.0",
    "name": "Version 1.1.0",
    "body": "Release notes here...",
    "draft": false,
    "prerelease": false,
    "created_at": "2024-06-05T12:00:00Z",
    "published_at": "2024-06-05T12:05:00Z"
  },
  "repository": {
    "name": "tzurot",
    "full_name": "user/tzurot"
  }
}
```

## Testing

### Local Testing

1. **Start the bot with webhook server**:
   ```bash
   npm run dev
   ```

2. **Use ngrok for local testing** (optional):
   ```bash
   ngrok http 3001
   ```
   Then use the ngrok URL for your GitHub webhook

3. **Simulate a webhook**:
   ```bash
   # Calculate signature
   PAYLOAD='{"action":"published","release":{"tag_name":"v1.0.0"}}'
   SECRET='your-secret'
   SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')
   
   # Send webhook
   curl -X POST http://localhost:3001/webhook/github \
     -H "Content-Type: application/json" \
     -H "X-GitHub-Event: release" \
     -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
     -d "$PAYLOAD"
   ```

### Production Testing

1. Create a test release on GitHub
2. Check bot logs for webhook receipt
3. Verify notifications were sent to opted-in users

## Monitoring

Check logs for webhook activity:

```
[WebhookServer] Webhook server running on port 3001
[WebhookServer] GitHub webhook authentication enabled
[WebhookServer] Received GitHub release webhook for: v1.1.0
[WebhookServer] Successfully triggered notifications for v1.1.0 to 5 users
```

## Troubleshooting

### Webhook Not Received

1. **Check GitHub webhook delivery**:
   - Go to Settings → Webhooks → Your webhook
   - Check "Recent Deliveries" tab
   - Look for response codes and errors

2. **Verify Railway URL**:
   - Ensure the webhook URL matches your Railway deployment
   - Check that the webhook port is accessible

3. **Check signature**:
   - Verify `GITHUB_WEBHOOK_SECRET` matches in both GitHub and Railway
   - Look for "Invalid signature" errors in logs

### Notifications Not Sent

1. **Check notification system**:
   - Verify `ReleaseNotificationManager` is initialized
   - Check for errors in `checkAndNotify()`
   - Ensure version in `package.json` matches the release tag

2. **Check user preferences**:
   - Verify users are opted in
   - Check notification levels match release type

## Benefits

1. **No Race Conditions**: Notifications work regardless of deployment timing
2. **Immediate Delivery**: Users get notified as soon as release is published
3. **Reliable**: GitHub retries failed webhook deliveries
4. **Secure**: Cryptographic signature verification
5. **Flexible**: Can trigger other actions from GitHub events in the future