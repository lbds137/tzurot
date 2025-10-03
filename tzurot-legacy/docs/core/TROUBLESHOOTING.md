# Troubleshooting Guide

This guide helps diagnose and resolve common issues with Tzurot. If you can't find a solution here, please check the [GitHub Issues](https://github.com/lbds137/tzurot/issues) or open a new discussion.

## Table of Contents

- [Bot Issues](#bot-issues)
  - [Bot Won't Start](#bot-wont-start)
  - [Bot Not Responding](#bot-not-responding)
  - [Bot Crashes Frequently](#bot-crashes-frequently)
- [Command Issues](#command-issues)
  - [Commands Not Working](#commands-not-working)
  - [Permission Errors](#permission-errors)
  - [Command Timeouts](#command-timeouts)
- [Personality Issues](#personality-issues)
  - [Can't Add Personalities](#cant-add-personalities)
  - [Personalities Not Responding](#personalities-not-responding)
  - [Wrong Avatar/Display Name](#wrong-avatardisplay-name)
- [Authentication Issues](#authentication-issues)
  - [Authentication Failed](#authentication-failed)
  - [Token Expired](#token-expired)
  - [Can't Submit Auth Code](#cant-submit-auth-code)
- [Webhook Issues](#webhook-issues)
  - [Webhook Creation Failed](#webhook-creation-failed)
  - [Messages Not Using Webhooks](#messages-not-using-webhooks)
  - [Webhook Rate Limits](#webhook-rate-limits)
- [Connection Issues](#connection-issues)
  - [Discord Connection Lost](#discord-connection-lost)
  - [API Connection Failed](#api-connection-failed)
  - [Network Timeouts](#network-timeouts)
- [Performance Issues](#performance-issues)
  - [High Memory Usage](#high-memory-usage)
  - [Slow Response Times](#slow-response-times)
  - [Message Delays](#message-delays)
- [Development Issues](#development-issues)
  - [Tests Failing](#tests-failing)
  - [Lint Errors](#lint-errors)
  - [Module Not Found](#module-not-found)
- [Diagnostic Commands](#diagnostic-commands)
- [Log Analysis](#log-analysis)
- [Getting Help](#getting-help)

## Bot Issues

### Bot Won't Start

#### Symptoms
- Bot process exits immediately
- Error messages on startup
- No "Bot is ready!" message

#### Common Causes & Solutions

1. **Missing Environment Variables**
   ```bash
   # Check if .env file exists
   ls -la .env
   
   # Verify required variables are set
   grep -E "DISCORD_TOKEN|SERVICE_API_KEY" .env
   ```
   
   **Solution**: Copy `.env.example` to `.env` and fill in all required values.

2. **Invalid Discord Token**
   ```
   Error: An invalid token was provided.
   ```
   
   **Solution**: 
   - Verify token in Discord Developer Portal
   - Regenerate token if compromised
   - Ensure no extra spaces or quotes in `.env`

3. **Node.js Version**
   ```bash
   node --version  # Should be 16.0.0 or higher
   ```
   
   **Solution**: Update Node.js to version 16 or higher.

4. **Missing Dependencies**
   ```
   Error: Cannot find module 'discord.js'
   ```
   
   **Solution**:
   ```bash
   npm install
   # or for production
   npm ci --production
   ```

### Bot Not Responding

#### Symptoms
- Bot shows as online but doesn't respond
- Commands don't work
- No reaction to mentions

#### Diagnostic Steps

1. **Check Bot Status**
   ```
   !tz ping
   !tz status
   ```

2. **Verify Permissions**
   - Bot needs "View Channels" and "Send Messages"
   - Check channel-specific permissions
   - Ensure bot role isn't below @everyone

3. **Check Prefix**
   - Default prefix is `!tz`
   - Verify in `.env` file: `PREFIX=!tz`

4. **Message Content Intent**
   - Required for bot to read messages
   - Enable in Discord Developer Portal:
     - Bot Settings → Privileged Gateway Intents → Message Content Intent

### Bot Crashes Frequently

#### Common Causes

1. **Memory Issues**
   - Monitor with `!tz status` command
   - Check system resources: `free -h`
   - Consider increasing Node.js memory limit:
     ```bash
     node --max-old-space-size=1024 index.js
     ```

2. **Unhandled Promises**
   - Check logs for "UnhandledPromiseRejection"
   - Update to latest version
   - Report persistent issues

3. **Rate Limiting**
   - Look for 429 errors in logs
   - Implement proper rate limiting
   - Reduce request frequency

## Command Issues

### Commands Not Working

#### Quick Checks

1. **Correct Syntax**
   ```
   !tz help          # Should work
   !tzhelp           # Won't work (missing space)
   tz help           # Won't work (missing prefix)
   ```

2. **Bot Permissions**
   - Minimum required: Send Messages, Read Message History
   - For full features: Add Reactions, Manage Messages, Manage Webhooks

3. **User Permissions**
   - Some commands require specific permissions
   - Check with `!tz help <command>`

### Permission Errors

#### "Missing Permissions" Error
```
Error: Missing Permissions - Manage Webhooks
```

**Solution**:
1. Go to Server Settings → Roles
2. Find bot's role
3. Enable required permissions:
   - Manage Webhooks (for personality messages)
   - Manage Messages (for auth code deletion)
   - Add Reactions (for confirmations)

#### "Unauthorized" Error
```
Error: You don't have permission to use this command
```

**Solution**:
- Check if command requires admin/moderator role
- Verify your Discord permissions
- Some commands are owner-only (BOT_OWNER_ID)

### Command Timeouts

#### Symptoms
- Commands take too long to respond
- "This interaction failed" messages

#### Solutions

1. **Check API Status**
   - Verify AI service is responding
   - Test with `curl` or Postman
   - Check service status page

2. **Increase Timeouts**
   ```env
   API_TIMEOUT=60000  # 60 seconds
   ```

3. **Network Issues**
   - Check internet connectivity
   - Verify firewall rules
   - Test DNS resolution

## Personality Issues

### Can't Add Personalities

#### Common Errors

1. **"Personality not found"**
   - Verify exact personality name
   - Names are case-sensitive
   - Check with AI service documentation

2. **"Already added"**
   - Use `!tz list` to see your personalities
   - Each user has separate collections

3. **"Authentication required"**
   - Run `!tz auth start`
   - Complete authentication flow
   - Check with `!tz auth status`

### Personalities Not Responding

#### Diagnostic Steps

1. **Check Personality Status**
   ```
   !tz info personality-name
   !tz list
   ```

2. **Verify Mention Format**
   ```
   @personality-alias Hello    # Correct
   @personality-alias Hello    # Wrong (double space)
   @personality-aliasHello     # Wrong (no space)
   ```

3. **Check Active Conversations**
   - Run `!tz reset` to clear stuck conversations
   - Disable/re-enable autorespond

4. **API Issues**
   - Check logs for API errors
   - Verify API key is valid
   - Test API endpoint directly

### Wrong Avatar/Display Name

#### Causes & Solutions

1. **Cache Issues**
   - Profile info cached for 24 hours
   - Wait for cache expiry or restart bot

2. **API Changes**
   - Verify profile endpoint returns expected format
   - Check for API documentation updates

3. **Missing Profile Data**
   - Some personalities may not have avatars
   - Bot will use default Discord avatar

## Authentication Issues

### Authentication Failed

#### "Invalid authorization code"

**Causes**:
- Code expired (usually 10 minutes)
- Code already used
- Typed incorrectly

**Solution**:
1. Start fresh: `!tz auth start`
2. Copy code exactly (no spaces)
3. Submit quickly via DM

#### "Please submit authorization codes via DM only"

**Security Feature**: Codes must be submitted in DMs

**Solution**:
1. Click bot's username
2. Send direct message
3. Use `!tz auth code YOUR_CODE`

### Token Expired

#### Symptoms
```
Error: Your authentication has expired
```

#### Solution

1. **Check Status**
   ```
   !tz auth status
   ```

2. **Re-authenticate**
   ```
   !tz auth start
   # Follow the flow
   ```

3. **Token Lifetime**
   - Tokens expire after 30 days
   - No automatic renewal
   - Plan for regular re-authentication

### Can't Submit Auth Code

#### Common Issues

1. **DMs Disabled**
   - Enable DMs from server members
   - Or add bot as friend

2. **Code Format Issues**
   ```
   !tz auth code ABC123     # Correct
   !tz auth ABC123          # Wrong
   auth code ABC123         # Wrong
   ```

3. **Bot Can't DM You**
   - Check privacy settings
   - Ensure not blocking bot

## Webhook Issues

### Webhook Creation Failed

#### Error: "Missing Permissions"

**Solution**:
1. Grant "Manage Webhooks" permission to bot
2. Check channel-specific permission overrides
3. Verify channel webhook limit (10 per channel)

#### Error: "Maximum number of webhooks reached"

**Solution**:
1. Check existing webhooks:
   - Channel Settings → Integrations → Webhooks
2. Remove unused webhooks
3. Consider using different channel

### Messages Not Using Webhooks

#### Symptoms
- Personality messages show bot's name/avatar
- Embed format instead of webhook

#### Common Causes

1. **DM Channels**
   - Webhooks not available in DMs
   - Normal behavior, not an error

2. **Permission Issues**
   - Bot needs "Manage Webhooks"
   - Check channel overrides

3. **Webhook Cache Issues**
   - Restart bot to clear cache
   - Check for webhook creation errors in logs

### Webhook Rate Limits

#### Symptoms
```
Error: You are being rate limited
```

#### Solutions

1. **Reduce Message Frequency**
   - Add delays between messages
   - Avoid rapid personality switching

2. **Check for Loops**
   - Disable autorespond if needed
   - Monitor for message loops

3. **Discord Limits**
   - 5 webhooks per second per channel
   - 30 webhooks per minute per guild

## Connection Issues

### Discord Connection Lost

#### Symptoms
- Bot shows as offline
- "WebSocket connection closed" errors
- Reconnection attempts in logs

#### Solutions

1. **Network Issues**
   ```bash
   # Test connectivity
   ping discord.com
   nslookup discord.com
   ```

2. **Firewall Rules**
   - Allow outbound HTTPS (443)
   - Allow WebSocket connections
   - Whitelist Discord IPs if needed

3. **Token Issues**
   - Token may be revoked
   - Check Discord Developer Portal
   - Regenerate if needed

### API Connection Failed

#### Common Errors

1. **"ECONNREFUSED"**
   - API service is down
   - Wrong endpoint URL
   - Firewall blocking

2. **"401 Unauthorized"**
   - Invalid API key
   - Key expired/revoked
   - Wrong authentication header

3. **"ETIMEDOUT"**
   - Network latency
   - API server overloaded
   - Increase timeout value

#### Diagnostic Steps

```bash
# Test API endpoint
curl -X POST https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "test", "messages": [{"role": "user", "content": "test"}]}'
```

### Network Timeouts

#### Solutions

1. **Increase Timeouts**
   ```env
   API_TIMEOUT=60000
   ```

2. **Check Latency**
   ```bash
   ping api.example.com
   traceroute api.example.com
   ```

3. **Use Different DNS**
   ```bash
   # Try Google DNS
   echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
   ```

## Performance Issues

### High Memory Usage

#### Diagnostic Tools

1. **Built-in Status**
   ```
   !tz status
   ```

2. **System Tools**
   ```bash
   # Process memory
   ps aux | grep node
   
   # System memory
   free -h
   
   # Detailed view
   htop
   ```

#### Solutions

1. **Memory Leaks**
   - Update to latest version
   - Report issues with heap snapshots
   - Restart periodically as workaround

2. **Large Caches**
   - Webhook cache grows over time
   - Profile cache for many personalities
   - Consider cache size limits

3. **Node.js Limits**
   ```bash
   # Increase heap size
   node --max-old-space-size=2048 index.js
   ```

### Slow Response Times

#### Common Causes

1. **API Latency**
   - Check API response times
   - Consider geographic location
   - Use monitoring tools

2. **Database/File I/O**
   - JSON files grow large
   - Consider database migration
   - Implement pagination

3. **Message Processing**
   - Complex personality prompts
   - Long conversation history
   - Many active conversations

### Message Delays

#### Diagnostic Steps

1. **Check Logs**
   ```bash
   # Look for slow operations
   grep -i "slow\|delay\|timeout" logs/*.log
   ```

2. **Monitor Queues**
   - Message processing queue
   - Webhook send queue
   - API request queue

3. **Rate Limiting**
   - Discord rate limits
   - API rate limits
   - Internal rate limiting

## Development Issues

### Tests Failing

#### Common Issues

1. **Environment Setup**
   ```bash
   # Ensure test environment
   NODE_ENV=test npm test
   ```

2. **Mock Issues**
   - Check mock implementations
   - Verify mock data matches current API
   - Update snapshots if needed

3. **Async Issues**
   - Use proper async/await
   - Handle promise rejections
   - Set appropriate timeouts

#### Running Specific Tests

```bash
# Single file
npx jest tests/unit/bot.test.js

# Pattern matching
npm test -- --testNamePattern="personality"

# Update snapshots
npm test -- -u
```

### Lint Errors

#### Quick Fixes

```bash
# Auto-fix most issues
npm run lint:fix

# Format code
npm run format

# Check without fixing
npm run lint
```

#### Common Patterns

1. **Unused Variables**
   ```javascript
   // Use underscore prefix
   catch (_error) {
     // Error intentionally ignored
   }
   ```

2. **Line Length**
   - Max 100 characters
   - Break long strings
   - Use template literals

3. **Missing Semicolons**
   - Always use semicolons
   - Configure editor to add automatically

### Module Not Found

#### Solutions

1. **Install Dependencies**
   ```bash
   npm install
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Check Imports**
   ```javascript
   // Correct
   const { Client } = require('discord.js');
   
   // Wrong
   const Client = require('discord.js');
   ```

3. **File Paths**
   ```javascript
   // Use correct relative paths
   require('./utils/logger');     // Same directory
   require('../utils/logger');    // Parent directory
   require('../../utils/logger'); // Two levels up
   ```

## Diagnostic Commands

### System Information

```bash
# Node and npm versions
node --version
npm --version

# System resources
free -h
df -h
uptime

# Process information
ps aux | grep node
lsof -i :3000  # Check health port
```

### Bot Diagnostics

```
!tz status       # Overall bot status
!tz ping         # Basic connectivity
!tz debug        # Debug information (admin only)
!tz help         # Verify commands loaded
```

### Log Analysis

```bash
# Recent errors
grep -i error logs/*.log | tail -20

# Startup issues
grep -i "ready\|started\|failed" logs/*.log

# API issues
grep -i "api\|timeout\|429" logs/*.log

# Memory issues
grep -i "memory\|heap\|gc" logs/*.log
```

## Log Analysis

### Understanding Log Levels

```
DEBUG - Detailed information for debugging
INFO  - General information about operations
WARN  - Warning conditions that might need attention
ERROR - Error conditions that need immediate attention
```

### Common Log Patterns

1. **Successful Startup**
   ```
   INFO: Bot client initialized
   INFO: Connected to Discord as BotName#1234
   INFO: Bot is ready! Serving X guilds
   ```

2. **API Errors**
   ```
   ERROR: AI Service API Error: 429 Too Many Requests
   WARN: Retrying API request in 5 seconds...
   ```

3. **Permission Issues**
   ```
   ERROR: DiscordAPIError: Missing Permissions
   WARN: Cannot create webhook in channel #general
   ```

### Log Rotation

Implement log rotation to prevent disk space issues:

```bash
# Using logrotate
sudo nano /etc/logrotate.d/tzurot

/path/to/tzurot/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

## Getting Help

### Before Asking for Help

1. **Check Documentation**
   - Read relevant guides in `/docs`
   - Search existing issues
   - Check Discord announcements

2. **Gather Information**
   - Bot version
   - Node.js version
   - Error messages
   - Recent changes

3. **Try Basic Fixes**
   - Restart bot
   - Check configuration
   - Update dependencies

### Reporting Issues

When reporting issues, include:

1. **Environment Details**
   ```
   Node Version: 16.x.x
   OS: Ubuntu 20.04
   Bot Version: 1.0.0
   ```

2. **Steps to Reproduce**
   - Exact commands used
   - Expected behavior
   - Actual behavior

3. **Error Messages**
   - Full error stack trace
   - Relevant log entries
   - Screenshots if applicable

4. **Configuration** (sanitized)
   - Remove sensitive data
   - Include relevant settings
   - Note any custom changes

### Getting Support

1. **GitHub Issues**
   - Bug reports
   - Feature requests
   - Documentation improvements

2. **GitHub Discussions**
   - Questions and help
   - Ideas and suggestions
   - Show and tell

3. **Documentation**
   - This guide
   - API reference
   - Code examples

### For Urgent Issues

If you're experiencing a critical issue:

1. Check existing issues for similar problems
2. Create a new issue with the 'urgent' label
3. Provide as much detail as possible

Remember: Always sanitize logs and configuration before sharing!

---

This is a personal project maintained in my spare time. I'll do my best to help, but response times may vary. Thank you for your understanding!