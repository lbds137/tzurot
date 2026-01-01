# Extended Context Improvements Plan

> **Status**: Planning
> **Created**: 2026-01-01
> **Related**: `docs/standards/TRI_STATE_PATTERN.md`

## Executive Summary

This plan addresses feature parity gaps between Message References (explicit) and Extended Context (ambient), adds configurable message limits, and implements a "Lazy Vision" caching strategy for cost-efficient image processing.

## MCP Review Findings (Addressed)

### 1. Boolean Resolution Hierarchy

**Issue**: Original hierarchy (Personality → Channel → Global) allows personality to override channel admin's explicit OFF.

**Resolution**: Channel admin intent takes precedence. When a channel explicitly disables extended context, personalities cannot override this. See updated resolution logic in Phase 1.

### 2. Image URL Expiration

**Issue**: Discord CDN URLs expire (query params change), causing cache misses when using URL hash as cache key.

**Resolution**: Add `id` field to `AttachmentMetadata` schema. Use Discord's stable attachment ID (snowflake) as the primary cache key, with URL hash as fallback for embed images without IDs.

### 3. Duration Null Semantics

**Issue**: `null` could mean either "inherit from parent" or "disabled".

**Resolution**: Clarify that `null` always means "inherit/auto" at channel and personality levels. At the global level, the column has an explicit default value, so null is not possible. A separate "disabled" concept (where applicable, e.g., maxAge) uses `null` at the global level to mean "disabled".

## Current State Analysis

### Feature Comparison: References vs Extended Context

| Feature | References | Extended Context | Decision |
|---------|-----------|------------------|----------|
| **Image Processing** | Vision model describes | Placeholder only | Add Lazy Vision cache |
| **Voice Transcription** | Live API + DB fallback | DB lookup only | Keep as-is (acceptable) |
| **Message Links** | BFS crawl, `[Reference N]` | Inline blockquote, depth=1 | Keep as-is (by design) |
| **Timestamps** | Full ISO timestamps | None | Add time gap markers |
| **Location Context** | Full hierarchy | None | Keep as-is (by design) |
| **Format** | XML structured | `[Author]: content` | Keep as-is (better for LLMs) |
| **Limits** | 20 (constant) | 100 (constant) | Make configurable |

### "By Design" Gaps - Validated

After MCP council review, these gaps are **intentional and correct**:

1. **No location context**: Extended context messages are all from the current channel. Adding location to each message would be redundant and waste tokens.

2. **Simple `[Author]: content` format**: This format matches LLM training data (chat logs), reduces token overhead, and is easier to parse than XML. XML is reserved for the focused `<contextual_references>` section.

3. **Less rich metadata**: Extended context provides "peripheral vision" - ambient awareness. Full metadata (webhookId, etc.) is only needed for messages the user explicitly draws attention to.

---

## Phase 1: Configurable Message Limits

### Schema Changes

```prisma
model AdminSettings {
  // ... existing fields
  extendedContextMaxMessages  Int  @default(20)  // Global default
}

model ChannelSettings {
  // ... existing fields
  extendedContextMaxMessages  Int?  // null = follow global
}

model Personality {
  // ... existing fields
  extendedContextMaxMessages  Int?  // null = follow channel/global
}
```

### Resolution Hierarchy

#### Boolean (Enable/Disable) Resolution

**Channel admin intent takes precedence**. When a server admin explicitly disables extended context for a channel, personalities cannot override this.

```typescript
// Boolean Resolution: Channel explicit OFF beats everything
function resolveExtendedContextEnabled(
  personality: boolean | null,  // null = auto
  channel: boolean | null,      // null = auto
  globalDefault: boolean
): boolean {
  // Channel explicit OFF is definitive (server admin intent)
  if (channel === false) {
    return false;
  }

  // Channel explicit ON is definitive
  if (channel === true) {
    // But personality can still opt-out
    if (personality === false) {
      return false;
    }
    return true;
  }

  // Channel is AUTO - personality can decide
  if (personality !== null) {
    return personality;
  }

  // Both are AUTO - follow global default
  return globalDefault;
}
```

**Rationale**: A server admin disabling extended context in a channel (e.g., for privacy or cost reasons) should not be overridable by individual personalities. However, personalities can still opt-out even in enabled channels.

#### Numeric Limits Resolution (Max Messages, Max Images)

Limits use a **"most restrictive wins"** approach for cost safety:

