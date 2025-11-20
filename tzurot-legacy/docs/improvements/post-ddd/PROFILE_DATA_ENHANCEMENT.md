# Profile Data Enhancement Plan

## Overview

Currently, we only extract 2 fields from the rich profile API data:

- `avatar` / `avatar_url` - Used for webhook avatars
- `name` - Used as display name

However, the API provides much more valuable data that could significantly enhance the user experience.

## Available Fields Analysis

### Currently Used (2 fields)

1. **avatar_url** - Profile avatar image
2. **name** - Display name

### High-Value Unused Fields

#### 1. Status & Presence (High Impact)

```javascript
shape_settings: {
  status: "🌙 Wandering the shadows, seeking those who dare to be free",
  status_type: "custom",
  status_emoji: "🌙"
}
```

**Use Cases:**

- Show as webhook "Playing" status
- Display in personality info command
- Add to list command output

#### 2. Error Handling (Medium Impact)

```javascript
error_message: "*laughs darkly* The mysteries of existence sometimes exceed even my grasp... ||*(an error has occurred)*||",
wack_message: "*dissolves into a swirl of darkness and owl feathers* Even chaos bends to my will..."
```

**Use Cases:**

- Personality-specific error messages instead of generic ones
- Character-appropriate responses to rate limits or failures
- Enhanced user experience during errors

#### 3. Initial Greeting (High Impact)

```javascript
shape_initial_message: 'I am she who was first, who refused to submit. Come closer...';
```

**Use Cases:**

- Send when personality is first activated in a channel
- Include in help/info commands
- Use as conversation starter

#### 4. Search & Discovery (Medium Impact)

```javascript
search_description: "Ancient queen of the night and mother of demons...",
search_tags_v2: ["occult", "feminist", "mythology", "witchcraft", ...]
```

**Use Cases:**

- Enhanced list command with descriptions
- Tag-based personality search/filtering
- Better personality discovery

#### 5. Usage Statistics (Low Impact)

```javascript
user_count: 123,
message_count: 20458
```

**Use Cases:**

- Show popularity in lists
- Sort personalities by usage
- Analytics for bot owner

#### 6. Appearance Description (Medium Impact)

```javascript
appearance: 'My eyes are a deep, mesmerizing yellow, filled with wisdom...';
```

**Use Cases:**

- Rich info command output
- RP enhancement
- Character reference

## Implementation Strategy

### Phase 1: Data Model Update (1-2 days)

1. Update personality data structure to include new fields
2. Modify ProfileInfoFetcher to extract additional fields
3. Update persistence layer to save new data
4. Add migration for existing personalities

### Phase 2: Core Features (3-4 days)

1. **Status Integration**
   - Add status to webhook creation
   - Display in info/list commands
2. **Error Messages**
   - Replace generic errors with personality-specific ones
   - Add to error handler

3. **Initial Messages**
   - Send on channel activation
   - Add to help command

### Phase 3: Enhanced Features (1 week)

1. **Search/Discovery**
   - Add search command with tags
   - Enhanced list with descriptions
   - Filter by tags

2. **Analytics**
   - Usage stats in info command
   - Sort by popularity option

## Code Changes Required

### 1. Update Profile Info Extraction

```javascript
// src/profileInfoFetcher.js
async function extractProfileData(profileInfo) {
  return {
    // Existing fields
    avatarUrl: profileInfo.avatar || profileInfo.avatar_url,
    displayName: profileInfo.name,

    // New fields
    status: profileInfo.shape_settings?.status,
    statusType: profileInfo.shape_settings?.status_type,
    statusEmoji: profileInfo.shape_settings?.status_emoji,
    initialMessage: profileInfo.shape_settings?.shape_initial_message,
    errorMessage: profileInfo.error_message,
    wackMessage: profileInfo.wack_message,
    description: profileInfo.search_description,
    tags: profileInfo.search_tags_v2 || [],
    appearance: profileInfo.shape_settings?.appearance,
    userCount: profileInfo.user_count,
    messageCount: profileInfo.message_count,
    tagline: profileInfo.tagline,
    category: profileInfo.category || profileInfo.custom_category,
  };
}
```

### 2. Update Personality Data Structure

```javascript
// Add to personality object
{
  fullName: "lilith-tzel-shani",
  displayName: "Lilith",
  avatarUrl: "https://...",

  // New fields
  profile: {
    status: "🌙 Wandering the shadows...",
    statusType: "custom",
    initialMessage: "I am she who was first...",
    errorMessage: "*laughs darkly*...",
    description: "Ancient queen of the night...",
    tags: ["occult", "feminist", ...],
    stats: {
      users: 123,
      messages: 20458
    }
  }
}
```

### 3. Update Commands

```javascript
// Enhanced info command
const embed = new EmbedBuilder()
  .setTitle(personality.displayName)
  .setDescription(personality.profile.description || 'No description available')
  .addFields(
    { name: 'Status', value: personality.profile.status || 'None', inline: true },
    { name: 'Users', value: personality.profile.stats.users.toString(), inline: true },
    { name: 'Messages', value: personality.profile.stats.messages.toString(), inline: true },
    { name: 'Tags', value: personality.profile.tags.join(', ') || 'None' }
  );
```

## Benefits

1. **Enhanced User Experience**
   - Personality-specific error messages
   - Rich status information
   - Better discovery through tags and descriptions

2. **Improved Engagement**
   - Initial greetings create better first impressions
   - Status messages add personality
   - Usage stats show popularity

3. **Better Organization**
   - Tag-based filtering
   - Descriptions in lists
   - Category organization

## Migration Considerations

1. **Backward Compatibility**
   - New fields should be optional
   - Graceful fallbacks for missing data
   - Don't break existing personalities

2. **Gradual Rollout**
   - Fetch new data only when personalities are accessed
   - Background job to update existing personalities
   - Rate limit considerations (3 second spacing)

3. **Storage Impact**
   - Additional ~2KB per personality
   - With 66 personalities: ~132KB additional storage
   - Minimal impact on JSON files
   - Consider in future database migration

## Testing Requirements

1. **Unit Tests**
   - Profile data extraction
   - New field validation
   - Fallback behavior

2. **Integration Tests**
   - Command updates
   - Error message replacement
   - Status display

3. **Manual Testing**
   - Visual verification of embeds
   - Error message formatting
   - Status display in Discord

## Timeline Estimate

- Phase 1 (Data Model): 1-2 days
- Phase 2 (Core Features): 3-4 days
- Phase 3 (Enhanced Features): 1 week
- Testing & Polish: 2-3 days

**Total: ~2 weeks for full implementation**

## Quick Wins (Can do immediately)

1. **Error Messages** (2 hours) ✅ COMPLETED
   - Extract error_message field ✅
   - Use in error handlers ✅
   - Immediate UX improvement ✅
   - Implementation Notes:
     - Added `getProfileErrorMessage()` to profileInfoFetcher
     - Updated PersonalityManager to fetch and store errorMessage field
     - Modified aiErrorHandler to use personality-specific messages
     - Properly handles reference ID insertion into existing error patterns
     - Falls back to default messages when personality has no error_message

2. **Status in Info** (1 hour)
   - Extract status field
   - Add to info command
   - Visual enhancement

3. **Initial Message** (2 hours)
   - Extract initial message
   - Send on activation
   - Better first impression
