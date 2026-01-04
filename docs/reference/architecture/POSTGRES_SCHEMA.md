# PostgreSQL Schema Design

## Design Philosophy

**Core Principle**: Maximum reusability, minimal duplication.

Unlike shapes.inc's approach where every setting is duplicated per personality, we use:

- **Global defaults** that apply unless overridden
- **Reusable templates** (personas, prompts, LLM configs) stored once, referenced many times
- **Foreign keys** to link related entities
- **Nullable overrides** for personality-specific customization

## Schema

### Core Tables

#### `users`

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id VARCHAR(20) UNIQUE NOT NULL,
  username VARCHAR(255) NOT NULL,
  global_persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_discord_id ON users(discord_id);
```

**Notes:**

- `global_persona_id`: User's default persona applied to all personalities unless overridden
- UUID-based for compatibility with shapes.inc imports

#### `personas`

```sql
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,  -- The actual persona/backstory text
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_global BOOLEAN DEFAULT false,  -- Can be used across all personalities
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_personas_owner ON personas(owner_id);
CREATE INDEX idx_personas_global ON personas(is_global) WHERE is_global = true;
```

**Notes:**

- Personas stored once, referenced by foreign key
- `is_global`: System-wide personas vs user-specific
- `owner_id`: NULL for system defaults, user UUID for personal personas

#### `system_prompts`

```sql
CREATE TABLE system_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_system_prompts_default ON system_prompts(is_default) WHERE is_default = true;
```

**Notes:**

- Reusable "jailbreak" prompts
- Only one can be default (enforced by partial unique index)
- Apply to personalities via foreign key

#### `llm_configs`

```sql
CREATE TABLE llm_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  model VARCHAR(255) NOT NULL,
  temperature DECIMAL(3,2),
  top_p DECIMAL(3,2),
  top_k INTEGER,
  frequency_penalty DECIMAL(3,2),
  presence_penalty DECIMAL(3,2),
  repetition_penalty DECIMAL(3,2),
  max_tokens INTEGER,
  is_default BOOLEAN DEFAULT false,
  is_free_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_llm_configs_default ON llm_configs(is_default) WHERE is_default = true;
CREATE INDEX idx_llm_configs_is_free_default ON llm_configs(is_free_default);
```

**Notes:**

- Reusable LLM configurations
- Store common presets: "Creative Writing", "Conversational", "Precise", etc.
- Users can create personal configs

#### `personalities`

```sql
CREATE TABLE personalities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  slug VARCHAR(255) UNIQUE NOT NULL,
  avatar_url TEXT,

  -- Core behavior (always use references)
  system_prompt_id UUID REFERENCES system_prompts(id) ON DELETE SET NULL,
  llm_config_id UUID REFERENCES llm_configs(id) ON DELETE SET NULL,

  -- Voice settings (for future)
  voice_enabled BOOLEAN DEFAULT false,
  voice_settings JSONB,  -- ElevenLabs config, etc.

  -- Image settings (for future)
  image_enabled BOOLEAN DEFAULT false,
  image_settings JSONB,

  -- Memory settings
  memory_enabled BOOLEAN DEFAULT true,
  context_window_size INTEGER DEFAULT 20,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_personalities_slug ON personalities(slug);
```

**Notes:**

- **Always use references**: Even one-off configs are stored as reusable templates
- Can be marked as private/user-specific via owner_id
- No inline duplication ever
- JSONB for flexible voice/image settings (evolving requirements)

#### `personality_owners`

```sql
CREATE TABLE personality_owners (
  personality_id UUID REFERENCES personalities(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'owner',  -- 'owner', 'editor', 'viewer'
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (personality_id, user_id)
);

CREATE INDEX idx_personality_owners_user ON personality_owners(user_id);
CREATE INDEX idx_personality_owners_personality ON personality_owners(personality_id);
```

**Notes:**

- Many-to-many: Personalities can have multiple owners
- Role-based permissions for future ACL

#### `user_personality_settings`

```sql
CREATE TABLE user_personality_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  personality_id UUID REFERENCES personalities(id) ON DELETE CASCADE,

  -- Override user's global persona for this personality
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,

  -- Override LLM settings for this user+personality combo
  llm_config_id UUID REFERENCES llm_configs(id) ON DELETE SET NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, personality_id)
);

CREATE INDEX idx_user_personality_settings_user ON user_personality_settings(user_id);
CREATE INDEX idx_user_personality_settings_personality ON user_personality_settings(personality_id);
```

**Notes:**

- Per-user, per-personality overrides
- Falls back to user's global persona if `persona_id` is NULL
- Falls back to personality's LLM config if no override
- All overrides use reusable references, never inline values

### Conversation Tables

#### `conversation_history`

```sql
CREATE TABLE conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id VARCHAR(20) NOT NULL,
  personality_id UUID REFERENCES personalities(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,  -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_channel_personality ON conversation_history(channel_id, personality_id, created_at DESC);
CREATE INDEX idx_conversation_user ON conversation_history(user_id);
```

**Notes:**

- Replaces in-memory ConversationManager
- TTL cleanup policy (e.g., delete after 7 days)
- Indexed for fast "last N messages" queries

#### `activated_channels`

```sql
CREATE TABLE activated_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id VARCHAR(20) NOT NULL,
  personality_id UUID REFERENCES personalities(id) ON DELETE CASCADE,
  auto_respond BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(channel_id, personality_id)
);