```typescript
// Limit Resolution: Channel can cap personality to prevent cost spikes
function resolveMaxMessages(
  personality: number | null,
  channel: number | null,
  global: number
): number {
  const HARD_CAP = 100; // Discord API single-fetch limit

  // Start with global default
  let limit = global;

  // Channel can override (either direction)
  if (channel !== null) {
    limit = channel;
  }

  // Personality can adjust within channel bounds
  if (personality !== null) {
    // If channel set a cap, personality can go lower but not higher
    if (channel !== null) {
      limit = Math.min(personality, channel);
    } else {
      limit = personality;
    }
  }

  // Enforce hard cap
  return Math.min(limit, HARD_CAP);
}
```

**Rationale**: A busy channel like #general shouldn't have a verbose AI personality fetching 100 messages when the channel admin set a limit of 20 to reduce noise/cost.

### Command Interface

```
/channel context max-messages <count>   # Set channel limit (1-100, or "auto")
/character settings max-messages <count> # Set personality limit (1-100, or "auto")
/admin settings context-max-messages <count> # Set global default
```

### Default Values

| Level | Default | Rationale |
|-------|---------|-----------|
| Global | 20 | Safe, low cost, sufficient for peripheral awareness |
| Channel | null (follow global) | Most channels don't need customization |
| Personality | null (follow channel/global) | Most personalities don't need customization |
| Hard Cap | 100 | Discord API single-fetch limit |

---

## Phase 2: Time Gap Markers

### Problem

Extended context has no temporal information, making it hard for the AI to understand conversation flow (e.g., a message from 2 hours ago vs 2 minutes ago).

### Solution

Instead of timestamping every message (token-expensive), inject **time gap markers** when significant pauses occur:

```
[Alice]: Hey everyone
[Bob]: Hi there!
[Carol]: What's up?
--- 2 hours later ---
[Alice]: Is anyone still here?
[Bob]: Yeah, just got back
```

### Implementation

```typescript
const TIME_GAP_THRESHOLDS = {
  MINOR: 15 * 60 * 1000,    // 15 minutes
  MAJOR: 2 * 60 * 60 * 1000, // 2 hours
  HUGE: 24 * 60 * 60 * 1000, // 24 hours
};

function formatTimeGap(gapMs: number): string | null {
  if (gapMs < TIME_GAP_THRESHOLDS.MINOR) return null;

  if (gapMs >= TIME_GAP_THRESHOLDS.HUGE) {
    const days = Math.floor(gapMs / (24 * 60 * 60 * 1000));
    return `--- ${days} day${days > 1 ? 's' : ''} later ---`;
  }

  if (gapMs >= TIME_GAP_THRESHOLDS.MAJOR) {
    const hours = Math.floor(gapMs / (60 * 60 * 1000));
    return `--- ${hours} hour${hours > 1 ? 's' : ''} later ---`;
  }

  const minutes = Math.floor(gapMs / (60 * 1000));
  return `--- ${minutes} minutes later ---`;
}
```

### Time-Based Cutoff (Optional)

In addition to message count limits, add an **optional staleness cutoff**:

```prisma
model AdminSettings {
  extendedContextMaxAge  Int?  @default(null)  // Seconds. null = disabled (no age limit)
}

model ChannelSettings {
  extendedContextMaxAge  Int?  // Seconds. null = follow global
}

model Personality {
  extendedContextMaxAge  Int?  // Seconds. null = follow channel/global
}
```

**Key points:**
- `null` = disabled (no age filtering, only count-based limits apply)
- When enabled, messages older than this threshold are excluded
- Uses the same resolution hierarchy as message count limits
- Stored in seconds for query efficiency

**See**: `docs/planning/DURATION_UTILITY.md` for the reusable Duration parsing/display utility.

---

## Phase 3: Extended Context Vision

### Problem

Processing images in extended context is expensive:
- 100 messages × ~2 images = 200 vision API calls
- Each call costs money and adds latency

### Solution: Configurable Proactive + Lazy Caching

Two complementary strategies:

1. **Proactive Processing**: Process up to X most recent images in extended context
2. **Lazy Caching**: Cache all vision descriptions for reuse

### Schema: Configurable Image Limit

```prisma
model AdminSettings {
  // ... existing
  extendedContextMaxImages  Int  @default(0)  // 0 = no proactive processing
}

model ChannelSettings {
  // ... existing
  extendedContextMaxImages  Int?  // null = follow global
}

model Personality {
  // ... existing
  extendedContextMaxImages  Int?  // null = follow channel/global
}
```

**Resolution**: Same "most restrictive wins" as message count limits.

