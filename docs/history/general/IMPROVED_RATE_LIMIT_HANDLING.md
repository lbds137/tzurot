# Improved Rate Limit Handling for Owner Personality Seeding

## Issue
Even with the previous fix of sequential processing and 5-second delays, some personalities were still timing out when seeding 66 owner personalities:
- `catra-hi-khatula-lesbit` 
- `cold-kerach-batuach`

## Root Cause
With 66 personalities and the rate limiter queue, some requests were timing out before they could execute due to:
1. **Short timeout**: 15-second timeout per request was too short for requests waiting in queue
2. **Cumulative delays**: With many personalities, later ones had to wait a long time in the queue
3. **No initial delay**: Starting immediately after bot initialization could hit early rate limits

## Solutions Implemented

### 1. Increased Request Timeout
- Changed from 15 seconds to 30 seconds in `profileInfoFetcher.js`
- Gives requests more time to complete, especially when waiting in queue

### 2. Increased Delay Between Personalities
- Changed from 5 seconds to 8 seconds between each personality registration
- Provides more breathing room for the API rate limits

### 3. ~~Added Initial Delay for Large Batches~~ (Removed)
- ~~Added 10-second initial delay when seeding more than 10 personalities~~
- This was unnecessary - the bot is already initialized when this runs

## Time Impact
For 66 personalities:
- Per-personality delay: 8 seconds × 65 = 520 seconds
- Total time: ~8.7 minutes

While this is longer, it ensures all personalities are properly seeded without timeouts.

## Alternative Approaches for Future
1. **Batch API calls**: If the API supports it, fetch multiple profiles at once
2. **Database caching**: Store profile info to avoid repeated API calls
3. **Progressive loading**: Load personalities on-demand rather than all at startup
4. **Parallel requests with proper queuing**: More sophisticated rate limiting that allows some parallelism