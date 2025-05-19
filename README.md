# tzurot
A Discord bot that uses webhooks to represent multiple AI personalities

## Configuration

### Environment Variables

The bot uses the following environment variables:

- `DISCORD_TOKEN` - Discord bot token
- `SERVICE_API_KEY` - API key for the AI service
- `SERVICE_API_ENDPOINT` - API endpoint for the AI service
- `SERVICE_ID` - Service identifier
- `PROFILE_INFO_ENDPOINT` - Endpoint for fetching profile information
- `AVATAR_URL_BASE` - Base URL for avatar images
- `PREFIX` - Command prefix (default: `!tz`)
- `BOT_OWNER_ID` - Discord user ID of the bot owner (required for owner-only commands and personality auto-seeding)
- `OWNER_PERSONALITIES` - Comma-separated list of personalities to automatically add for the bot owner
- `KNOWN_PROBLEMATIC_PERSONALITIES` - Comma-separated list of personalities that require special error handling (see [documentation](docs/PROBLEMATIC_PERSONALITIES.md))
- `HEALTH_PORT` - Port for the health check endpoint (optional)

### User Personalities

The bot can automatically seed personalities for the bot owner. Configure the list of personalities using the `OWNER_PERSONALITIES` environment variable in your `.env` file. This should be a comma-separated list of personality names that will be automatically added to the bot owner's account during initialization.

## Health Check Endpoint

The bot includes a health check HTTP endpoint that allows monitoring systems to verify the application's status. By default, it runs on port 3000 and can be accessed at:

```
http://your-server:3000/health
```

The health endpoint provides:
- Overall application status (ok, degraded, critical)
- Uptime information
- Memory usage statistics
- System information
- Status of individual components (Discord connection, AI service)

### Configuration

You can configure the health check port by setting the `HEALTH_PORT` environment variable.

### Example Response

```json
{
  "status": "ok",
  "timestamp": "2025-05-18T12:00:00.000Z",
  "uptime": {
    "seconds": 3600,
    "formatted": "0d 1h 0m 0s"
  },
  "memory": {
    "rss": "120 MB",
    "heapTotal": "60 MB",
    "heapUsed": "45 MB",
    "external": "10 MB",
    "memoryUsagePercent": "75%"
  },
  "system": {
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "v18.16.0",
    "cpuCores": 4,
    "totalMemory": "8192 MB",
    "freeMemory": "4096 MB",
    "loadAverage": [1.5, 1.2, 1.0]
  },
  "components": {
    "discord": {
      "status": "ok",
      "message": "Connected to Discord",
      "ping": "42ms",
      "servers": 5,
      "uptime": "1h 0m 0s"
    },
    "ai": {
      "status": "ok",
      "message": "AI service operational"
    }
  }
}
```