**Values**:
- `0` = No proactive processing (pure lazy mode - only process on explicit reference)
- `1-10` = Process up to N most recent images in extended context
- Recommended default: `0` or `3` depending on cost tolerance

### The Combined Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Extended Context Processing                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │ Collect images from messages  │
              │ (within message count limit)  │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │ For each image, check cache   │
              └───────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
    Cache HIT                               Cache MISS
          │                                       │
          ▼                                       ▼
   Use cached                    ┌────────────────────────────┐
   description                   │ Is this in the "top N"     │
                                 │ most recent images?        │
                                 └────────────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                         Yes (proactive)                 No (lazy)
                              │                               │
                              ▼                               ▼
                    ┌─────────────────┐            ┌─────────────────┐
                    │ Call Vision API │            │ Show placeholder│
                    │ Cache result    │            │ [image: file]   │
                    └─────────────────┘            └─────────────────┘
```

### Example Scenarios

**Scenario 1: maxImages = 0 (Pure Lazy Mode)**
```
Extended context has 5 images
  → All show as placeholders: "[Attachments: [image/png: cat.png]]"
  → User replies to one image
  → Vision API processes it, caches description
  → Next request: that one image shows description, others still placeholders
```

**Scenario 2: maxImages = 3 (Proactive + Lazy)**
```
Extended context has 5 images (newest to oldest: A, B, C, D, E)
  → Check cache for all 5
  → A, B, C are in "top 3" - process any that aren't cached
  → D, E show as placeholders (unless previously cached)
  → Result: Recent images understood, older ones need explicit reference
```

**Scenario 3: Channel override for meme channel**
```
Global default: maxImages = 3
#memes channel: maxImages = 0  (channel overrides to save costs)
  → All images in #memes show as placeholders
  → Other channels still process top 3
```

### Explicit Reference Still Works

When a user replies to or links a message with an image:
1. Existing `ReferencedMessageFormatter` processes it via vision API
2. **NEW**: Description is cached in database
3. Future extended context lookups use the cached description

This means even with `maxImages = 0`, images that users care about (reference explicitly) will eventually populate the cache.

### Schema

```prisma
model ImageDescriptionCache {
  id                  String   @id @default(uuid())
  discordAttachmentId String?  @unique  // Discord's stable attachment ID (preferred key)
  discordMessageId    String   // The message containing the image
  imageUrlHash        String?  @unique  // SHA-256 hash of base URL (fallback for embeds without attachment IDs)
  description         String   // The vision model's description
  modelUsed           String   // Which model generated this
  createdAt           DateTime @default(now())

  @@index([discordMessageId])
}
```

**Cache Key Strategy**:
1. **Primary**: Use `discordAttachmentId` (snowflake) for Discord attachments - stable across URL expiration
2. **Fallback**: Use `imageUrlHash` for embed images that don't have Discord attachment IDs

**AttachmentMetadata Update**:
```typescript
// packages/common-types/src/types/schemas.ts
export const attachmentMetadataSchema = z.object({
  id: z.string().optional(),        // NEW: Discord attachment ID (stable snowflake)
  url: z.string(),
  originalUrl: z.string().optional(),
  contentType: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  isVoiceMessage: z.boolean().optional(),
  duration: z.number().optional(),
  waveform: z.string().optional(),
});
```

**Existing VisionDescriptionCache Update**:
The Redis-based `VisionDescriptionCache` in `packages/common-types/src/services/VisionDescriptionCache.ts` should also be updated to use attachment ID when available:
```typescript
// Updated to prefer attachment ID over URL hash
getCacheKey(attachment: { id?: string; url: string }): string {
  if (attachment.id) {
    return `${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}id:${attachment.id}`;
  }
  // Fallback: strip query params before hashing (for URL stability)
  const baseUrl = attachment.url.split('?')[0];
  const urlHash = createHash('sha256').update(baseUrl).digest('hex');
  return `${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}url:${urlHash}`;
}
```

### Cache Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Image in Channel History                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Check Cache     │
                    │ by URL hash     │
                    └─────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       Cache Hit                        Cache Miss
              │                               │
              ▼                               ▼
   ┌─────────────────────┐         ┌─────────────────────┐
   │ [Image: description]│         │ [Image: filename]   │
   │ (Rich context)      │         │ (Placeholder only)  │
   └─────────────────────┘         └─────────────────────┘
                                            │
                                            ▼
                               User explicitly references
                               (reply or message link)
                                            │
                                            ▼
                               ┌─────────────────────┐
                               │ Vision API called   │
                               │ (existing pipeline) │
                               └─────────────────────┘
                                            │
                                            ▼
                               ┌─────────────────────┐
                               │ Cache description   │
                               │ for future use      │
                               └─────────────────────┘
```

