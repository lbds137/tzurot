# Avatar Migration Files (Archived)

This directory contains the original avatar files that were used for one-time migration to the database.

## Status: ARCHIVED

These files were used by the one-time migration script `scripts/populate-avatar-data.ts` to populate the `avatar_data` field in the `personalities` table.

Migration completed: October 27, 2025

## Current Avatar Storage Approach

**Database is the source of truth:**

- Avatars are stored as base64-encoded PNG in PostgreSQL (`personalities.avatar_data`)
- Filesystem (`/data/avatars/`) is just a performance cache
- On startup, `sync-avatars.ts` syncs avatars from DB to filesystem if missing

## Files in this Directory

- `lilith-tzel-shani.png` (88KB, 256x256)
- `cold-kerach-batuach.png` (116KB, 256x256)
- `ha-shem-keev-ima.png` (114KB, 256x256)
- `emily-tzudad-seraph-ditza.png` (113KB, 256x256)
- `lucifer-kochav-shenafal.png` (196KB, 1024x1024)

These files are kept as backups and reference. They are no longer used by the application at runtime.

## Adding New Personalities

Use the `/personality create` slash command in Discord to add new personalities with avatars. The command will:

1. Accept an image upload
2. Automatically resize to 256x256
3. Optimize to ~200KB or less
4. Store in database as base64
