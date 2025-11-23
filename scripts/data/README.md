# Data Import/Export/Backup Scripts

Scripts for managing personality data, conversation history backups, and memory operations.

## Scripts

- **backup-personalities-data.js** - Backup personality configurations and associated data
- **rebuild-memories-from-history.ts** - Rebuild vector memory embeddings from conversation history
- **upload-avatar-stdin.mjs** - Upload personality avatar images to storage
- **import-personality/** - Personality data import utilities

## Usage

```bash
# Backup personality data
node scripts/data/backup-personalities-data.js

# Rebuild memories from history
npx tsx scripts/data/rebuild-memories-from-history.ts

# Upload avatar
cat avatar.png | node scripts/data/upload-avatar-stdin.mjs
```

**⚠️ Always backup data before running destructive operations**