### Benefits

- **No additional cost for new images**: Only pay when user explicitly references
- **Cumulative improvement**: Frequently referenced images get cached, enriching future context
- **Graceful degradation**: Uncached images still show as placeholders

---

## Phase 4: Voice Message Parity (Optional)

### Current Gap

- **References**: Live transcription via API + DB fallback
- **Extended Context**: DB lookup only (no live transcription)

### Recommendation

**Keep as-is**. Unlike images, voice messages in extended context are less common and the DB lookup works for messages that were previously processed. Adding live transcription would significantly increase latency and cost.

If needed in the future, apply the same "Lazy Cache" pattern as images.

---

## Command Structure Redesign: Interactive Dashboard

### Design Principles

1. **Consistent UX** across all levels (admin, channel, character)
2. **Interactive dashboard** for discoverability and ease of use
3. **Scalable** - new settings don't require new subcommands
4. **Visual feedback** - see current values and what changed

### The Dashboard Pattern

All three levels use the same interaction flow with consistent naming:

```
/admin settings     → Global settings dashboard
/channel settings   → Channel settings dashboard
/character settings → Character settings dashboard
```

Each dashboard shows the same "Extended Context" section with the same controls.

### Dashboard Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: User runs command                                        │
│ /channel settings                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Bot shows dashboard embed (ephemeral)                    │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔧 Extended Context Settings                                 │ │
│ │ Channel: #general                                            │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ Enabled:      Auto (following global: ✅ On)                 │ │
│ │ Max Messages: Auto (following global: 20)                    │ │
│ │ Max Age:      Auto (following global: Disabled)              │ │
│ │ Max Images:   Auto (following global: 0)                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ [ 🔧 Configure ] [ 🔄 Reset to Auto ] [ ❌ Close ]               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ User clicks "Configure"
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Select menu appears                                      │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Select setting to modify:                              [▼]  │ │
│ │ ○ Enabled (On/Off/Auto)                                     │ │
│ │ ○ Max Messages (1-100)                                      │ │
│ │ ○ Max Age (duration or disabled)                            │ │
│ │ ○ Max Images (0-10)                                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ User selects "Max Messages"
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Modal opens for that setting                             │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Configure Max Messages                                       │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ Enter a number (1-100) or "auto" to follow hierarchy:       │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ 50                                                      │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │                                                              │ │
│ │ Current: Auto (global: 20)                                   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ [ Submit ] [ Cancel ]                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Dashboard refreshes with new value                       │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔧 Extended Context Settings                                 │ │
│ │ Channel: #general                                            │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ Enabled:      Auto (following global: ✅ On)                 │ │
│ │ Max Messages: **50** ← Channel override                      │ │
│ │ Max Age:      Auto (following global: Disabled)              │ │
│ │ Max Images:   Auto (following global: 0)                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ✅ Max Messages updated: Auto → 50                               │
└─────────────────────────────────────────────────────────────────┘
```

### Unified Command Structure

```
/admin settings          → Global settings dashboard
/channel settings        → Channel settings dashboard
/character settings      → Character settings dashboard
```

All three commands launch the same dashboard UI with the same interaction patterns.

### Shared Dashboard Components

Create reusable components in `services/bot-client/src/utils/dashboard/settings/`:

```typescript
// settingsDashboard.ts

interface ContextSettings {
  enabled: boolean | null;        // null = auto
  maxMessages: number | null;     // null = auto
  maxAge: number | null;          // seconds, null = auto/disabled
  maxImages: number | null;       // null = auto
}

interface DashboardConfig {
  level: 'global' | 'channel' | 'character';
  targetName: string;             // "Global", "#general", "Aria"
  currentSettings: ContextSettings;
  effectiveSettings: ContextSettings;  // What actually applies (resolved)
  sources: {
    enabled: 'global' | 'channel' | 'personality';
    maxMessages: 'global' | 'channel' | 'personality';
    maxAge: 'global' | 'channel' | 'personality';
    maxImages: 'global' | 'channel' | 'personality';
  };
}

