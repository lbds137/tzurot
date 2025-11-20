# Redis Maintenance

Procedures for maintaining Redis health in production.

**Last Updated:** 2025-11-08

---

## Overview

Tzurot uses Redis for BullMQ job queuing. Jobs contain full conversation history (50-100KB each), so proper maintenance is essential to prevent memory bloat and performance degradation.

## Current Configuration

**Job Retention Limits** (as of v3.0.0-alpha.34):

- Completed jobs: 10 (previously 100)
- Failed jobs: 50 (previously 500)
- Scheduled completed: 10
- Scheduled failed: 50

**Total expected usage**: ~4.5MB for job history (down from ~40-50MB)

**Auto-cleanup**: BullMQ automatically removes jobs beyond these limits as new jobs complete/fail.

## Monitoring Redis Health

### Check Memory Usage

```bash
railway run --service ai-worker redis-cli INFO memory | grep used_memory_human
```

### Count Total Keys

```bash
railway run --service ai-worker redis-cli DBSIZE
```

### Count Jobs by Pattern

```bash
# Count ai-requests jobs
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:*" | wc -l

# Count scheduled jobs
railway run --service ai-worker redis-cli --scan --pattern "bull:scheduled-jobs:*" | wc -l
```

### Inspect Job Keys

```bash
# List sample job keys
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:*" | head -20

# Check specific key type
railway run --service ai-worker redis-cli TYPE "bull:ai-requests:completed"
```

## Manual Cleanup Procedures

### When to Clean Manually

- After discovering Redis has thousands of old jobs (e.g., 125+ pages in web UI)
- Before deploying retention limit changes (to immediately reclaim space)
- When Redis memory usage is approaching limits
- After a deployment that significantly changed job structure

### Safety First

⚠️ **Before running cleanup commands:**

1. Check that no critical jobs are in progress:

   ```bash
   railway run --service ai-worker redis-cli LLEN "bull:ai-requests:active"
   ```

   Should return 0 or small number (≤ concurrency setting).

2. Verify you're targeting the correct environment:
   ```bash
   railway status
   ```
   Confirm you're connected to the intended service.

### Cleanup Commands

**1. Remove Old Completed Jobs**

```bash
# List completed job keys (check what you're deleting first)
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:completed*" | head -50

# Delete all completed job data
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:completed*" | \
  xargs -L 1000 railway run --service ai-worker redis-cli DEL
```

**2. Remove Old Failed Jobs**

```bash
# List failed job keys
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:failed*" | head -50

# Delete all failed job data
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:failed*" | \
  xargs -L 1000 railway run --service ai-worker redis-cli DEL
```

**3. Remove Specific Job ID**

```bash
# If you know a specific problematic job ID
railway run --service ai-worker redis-cli DEL "bull:ai-requests:req-12345678"
```

**4. Nuclear Option: Clear All Queue Data**

⚠️ **WARNING**: This removes ALL queue data including active jobs!

```bash
# Only use if you need to completely reset the queue
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:*" | \
  xargs -L 1000 railway run --service ai-worker redis-cli DEL

railway run --service ai-worker redis-cli --scan --pattern "bull:scheduled-jobs:*" | \
  xargs -L 1000 railway run --service ai-worker redis-cli DEL
```

After nuclear option, restart all services:

```bash
railway up --service ai-worker
railway up --service api-gateway
railway up --service bot-client
```

## Verifying Cleanup

After cleanup, verify Redis is healthy:

```bash
# Check memory usage decreased
railway run --service ai-worker redis-cli INFO memory | grep used_memory_human

# Check key count decreased
railway run --service ai-worker redis-cli DBSIZE

# Verify queue is still functional (should see new jobs)
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:*" | head -10
```

## Preventing Future Bloat

### Code-Level Prevention

1. **Job Retention Limits**: Defined in `packages/common-types/src/constants/queue.ts`
   - Keep limits low (current: 10 completed, 50 failed)
   - Each job = 50-100KB of conversation history

2. **Job Cleanup**: BullMQ automatically removes old jobs via:

   ```typescript
   removeOnComplete: { count: QUEUE_CONFIG.COMPLETED_HISTORY_LIMIT },
   removeOnFail: { count: QUEUE_CONFIG.FAILED_HISTORY_LIMIT },
   ```

3. **Monitor Job Size**: Large jobs indicate:
   - Very long conversation histories
   - Large attachments not being cleaned up
   - Memory leaks in job data

### Operational Prevention

1. **Regular Monitoring**: Check Redis memory usage weekly
2. **Alert Thresholds**: Set up alerts when Redis memory > 80% capacity
3. **Automated Cleanup**: Consider cron job to remove jobs older than 7 days
4. **Redis Upgrade**: If consistently hitting limits, upgrade Railway Redis tier

## Troubleshooting

### Redis Running Slow

**Symptoms**: Timeout errors in logs, slow job processing

**Causes**:

- Too many keys (thousands of old jobs)
- Memory pressure (approaching Redis max memory)
- Network latency (Railway shared Redis)

**Solutions**:

1. Run manual cleanup (see above)
2. Check Redis memory: `railway run --service ai-worker redis-cli INFO memory`
3. Consider reducing job retention limits further
4. Upgrade Railway Redis tier if on free/hobby

### Jobs Not Being Cleaned Up

**Symptoms**: DBSIZE keeps growing despite retention limits

**Possible Issues**:

1. **BullMQ not removing jobs**: Check that `removeOnComplete`/`removeOnFail` are configured
2. **Old jobs from before limit change**: Run manual cleanup
3. **Active jobs stuck**: Check active queue length
4. **Multiple queue instances**: Ensure only one worker is running

**Verification**:

```bash
# Check if old jobs exist
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:*" | wc -l

# Should be roughly: (COMPLETED_LIMIT + FAILED_LIMIT) * 2 + active jobs
# Example: (10 + 50) * 2 + 5 = 125 keys (not thousands)
```

### Railway Redis Connection Issues

**Symptoms**: `Command timed out` errors, connection refused

**Solutions**:

1. Check Railway service status: `railway status`
2. Verify Redis is running: `railway ps`
3. Check Redis config matches Railway requirements:
   - IPv6 (family: 6) for private networking
   - Increased timeouts (30s commandTimeout)
   - maxRetriesPerRequest: null for BullMQ

## Reference

- **Job Retention Config**: `packages/common-types/src/constants/queue.ts`
- **Redis Config**: `packages/common-types/src/utils/redis.ts`
- **BullMQ Docs**: https://docs.bullmq.io/
- **Railway Redis Docs**: https://docs.railway.app/databases/redis

---

**Related Documentation:**

- [Deployment Guide](../deployment/RAILWAY_DEPLOYMENT.md)
- [Timeout Constants](../../packages/common-types/src/constants/timing.ts)
