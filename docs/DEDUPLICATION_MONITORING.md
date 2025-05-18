# Deduplication Monitoring

This document describes the monitoring system for the message deduplication refactoring, which helps ensure the changes are working correctly in production.

## Overview

The message deduplication monitoring system:
1. Tracks all deduplication events in real time
2. Collects statistics on message and operation deduplication
3. Logs regular summaries to help identify potential issues
4. Saves detailed statistics to disk for later analysis
5. Requires no additional external dependencies

## Components

### 1. Deduplication Monitor Module

The `deduplicationMonitor.js` module provides:
- `trackDedupe()`: Records deduplication events with metadata
- `getDedupStats()`: Returns current statistics
- `startMonitoring()`: Begins periodic logging and saving
- `resetStats()`: Resets all statistics
- `logStats()`: Manually triggers statistics logging

### 2. Integration with MessageTracker

The MessageTracker class has been updated to use the monitoring module:
- It calls `trackDedupe()` when duplicates are detected
- It starts monitoring automatically on initialization
- It gracefully handles cases where the monitor isn't available

## Dashboard

To access deduplication statistics in production, you can:

1. **Tail the logs**: Monitor logs for entries with the `[DedupeMonitor]` prefix:
   ```
   grep -i "DedupeMonitor" /path/to/logs/tzurot.log | tail -f
   ```

2. **Check statistics file**: View the latest statistics:
   ```
   cat /path/to/logs/deduplication_stats.json
   ```

3. **Get current stats via code**: Use the API directly in the bot's REPL console:
   ```javascript
   // In bot console
   const { getDedupStats } = require('./src/monitoring/deduplicationMonitor');
   console.table(getDedupStats());
   ```

## What to Look For

The monitoring system helps identify several potential issues:

### 1. Excessive Deduplication

If you see very high deduplication rates (e.g., >30% of messages), it could indicate:
- Client-side issues causing duplicate requests
- Improper timeout settings in the deduplication system
- Race conditions in the bot's message handling

### 2. Channel Hotspots

If specific channels consistently show high deduplication rates:
- Check for bots or integrations that might be spamming those channels
- Investigate user behavior in those channels
- Consider adjusting rate limits for those channels

### 3. Time-based Patterns

If deduplication spikes during specific times:
- Check for scheduled jobs or integrations that run at those times
- Verify if backup/maintenance processes might cause duplicate messages
- Consider network/infrastructure issues during peak usage

## Actions for High Deduplication Rates

If monitoring shows concerning patterns:

1. **Alert and Verify**: Check the deduplication events match expectations
2. **Adjust Parameters**: Consider changing the deduplication window (default: 5 seconds)
3. **Add Debug Logging**: Enable deeper logging to identify root causes
4. **Consider Rollback**: If issues persist, use the rollback script

## Future Enhancements

Possible monitoring enhancements for future versions:

1. **Webhook Integration**: Send statistics to webhooks (Slack, Discord)
2. **Time-series Database**: Store statistics in a time-series DB for better visualization
3. **Alert System**: Set thresholds for automatic alerting
4. **User-specific Stats**: Track deduplication rates by user to identify problematic clients