# Enhanced Context Feature

## Overview

The Enhanced Context feature automatically provides rich contextual information to AI responses by including chat history, memories, and knowledge from backed-up personality data. This feature is designed for use with external AI services that can leverage additional context for more coherent and personalized responses.

## Status

- **Feature Flag**: `features.enhanced-context`
- **Default**: `false` (disabled)
- **Availability**: Preview feature as of v1.3.2

## How It Works

When enabled, the bot automatically includes the following context with each AI request:

1. **Chat History**: Up to 10 recent messages from the conversation
2. **Memories**: Up to 5 relevant memories from the personality's memory bank
3. **Knowledge**: Up to 3 knowledge items from the personality's knowledge base

### Data Sources

The enhanced context pulls from:
- **PersonalityDataRepository**: Automatically detects backup data in `data/personalities/`
- **PersonalityDataService**: Provides unified access to personality data
- **ExtendedPersonalityProfile**: Converts backup data to structured format on first access

## Enabling the Feature

### For Development/Testing

Add to your `.env` file:
```env
FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT=true
```

### Requirements

1. **Backup Data**: The personality must have backup data in `data/personalities/`
2. **External AI Service**: Works best with AI services that can process extended context
3. **Performance Consideration**: Adds overhead to each request due to context preparation

## Data Migration

The feature includes automatic, transparent migration:
- No manual intervention required
- Migration happens on first access (lazy loading)
- Converts backup data to ExtendedPersonalityProfile format
- Preserves all original data while adding structure

## Example Context Structure

When enhanced context is enabled, the AI service receives:

```json
{
  "personality": "personality-name",
  "message": "user message",
  "context": {
    "recentMessages": [
      {
        "role": "user",
        "content": "previous message",
        "timestamp": 1234567890
      }
      // ... up to 10 messages
    ],
    "memories": [
      {
        "id": "memory-id",
        "content": "remembered information",
        "importance": 0.8
      }
      // ... up to 5 memories
    ],
    "knowledge": [
      {
        "topic": "subject",
        "content": "knowledge content",
        "confidence": 0.9
      }
      // ... up to 3 items
    ]
  }
}
```

## Performance Impact

- **Memory Usage**: Increases slightly due to cached personality data
- **Request Latency**: Adds 50-200ms for context preparation
- **API Payload**: Larger requests may affect rate limits

## Security Considerations

- Context data is only sent to the configured AI service
- No context is logged or stored beyond the request
- Sensitive personality data remains in local backup files

## Troubleshooting

### Context Not Loading

1. Check if backup data exists: `ls data/personalities/personality-name/`
2. Verify feature flag is enabled: Check for `FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT=true`
3. Check logs for migration errors

### Performance Issues

1. Reduce context limits in code if needed
2. Consider caching strategies for frequently accessed personalities
3. Monitor API rate limits with larger payloads

## Future Enhancements

- Configurable context limits
- Selective context inclusion
- Context relevance scoring
- Performance optimizations

## Related Components

- `PersonalityDataRepository` - Handles backup data access
- `PersonalityDataService` - Service layer for personality data
- `ExtendedPersonalityProfile` - Domain model for rich personality data
- `PersonalityProfile` - Base profile with publicApiData property