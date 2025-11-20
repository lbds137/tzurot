# Railway Volume Access Guide

This guide documents how to access files and volumes on Railway deployments.

## Table of Contents

- [Current Limitations](#current-limitations)
- [Railway SSH (New Feature)](#railway-ssh-new-feature)
- [Accessing Volumes Through Code](#accessing-volumes-through-code)
- [Debugging Strategies](#debugging-strategies)
- [Best Practices](#best-practices)

## Current Limitations

Railway does not provide traditional SSH access to deployed containers. The platform prioritizes immutability and security, which means:

- No direct file browser UI
- No file download via CLI
- Volumes only accessible through application code
- No traditional SSH for debugging (though this is changing)

## Railway SSH (New Feature)

Railway has announced an SSH feature that may be available in newer CLI versions:

```bash
# Basic SSH access
railway ssh

# With specific project/service/environment
railway ssh -p <PROJECT> -s <SERVICE> -e <ENVIRONMENT>

# Run a specific command
railway ssh ls -la /app/data
```

**Note**: This uses authenticated QUIC streams, not traditional SSH protocol. Update your Railway CLI to the latest version to access this feature.

## Accessing Volumes Through Code

### 1. Application-Level Access

Since volumes are mounted at runtime, you need to access them through your application:

```javascript
// Example: Reading personalities.json from a volume
const fs = require('fs');
const path = require('path');

// Railway provides these environment variables
const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
const personalitiesPath = path.join(volumePath, 'personalities.json');

// Read the file
const personalities = JSON.parse(fs.readFileSync(personalitiesPath, 'utf8'));
console.log('Loaded personalities:', Object.keys(personalities));
```

### 2. Creating Debug Endpoints

For debugging Railway deployments, create temporary endpoints:

```javascript
// WARNING: Only use in development!
app.get('/debug/personalities', async (req, res) => {
  try {
    const data = fs.readFileSync('/app/data/personalities.json', 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug/ls', async (req, res) => {
  try {
    const files = fs.readdirSync('/app/data');
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 3. Using Environment Variables

Railway automatically provides:

- `RAILWAY_VOLUME_NAME` - Name of the volume
- `RAILWAY_VOLUME_MOUNT_PATH` - Mount path of the volume

## Debugging Strategies

### 1. Comprehensive Logging

Log file operations to understand what's happening:

```javascript
// In ApplicationBootstrap or PersonalityManager
logger.info(`[PersonalityManager] Loading personalities from: ${dataPath}`);
logger.info(`[PersonalityManager] Files in data directory: ${fs.readdirSync(dataPath).join(', ')}`);
logger.info(`[PersonalityManager] Personalities loaded: ${Object.keys(personalities).join(', ')}`);
```

### 2. Structured Logging for Railway

Use JSON logging for better filtering in Railway dashboard:

```javascript
console.log(
  JSON.stringify({
    service: 'personality-manager',
    action: 'load',
    path: '/app/data/personalities.json',
    success: true,
    count: Object.keys(personalities).length,
    names: Object.keys(personalities),
  })
);
```

### 3. Log Filtering in Railway

Use these filters in the Railway dashboard:

```
@service:tzurot
@level:error
@path:/app/data/personalities.json
```

## Best Practices

### 1. Volume Mount Verification

Always verify volume mounts on startup:

```javascript
const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
if (!fs.existsSync(volumePath)) {
  logger.error(`Volume path ${volumePath} does not exist!`);
  // Handle appropriately
}
```

### 2. Graceful Fallbacks

Handle missing files gracefully:

```javascript
try {
  const data = fs.readFileSync(personalitiesPath, 'utf8');
  return JSON.parse(data);
} catch (error) {
  if (error.code === 'ENOENT') {
    logger.warn(`Personalities file not found at ${personalitiesPath}, using empty object`);
    return {};
  }
  throw error;
}
```

### 3. Migration Scripts

For data migrations, use Railway's deployment commands:

```javascript
// scripts/migrate-personalities.js
const source = '/app/data/personalities.json';
const backup = '/app/data/personalities.backup.json';

if (fs.existsSync(source)) {
  fs.copyFileSync(source, backup);
  logger.info('Backup created');
}
```

## Troubleshooting Personality Loading on Railway

Based on the current issue with reply personality lookup:

1. **Check if personalities.json exists and is populated**:

   ```javascript
   // Add to ApplicationBootstrap
   const personalitiesPath = path.join(dataPath, 'personalities.json');
   logger.info(`[Bootstrap] Checking personalities at: ${personalitiesPath}`);
   logger.info(`[Bootstrap] File exists: ${fs.existsSync(personalitiesPath)}`);
   if (fs.existsSync(personalitiesPath)) {
     const content = fs.readFileSync(personalitiesPath, 'utf8');
     const personalities = JSON.parse(content);
     logger.info(`[Bootstrap] Loaded ${Object.keys(personalities).length} personalities`);
     logger.info(`[Bootstrap] Personality names: ${Object.keys(personalities).join(', ')}`);
   }
   ```

2. **Verify personality registration**:

   ```javascript
   // In PersonalityManager
   logger.info(`[PersonalityManager] Registering ${personalityName} for owner ${ownerId}`);
   logger.info(
     `[PersonalityManager] Current personalities: ${Object.keys(this.personalities).join(', ')}`
   );
   ```

3. **Debug conversation tracking**:
   ```javascript
   // In ConversationTracker
   logger.info(
     `[ConversationTracker] Recording: ${personalityName} (using fullName: ${personality.fullName})`
   );
   ```

## Railway CLI Reference

```bash
# Link to project
railway link

# Deploy
railway up

# View logs
railway logs

# Run with Railway environment
railway run node scripts/debug-personalities.js

# Open local shell with Railway variables
railway shell

# SSH to deployment (if available)
railway ssh
railway ssh ls -la /app/data
railway ssh cat /app/data/personalities.json
```

## Future Improvements

1. The new Railway SSH feature should make direct file access easier
2. Consider implementing a web-based file browser for easier debugging
3. Add health check endpoints that verify volume mounts
4. Implement automatic backup of critical files to external storage

Remember: Railway's architecture prioritizes security and immutability. Always access files through your application code rather than trying to bypass these restrictions.
