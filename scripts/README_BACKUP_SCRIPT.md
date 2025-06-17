# Personality Service Data Backup Script

A standalone Node.js script to backup your personality data from external personality services, including memories, knowledge, training data, and user personalization settings.

## Prerequisites

- Node.js installed on your computer
- An active account on the personality service
- Your personality usernames

## Quick Start

1. **Download the script**: Save `backup-personalities-data.js` to your computer

2. **Get your session cookie**:

   - Log into the personality service in your browser
   - Open Developer Tools (F12)
   - Go to Application/Storage → Cookies (Chrome/Edge) or Storage → Cookies (Firefox)
   - Find the `appSession` cookie (or similar session cookie)
   - Copy its VALUE (the long string, not the whole cookie)

3. **Run the backup**:
   ```bash
   SERVICE_COOKIE="your-cookie-value" \
   SERVICE_WEBSITE="https://service.example.com" \
   PERSONALITY_JARGON_TERM="personalities" \
   node backup-personalities-data.js personality1 personality2
   ```

## What Gets Backed Up

For each personality, the script saves:

- **Profile data** - Basic personality information
- **Memories** - All conversation memories (paginated)
- **Knowledge/Story** - Knowledge base entries
- **Training data** - Training examples
- **User personalization** - Your specific settings and customizations

## Output Structure

```
data/service-backup/
└── personality-name/
    ├── personality-name.json                    # Profile data
    ├── personality-name_memories.json           # All memories
    ├── personality-name_knowledge.json          # Knowledge/story data
    ├── personality-name_training.json           # Training data
    └── personality-name_user_personalization.json # User settings
```

## Environment Variables

- `SERVICE_COOKIE` (required) - Your session cookie value
- `SERVICE_WEBSITE` (required) - The service URL (e.g., https://service.example.com)
- `PERSONALITY_JARGON_TERM` (required) - The service's term for personalities (e.g., "personalities", "agents", "characters")

## Tips

- The script is respectful of the API with 1-second delays between requests
- Memories are automatically sorted chronologically (oldest first)
- You can run the script multiple times - it will update existing backups
- The script creates the output directory automatically

## Privacy & Security

- Your session cookie is only used locally by the script
- All data is saved to your local machine
- No data is sent anywhere except to the personality service to retrieve your information

## Troubleshooting

**"SERVICE_COOKIE environment variable required"**

- Make sure you're providing the cookie value when running the script

**"HTTP 401" errors**

- Your session cookie may have expired. Get a fresh one from your browser

**"No personalities specified"**

- Add the personality usernames at the end of the command

## License

This script is provided as-is for personal backup purposes.