CREATE INDEX idx_activated_channels_channel ON activated_channels(channel_id);
CREATE INDEX idx_activated_channels_personality ON activated_channels(personality_id);
```

**Notes:**

- Tracks which personalities auto-respond in which channels
- Multiple personalities can be active in same channel

## Configuration Resolution Logic

### Persona Resolution (Priority Order)

1. `user_personality_settings.persona_id` (user override for this personality)
2. `users.global_persona_id` (user's global default)
3. System default persona (fallback)

### System Prompt Resolution

1. `personalities.system_prompt_id` → `system_prompts.content` (personality's template)
2. System default prompt (from `system_prompts` WHERE `is_default = true`)

### LLM Config Resolution

1. `user_personality_settings.llm_config_id` (user override for this personality)
2. `personalities.llm_config_id` (personality's default config)
3. System default config (from `llm_configs` WHERE `is_default = true`)

## Example Queries

### Get Effective Config for User + Personality

```sql
WITH effective_config AS (
  SELECT
    p.id as personality_id,
    p.name as personality_name,

    -- Persona resolution
    COALESCE(
      ups.persona_id,
      u.global_persona_id,
      (SELECT id FROM personas WHERE is_global = true LIMIT 1)
    ) as effective_persona_id,

    -- System prompt resolution
    COALESCE(
      p.inline_system_prompt,
      sp.content,
      (SELECT content FROM system_prompts WHERE is_default = true)
    ) as effective_system_prompt,

    -- LLM config resolution
    COALESCE(
      ups_llm.model,
      p_llm.model,
      (SELECT model FROM llm_configs WHERE is_default = true)
    ) as effective_model,

    COALESCE(
      ups_llm.temperature,
      p_llm.temperature,
      (SELECT temperature FROM llm_configs WHERE is_default = true)
    ) as effective_temperature

  FROM personalities p
  LEFT JOIN users u ON u.id = $1  -- user_id parameter
  LEFT JOIN user_personality_settings ups ON ups.user_id = $1 AND ups.personality_id = p.id
  LEFT JOIN system_prompts sp ON sp.id = p.system_prompt_id
  LEFT JOIN llm_configs p_llm ON p_llm.id = p.llm_config_id
  LEFT JOIN llm_configs ups_llm ON ups_llm.id = ups.llm_config_id

  WHERE p.id = $2  -- personality_id parameter
)
SELECT * FROM effective_config;
```

### Get Last N Messages for Channel + Personality

```sql
SELECT role, content, created_at
FROM conversation_history
WHERE channel_id = $1
  AND personality_id = $2
ORDER BY created_at DESC
LIMIT $3;
```

### Check if Channel is Activated

```sql
SELECT personality_id, auto_respond
FROM activated_channels
WHERE channel_id = $1
  AND auto_respond = true;
```

## Migration from shapes.inc

### Persona Migration

```typescript
// shapes.inc has inline personas per personality
// Extract unique personas, deduplicate, create reusable entries

const shapesPersona = shapesData.user_prompt;
const existingPersona = await db.personas.findFirst({
  where: { content: shapesPersona },
});

const personaId =
  existingPersona?.id ??
  (await db.personas.create({
    data: {
      name: `${shapesData.name} Persona`,
      content: shapesPersona,
      owner_id: userId,
      is_global: false,
    },
  }).id);

// Link to user
await db.users.update({
  where: { id: userId },
  data: { global_persona_id: personaId },
});
```

### System Prompt Migration

```typescript
// shapes.inc "jailbreak" → system_prompts
const shapesJailbreak = shapesData.jailbreak;

// Check if this exact prompt exists
const existingPrompt = await db.system_prompts.findFirst({
  where: { content: shapesJailbreak },
});

const promptId =
  existingPrompt?.id ??
  (await db.system_prompts.create({
    data: {
      name: `${shapesData.name} System Prompt`,
      content: shapesJailbreak,
      is_default: false,
    },
  }).id);

// Use in personality
await db.personalities.create({
  data: {
    name: shapesData.name,
    system_prompt_id: promptId,
    // ...
  },
});
```

### LLM Config Migration

```typescript
// Extract LLM settings from shapes.inc
// Check if this exact config exists (deduplicate)
const existingConfig = await db.llm_configs.findFirst({
  where: {
    model: shapesData.engine_model,
    temperature: shapesData.engine_temperature,
    top_p: shapesData.engine_top_p,
    frequency_penalty: shapesData.engine_frequency_penalty,
  },
});

const configId =
  existingConfig?.id ??
  (await db.llm_configs.create({
    data: {
      name: `${shapesData.name} Config`,
      model: shapesData.engine_model,
      temperature: shapesData.engine_temperature,
      top_p: shapesData.engine_top_p,
      frequency_penalty: shapesData.engine_frequency_penalty,
      // ...
    },
  }).id);

// Always use reference
await db.personalities.create({
  data: {
    name: shapesData.name,
    llm_config_id: configId,
    // ...
  },
});
```

## Advantages Over shapes.inc

1. **No Duplication**: Update one persona/prompt/config, applies everywhere
2. **Global Defaults**: Set once, use for all new personalities
3. **Easy Bulk Updates**: Change all personalities using a template with one query
4. **User Flexibility**: Per-personality overrides without duplicating entire config
5. **Versioning Ready**: Can add version tracking to templates
6. **Sharing**: Users can share personas/prompts with others

## Next Steps

1. Set up Prisma ORM with this schema
2. Create migration scripts
3. Build repository layer
4. Add shapes.inc import tool
5. Build personality management API
