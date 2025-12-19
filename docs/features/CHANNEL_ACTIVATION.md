# Channel Activation Feature

**Status**: Implemented (v3.0.0-beta.23)
**Added**: December 2025

## Overview

Channel activation allows server admins to enable automatic personality responses in specific Discord channels. When a personality is activated in a channel, it responds to all messages without requiring @mentions.

This is a port of the v2 "auto-response" feature, redesigned for the v3 microservices architecture.

## User Commands

### `/channel activate`

Activates a personality in the current channel.

**Parameters:**
- `personality` (required) - The personality to activate (autocomplete enabled)

**Permissions Required:**
- `ManageMessages` permission in the channel

**Behavior:**
- Only one personality can be active per channel
- Activating a new personality replaces any existing activation
- Private personalities can only be activated by their owner (or bot owner)

**Example:**
```
/channel activate personality:lilith
```

### `/channel deactivate`

Deactivates the personality in the current channel.

**Permissions Required:**
- `ManageMessages` permission in the channel

**Behavior:**
- Returns success even if no personality was active (idempotent)

**Example:**
```
/channel deactivate
```

### `/channel list`

Lists all channel activations visible to you.

**Parameters:** None

**Behavior:**
- Shows all activations in the current server
- Displays channel name, personality name, who activated it, and when

**Example output:**
```
Channel Activations (3)

#general - Lilith (activated by @user, 2 days ago)
#roleplay - Sarcastic (activated by @admin, 1 week ago)
#testing - Default (activated by @owner, just now)
```

## How It Works

### Message Processing Chain

The `ActivatedChannelProcessor` sits in the message processing chain:

1. `BotMessageFilter` - Ignores bot messages
2. `EmptyMessageFilter` - Ignores empty messages
3. `VoiceMessageProcessor` - Transcribes voice messages
4. `ReplyMessageProcessor` - Handles replies to bot messages
5. **`ActivatedChannelProcessor`** - Handles activated channel auto-responses
6. `PersonalityMentionProcessor` - Handles @mentions

This ordering ensures:
- Explicit replies to the bot take priority over auto-responses
- @mentions still work in activated channels (for other personalities)

### Private Personality Access

When a channel has a private personality activated:

1. **Owner/Authorized users**: Get normal auto-responses
2. **Unauthorized users**:
   - Do NOT get auto-responses (message continues to next processor)
   - Receive a one-time notification explaining the situation
   - Can still @mention other personalities they have access to

The notification is rate-limited (1 hour cooldown per user per channel) to prevent spam.

### Database Schema

```sql
CREATE TABLE activated_channels (
  id UUID PRIMARY KEY,
  channel_id VARCHAR(20) NOT NULL UNIQUE,
  personality_id UUID NOT NULL REFERENCES personalities(id),
  guild_id VARCHAR(20),  -- Reserved for future guild-scoped features
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Key constraints:**
- `channel_id` is unique - only one activation per channel
- Uses deterministic UUIDs (`generateActivatedChannelUuid`) for dev/prod sync compatibility

### API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/user/channel/activate` | POST | User | Activate personality in channel |
| `/user/channel/deactivate` | DELETE | User | Deactivate channel |
| `/user/channel/:channelId` | GET | Service | Check if channel is activated |
| `/user/channel/list` | GET | User | List all activations |

**Note:** The GET endpoint uses service auth (not user auth) because it's called by the bot-client during message processing, where no user context is available.

## Design Decisions

### One Personality Per Channel

**Decision:** Only one personality can be active in a channel at a time.

**Rationale:**
- Simplifies UX - users know which personality will respond
- Prevents "personality fights" where multiple bots try to respond
- Matches v2 behavior
- Future multi-personality support tracked in `docs/improvements/multi-personality-support.md`

### ManageMessages Permission

**Decision:** Require `ManageMessages` permission to activate/deactivate.

**Rationale:**
- Balances accessibility with preventing abuse
- `ManageMessages` is commonly given to moderators
- Prevents random users from changing channel behavior
- Doesn't require full admin access

### Activation Replacement (Not Toggle)

**Decision:** Activating a new personality replaces the old one (no explicit deactivate-then-activate).

**Rationale:**
- Better UX - single command to switch personalities
- Uses database transaction to prevent race conditions
- Atomic operation - no intermediate state

### Dev/Prod Sync Exclusion

**Decision:** `activated_channels` table is NOT synced between dev and prod environments.

**Rationale:**
- Dev and prod use different Discord bot instances
- Syncing would cause double-responses in servers with both bots
- Each environment should have independent channel activations

## Files Changed (Implementation Reference)

### Bot Client
- `services/bot-client/src/processors/ActivatedChannelProcessor.ts` - Main processor
- `services/bot-client/src/processors/notificationCache.ts` - Rate limiting cache
- `services/bot-client/src/commands/channel/` - Slash commands

### API Gateway
- `services/api-gateway/src/routes/user/channel/` - REST endpoints
- `services/api-gateway/src/services/sync/config/syncTables.ts` - Sync exclusion

### Common Types
- `packages/common-types/src/schemas/api/channel.ts` - Zod schemas
- `packages/common-types/src/utils/deterministicUuid.ts` - UUID generator

## Testing

### Unit Tests
- `ActivatedChannelProcessor.test.ts` - 11 tests
- `notificationCache.test.ts` - 11 tests
- `activate.test.ts`, `deactivate.test.ts`, `get.test.ts`, `list.test.ts` - API endpoint tests

### Manual Testing
1. Activate a personality: `/channel activate personality:lilith`
2. Send a message - bot should auto-respond
3. Try activating a different personality - should replace
4. Deactivate: `/channel deactivate`
5. Send a message - bot should NOT auto-respond
6. Test with private personality as non-owner - should get notification

## Known Limitations

1. **No guild-scoped activations** - Currently channel-level only
2. **No scheduled activations** - Always-on when activated
3. **No activation history** - Only current state is stored
4. **Single personality per channel** - Multi-personality planned for future

## Related Documentation

- `docs/improvements/multi-personality-support.md` - Future multi-personality plans
- `docs/planning/V2_FEATURE_TRACKING.md` - V2 parity tracking
- `docs/standards/SLASH_COMMAND_IMPLEMENTATION.md` - Command implementation patterns
