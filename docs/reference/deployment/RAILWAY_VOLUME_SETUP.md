# Railway Volume Setup for Avatar Storage

## Overview

Personality avatars are self-hosted to prevent broken images when shapes.inc shuts down. Avatars are stored in a Railway volume mounted to the API gateway service.

## Volume Configuration

**Service**: `api-gateway`
**Volume Name**: `tzurot-avatars`
**Mount Path**: `/data`
**Size**: 1GB (sufficient for ~1000 avatars at 1MB each)
**Cost**: ~$0.25/GB/month on Railway

## Setup Steps

### 1. Create Volume in Railway Dashboard

1. Navigate to `api-gateway` service
2. Go to "Volumes" tab
3. Click "New Volume"
4. Configure:
   - **Name**: `tzurot-avatars`
   - **Mount Path**: `/data`
   - **Size**: 1GB
5. Click "Add Volume"

### 2. Verify Volume Mount

After deployment, check that the volume is mounted:

```bash
railway run --service api-gateway sh -c "ls -la /data"
```

Expected output:

```
drwxr-xr-x    2 root     root          4096 Jan 27 00:00 .
drwxr-xr-x   20 root     root          4096 Jan 27 00:00 ..
```

### 3. Create Avatars Directory

```bash
railway run --service api-gateway sh -c "mkdir -p /data/avatars && ls -la /data"
```

Expected output should show `avatars/` directory.

### 4. Test Avatar Serving

After volume is set up, test the endpoint:

```bash
# Check health endpoint includes avatar storage
curl https://api-gateway-development-83e8.up.railway.app/health | jq '.avatars'

# Expected output:
# {
#   "status": "ok",
#   "count": 0
# }
```

## Import Tool Integration

The personality import tool automatically:

1. Downloads avatars from shapes.inc
2. Saves to `/data/avatars/{slug}.{ext}`
3. Updates personality record with Railway URL

Example:

```bash
pnpm import-personality cold-kerach-batuach
```

Generates:

- Local path: `/data/avatars/cold-kerach-batuach.png`
- Public URL: `https://api-gateway.railway.app/avatars/cold-kerach-batuach.png`

## API Gateway Configuration

Avatar serving is configured in `services/api-gateway/src/index.ts`:

```typescript
app.use(
  '/avatars',
  express.static('/data/avatars', {
    maxAge: '7d', // Cache for 7 days
    etag: true,
    lastModified: true,
    fallthrough: false, // Return 404 if avatar not found
  })
);
```

### Caching Strategy

- **Browser cache**: 7 days (604800 seconds)
- **ETags**: Enabled for conditional requests
- **Last-Modified**: Enabled for conditional requests

This reduces bandwidth and improves performance for frequently accessed avatars.

## Health Monitoring

The `/health` endpoint includes avatar storage status:

```json
{
  "status": "healthy",
  "services": {
    "redis": true,
    "queue": true,
    "avatarStorage": true
  },
  "avatars": {
    "status": "ok",
    "count": 3
  },
  "timestamp": "2025-01-27T12:00:00.000Z",
  "uptime": 3600000
}
```

## Backup and Recovery

### Manual Backup

```bash
# Download all avatars
railway volume download tzurot-avatars --output ./avatars-backup

# Verify backup
ls -la ./avatars-backup/avatars/
```

### Restore from Backup

```bash
# Upload avatars to volume
railway volume upload tzurot-avatars --source ./avatars-backup
```

### Automated Backup (Recommended)

Add to CI/CD or cron:

```bash
#!/bin/bash
# backup-avatars.sh

DATE=$(date +%Y-%m-%d)
BACKUP_DIR="./backups/avatars-$DATE"

railway volume download tzurot-avatars --output "$BACKUP_DIR"
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

# Optional: Upload to S3/B2/etc
# aws s3 cp "$BACKUP_DIR.tar.gz" s3://tzurot-backups/avatars/
```

## Troubleshooting

### Volume Not Accessible

**Symptom**: Health check shows `avatarStorage: false`

**Solution**:

```bash
# Check volume is mounted
railway run --service api-gateway sh -c "mount | grep /data"

# Check permissions
railway run --service api-gateway sh -c "ls -la /data"

# Create directory if missing
railway run --service api-gateway sh -c "mkdir -p /data/avatars"
```

### Avatars Not Serving

**Symptom**: 404 errors on `/avatars/{slug}.png`

**Possible causes**:

1. Avatar file doesn't exist

   ```bash
   railway run --service api-gateway sh -c "ls -la /data/avatars"
   ```

2. Wrong file extension

   ```bash
   # Check actual extension
   railway run --service api-gateway sh -c "file /data/avatars/cold-kerach-batuach.*"
   ```

3. Volume not mounted correctly
   ```bash
   # Verify mount
   railway run --service api-gateway sh -c "df -h | grep /data"
   ```

### Import Fails to Download Avatar

**Symptom**: Import succeeds but uses fallback avatar

**Solution**:

- Shapes.inc URL may be down
- Network issue during import
- Check import logs for download error
- Re-run import after fixing connectivity

## Cost Optimization

### Current Usage

- **1GB volume**: ~$0.25/month
- **Average avatar size**: ~500KB
- **Capacity**: ~2000 avatars per GB

### Scaling Strategy

If storage needs exceed 1GB:

1. Increase volume size in Railway dashboard
2. Or compress avatars during import
3. Or use WebP format (smaller than PNG)

### Compression Example

```typescript
// In AvatarDownloader.ts (future optimization)
import sharp from 'sharp';

const compressed = await sharp(avatarBuffer)
  .resize(256, 256, { fit: 'cover' })
  .webp({ quality: 80 })
  .toBuffer();
```

## Migration from Hotlinked Avatars

If you have existing personalities with shapes.inc URLs:

```bash
# Fix all avatars
pnpm fix-avatars --all

# Or specific personality
pnpm fix-avatars lilith
```

This will:

1. Download avatar from shapes.inc
2. Store in Railway volume
3. Update personality record with new URL

## Security Considerations

- **Public access**: Avatars are publicly accessible (no authentication)
- **File types**: Only serve images (PNG, JPG, GIF, WebP)
- **Size limits**: Consider max file size to prevent abuse
- **Rate limiting**: Consider adding rate limits to `/avatars/*` endpoint

### Future Enhancement: Access Control

```typescript
// Optional: Add authentication for private personalities
app.use('/avatars/:slug', async (req, res, next) => {
  const personality = await getPersonality(req.params.slug);

  if (personality.isPrivate) {
    // Check user has access
    const user = await authenticateRequest(req);
    if (!canAccessPersonality(user, personality)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  next();
});
```

## References

- Railway Volumes: https://docs.railway.com/guides/volumes
- Express Static Middleware: https://expressjs.com/en/starter/static-files.html
- HTTP Caching: https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching
