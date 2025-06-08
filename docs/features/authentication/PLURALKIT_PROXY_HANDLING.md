# PluralKit Proxy Handling

## Problem Description

Users of PluralKit (a popular Discord bot for plural communities) were experiencing duplicate responses from our bot when interacting with personalities in servers. This happened because:

1. A user would send a message with an @mention (e.g., `@Lilith hello`)
2. PluralKit would quickly delete this message and replace it with a webhook message containing similar content
3. Our bot would process both the original message and the webhook message, resulting in duplicate responses

## Solution: Content-based Duplicate Detection with Delayed Processing

We implemented a content-similarity based detection system with delayed processing to avoid duplicate responses:

### 1. Content Similarity Detection

We created a new utility module (`contentSimilarity.js`) that can:
- Calculate the similarity between two message contents using Levenshtein distance
- Determine if two messages are similar enough to be considered duplicates
- Provide configuration for proxy message delay time

### 2. Message Tracking and History

In bot.js, we implemented:
- A `recentMessagesByChannel` map to track message history by channel
- Functions to track messages and mark them as handled
- A cleanup system to prevent memory issues

### 3. Delayed Processing for Server Personality Interactions

For any message in a server that would trigger a personality response (mentions, active conversations, or activated channels):
1. We track the message in the channel's history
2. Check if a similar message was recently processed
3. Add a delay before processing (configurable, default 2.5 seconds)
4. After the delay, we check if:
   - The message still exists (wasn't deleted by PluralKit)
   - A similar message hasn't already been processed
5. Only then do we process the message and generate a response

### 4. Webhook Message Handling

For webhook messages:
1. We identify if they're from proxy systems like PluralKit
2. Track them in the channel's message history
3. Mark them as "handled" immediately to prevent duplicates

## Implementation Details

### contentSimilarity.js

```javascript
function calculateSimilarity(str1, str2) {
  // Implementation of Levenshtein distance algorithm
  // Returns normalized similarity score between 0 and 1
}

function areContentsSimilar(content1, content2, threshold = 0.8) {
  const similarity = calculateSimilarity(content1, content2);
  return similarity >= threshold;
}

function getProxyDelayTime() {
  return 2500; // 2.5 seconds
}
```

### Bot.js Modifications

1. **Message Tracking**:
```javascript
function trackMessageInChannel(message) {
  // Track message in channel history
}

function markMessageAsHandled(message) {
  // Mark a message as already processed
}

function hasSimilarRecentMessage(message) {
  // Check if a similar message was recently processed
}
```

2. **Delayed Processing for Server Interactions**:
```javascript
// When any personality interaction is detected in a server (mentions, active conversations, activated channels)
trackMessageInChannel(message);

if (hasSimilarRecentMessage(message)) {
  // Skip processing for likely duplicate
  return;
}

// Add delay to allow proxy systems to process
setTimeout(async () => {
  try {
    // Re-fetch message to ensure it still exists
    // Process only if it hasn't been deleted
    markMessageAsHandled(messageToProcess);
    await handlePersonalityInteraction(...);
  } catch (err) {
    // Handle errors
  }
}, contentSimilarity.getProxyDelayTime());
```

## Advantages of This Approach

1. **No Proxy-Specific Pattern Detection**: Works with any proxy system, not just PluralKit
2. **Graceful Handling**: Properly handles both the original and proxied messages
3. **Content-Based**: Focuses on message content similarity rather than user-specific configuration
4. **Configurable Thresholds**: Similarity threshold and delay times can be adjusted as needed
5. **Memory-Efficient**: Includes cleanup to prevent memory issues
6. **Robustness**: Handles edge cases where messages are deleted or modified
7. **Optimization for DMs**: Skips unnecessary delay for DM conversations (since PluralKit doesn't work in DMs)
8. **Consistent Behavior**: Ensures the same behavior across different server interaction paths

## Future Improvements

1. **Per-User Configuration**: Allow users to specify if they use proxy systems
2. **Adaptive Timing**: Dynamically adjust delay times based on observed proxy patterns
3. **Channel Settings**: Allow channel/server-specific configuration of proxy handling
4. **Enhanced Similarity Metrics**: Potentially use more sophisticated content comparison algorithms
5. **Direct PluralKit Integration**: Consider direct API integration with PluralKit when available