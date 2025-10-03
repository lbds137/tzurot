# Personalities

This directory contains example personality configurations for the Tzurot bot.

## ⚠️ Important Notes

- These are PUBLIC example personalities safe for git
- Your private, production personalities should be stored locally outside git
- The `.gitignore` excludes `data/` to protect your private personality data
- For deployment, you can:
  1. Use these example personalities as a starting point
  2. Configure your actual personalities through the bot's commands after deployment
  3. Use Railway's volume mounts for persistent personality storage (future enhancement)

## Personality File Format

```json
{
  "name": "Personality Name",
  "systemPrompt": "Description of how this personality behaves",
  "model": "gemini-2.0-flash-exp",
  "temperature": 0.7,
  "avatar": "URL to avatar image"
}
```

## Adding Personalities

After deployment, you can add personalities using Discord commands:
- `!tz add <name>` - Add a new personality interactively
- `!tz list` - List all available personalities
- `!tz info <name>` - Get details about a personality