function buildContextDashboardEmbed(config: DashboardConfig): EmbedBuilder;
function buildContextDashboardButtons(config: DashboardConfig): ActionRowBuilder;
function buildSettingSelectMenu(config: DashboardConfig): StringSelectMenuBuilder;
function buildSettingModal(setting: keyof ContextSettings, current: ContextSettings): ModalBuilder;
```

### Setting-Specific Modals

Each setting type has appropriate input handling:

| Setting | Modal Input | Validation |
|---------|-------------|------------|
| Enabled | Select: On / Off / Auto | N/A |
| Max Messages | Text: number or "auto" | 1-100 or "auto" |
| Max Age | Text: duration or "auto"/"off" | Duration utility |
| Max Images | Text: number or "auto" | 0-10 or "auto" |

### Display Format for "Auto" Values

Show what "auto" resolves to:

```
Max Messages: Auto (global: 20)        ← Following global default
Max Messages: Auto (channel: 50)       ← Following channel override
Max Messages: **30** ← Override        ← This level has an override
```

### Replacing Existing Commands

Since none of these features are live yet, we can cleanly replace:

| Old Command | New Command |
|-------------|-------------|
| `/admin settings action:extended-context-enable` | `/admin settings` dashboard |
| `/admin settings action:extended-context-disable` | `/admin settings` dashboard |
| `/admin settings action:list` | `/admin settings` dashboard |
| `/channel context action:enable` | `/channel settings` dashboard |
| `/channel context action:disable` | `/channel settings` dashboard |
| `/channel context action:status` | `/channel settings` dashboard |
| `/channel context action:auto` | Dashboard "Reset to Auto" button |
| `/character settings action:extended-context-*` | `/character settings` dashboard |

The dashboard approach consolidates all actions into a single, intuitive interface per level.

---

## Implementation Priority

### Phase 0: Foundation (Do First)
1. **Duration utility** (`packages/common-types/src/utils/Duration.ts`)
   - Parse human-readable durations
   - Store as seconds in DB
   - Display formatting
   - See: `docs/planning/DURATION_UTILITY.md`

2. **Schema changes** (single migration)
   ```prisma
   model AdminSettings {
     extendedContextDefault       Boolean @default(true)
     extendedContextMaxMessages   Int     @default(20)
     extendedContextMaxAge        Int?    // seconds, null = disabled
     extendedContextMaxImages     Int     @default(0)
   }

   model ChannelSettings {
     extendedContext              Boolean?
     extendedContextMaxMessages   Int?
     extendedContextMaxAge        Int?
     extendedContextMaxImages     Int?
   }

   model Personality {
     extendedContext              Boolean?
     extendedContextMaxMessages   Int?
     extendedContextMaxAge        Int?
     extendedContextMaxImages     Int?
   }
   ```

3. **Resolver services**
   - `ExtendedContextSettingsResolver` - resolves all 4 settings at once
   - Returns both raw values and effective values with sources

### Phase 1: Interactive Dashboard
1. **Shared dashboard components** (`utils/dashboard/settings/`)
   - Embed builder
   - Button/menu builders
   - Modal builders
   - Setting validation

2. **Command handlers**
   - `/admin settings` → global dashboard
   - `/channel settings` → channel dashboard
   - `/character settings` → character dashboard

3. **API endpoints** (if needed)
   - `PUT /admin/context-settings`
   - `PATCH /user/channel/:id/context-settings`
   - `PUT /user/personality/:slug` (extend existing)

### Phase 2: Time Features
1. Time gap marker injection in `DiscordChannelFetcher`
2. Staleness filtering using resolved `maxAge`
3. Duration autocomplete handler

### Phase 3: Vision Cache
1. `ImageDescriptionCache` schema
2. Cache population in `ReferencedMessageFormatter`
3. Cache lookup in `MessageContentBuilder`
4. Proactive processing for top N images

---

## Migration Notes

### Phase 1 Migration

```sql
-- Add new columns with safe defaults
ALTER TABLE "AdminSettings" ADD COLUMN "extendedContextMaxMessages" INTEGER DEFAULT 20;
ALTER TABLE "ChannelSettings" ADD COLUMN "extendedContextMaxMessages" INTEGER;
ALTER TABLE "Personality" ADD COLUMN "extendedContextMaxMessages" INTEGER;
```

No data transformation needed - all new columns are nullable with defaults.

---

## Success Metrics

1. **Cost Reduction**: Lower average vision API calls per conversation
2. **Latency**: No significant increase in response time
3. **User Experience**: AI demonstrates better temporal understanding (time gaps)
4. **Configurability**: Admins can tune limits per channel/personality

---

## References

- `docs/standards/TRI_STATE_PATTERN.md` - Pattern for cascading settings
- `services/bot-client/src/services/ExtendedContextResolver.ts` - Existing resolver pattern
- `services/ai-worker/src/services/ReferencedMessageFormatter.ts` - Image processing pipeline
