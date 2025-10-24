# Testing Steps for Import Tool

## Step 1: Create Railway Volume (Dashboard)

Since Railway CLI volume creation is interactive, use the dashboard:

1. **Navigate to**: https://railway.app/project/industrious-analysis/service/api-gateway
2. **Click**: "Volumes" tab
3. **Click**: "New Volume" button
4. **Configure**:
   - **Mount Path**: `/data`
   - **Size**: 1GB (default is fine)
5. **Click**: "Add Volume"
6. **Wait**: For redeployment to complete (~2-3 minutes)

### Verify Volume Creation

```bash
railway volume list
```

Expected: Should see a new volume attached to api-gateway at `/data`

### Create Avatars Directory

```bash
railway run --service api-gateway sh -c "mkdir -p /data/avatars && ls -la /data"
```

Expected: Should show `avatars/` directory

---

## Step 2: Test Avatar Serving

```bash
# Check health endpoint
curl https://api-gateway-development-83e8.up.railway.app/health | jq '.avatars'
```

Expected output:
```json
{
  "status": "ok",
  "count": 0
}
```

---

## Step 3: Run Qdrant Cleanup (Dry Run First)

Clean up existing Lilith memories with old format:

```bash
# Dry run to see what would change
pnpm cleanup-qdrant --dry-run
```

Expected: Should scan collections and report issues

### Apply Cleanup

If dry run looks good:

```bash
pnpm cleanup-qdrant
```

---

## Step 4: Test Import (Dry Run First)

Test with cold-kerach-batuach personality:

```bash
# Dry run first
pnpm import-personality cold-kerach-batuach --dry-run
```

Expected output:
- ✅ Config loaded and validated
- ✅ 107 memories found
- 🔍 Would create personality
- 🔍 Would download avatar
- 🔍 Would import memories

### Run Actual Import

If dry run succeeds:

```bash
pnpm import-personality cold-kerach-batuach
```

Expected:
- Creates personality in PostgreSQL
- Downloads avatar to /data/avatars
- Imports 107 memories to Qdrant
- Reports success

### Verify Import

```bash
# Check personality exists
railway run npx prisma studio
# Or via psql:
railway run psql -c "SELECT id, name, slug FROM personalities WHERE slug='cold-kerach-batuach';"

# Check avatar was downloaded
railway run --service api-gateway sh -c "ls -la /data/avatars/"

# Test avatar serving
curl https://api-gateway-development-83e8.up.railway.app/avatars/cold-kerach-batuach.png -I

# Check health shows avatar
curl https://api-gateway-development-83e8.up.railway.app/health | jq '.avatars'
```

---

## Step 5: Test Bot with Imported Personality

1. **In Discord**: Send message mentioning the personality
   ```
   @cold test message
   ```

2. **Expected**: Bot should respond using the imported personality with its memories

3. **Check logs**:
   ```bash
   railway logs --service bot-client | grep -i cold
   railway logs --service ai-worker | grep -i cold
   ```

---

## Step 6: Import Lilith

Once cold-kerach-batuach works:

```bash
# Dry run
pnpm import-personality lilith --dry-run

# If good, import
pnpm import-personality lilith
```

Note: Lilith may already exist, so use `--force` if needed:
```bash
pnpm import-personality lilith --force
```

Or just import memories:
```bash
pnpm import-personality lilith --memories-only
```

---

## Troubleshooting

### Volume Not Accessible

```bash
# Check mount
railway run --service api-gateway sh -c "mount | grep /data"

# Check permissions
railway run --service api-gateway sh -c "ls -la /data"
```

### Avatar Download Fails

- Check shapes.inc is still accessible
- Check network connectivity
- Fallback avatar should be used automatically

### Import Fails

```bash
# Check environment variables are set
railway variables --service ai-worker | grep -E '(QDRANT|OPENAI)'

# Check Qdrant is accessible
railway run --service ai-worker sh -c "curl $QDRANT_URL/collections"
```

### Bot Doesn't Use Imported Personality

```bash
# Check personality was created
railway run psql -c "SELECT * FROM personalities WHERE slug='cold-kerach-batuach';"

# Check default config link exists
railway run psql -c "SELECT * FROM personality_default_configs WHERE personality_id='<id>';"
```

---

## Success Criteria

✅ Railway volume created and accessible
✅ Avatar serving works (health check shows storage)
✅ Qdrant cleanup completes without errors
✅ Import completes successfully
✅ Avatar downloaded and accessible
✅ Memories stored in Qdrant
✅ Bot can use imported personality
✅ Memory retrieval works in conversations

---

## Next Steps After Testing

1. Document any issues encountered
2. Import remaining personalities from shapes.inc
3. Consider implementing:
   - Batch import script
   - Migration tool for orphaned memories
   - LTM regeneration from chat history
4. Convert scripts to slash commands
