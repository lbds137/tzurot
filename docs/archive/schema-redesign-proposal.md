# Schema Redesign Proposal - Removing Circular Dependencies

## Problems with Current Schema

1. **Circular dependency**: User ↔ Persona with nullable FKs
2. **Confusing persona ownership**: `isGlobal` flag doesn't make semantic sense (personas are personal)
3. **LLM config ownership unclear**: No user-owned configs, only "global" ones
4. **Active config tracking missing**: No clear way to track which config is active

## Design Goals

1. ✅ No circular dependencies
2. ✅ Clear ownership (NOT NULL where appropriate)
3. ✅ Support user-owned personas (unlimited per user)
4. ✅ Support both global and user-owned LLM configs
5. ✅ Track active/default for both personas and configs
6. ✅ User-level overrides for personality configs

## Proposed Schema

### User Management (unchanged)

```prisma
model User {
  id        String @id @default(uuid()) @db.Uuid
  discordId String @unique @map("discord_id") @db.VarChar(20)
  username  String @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations (no circular dependencies!)
  ownedPersonas           Persona[]
  ownedLlmConfigs         LlmConfig[]
  defaultPersonaLink      UserDefaultPersona?
  personalityConfigLinks  UserPersonalityConfig[]
  personalityOwners       PersonalityOwner[]
  conversationHistory     ConversationHistory[]
  activatedChannels       ActivatedChannel[]

  @@index([discordId])
  @@map("users")
}
```

### Personas (user-owned only, no circular dependency)

```prisma
model Persona {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  description String? @db.Text
  content     String  @db.Text // The actual persona/backstory text

  // User personalization fields
  preferredName String? @map("preferred_name") @db.VarChar(255)
  pronouns      String? @db.VarChar(100)

  // Ownership - REQUIRED (NOT NULL)
  ownerId String @map("owner_id") @db.Uuid
  owner   User   @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  usersUsingAsDefault     UserDefaultPersona[]
  userPersonalitySettings UserPersonalityConfig[]

  @@index([ownerId])
  @@map("personas")
}

// Separate table to track user's default persona (no circular dependency)
model UserDefaultPersona {
  userId String @unique @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  personaId String  @map("persona_id") @db.Uuid
  persona   Persona @relation(fields: [personaId], references: [id], onDelete: Cascade)

  updatedAt DateTime @updatedAt @map("updated_at")

  @@id([userId])
  @@map("user_default_personas")
}
```

### LLM Configs (global OR user-owned)

```prisma
model LlmConfig {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  description String? @db.Text

  // Ownership - NULLABLE for global configs, set for user-owned
  ownerId String? @map("owner_id") @db.Uuid
  owner   User?   @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  isGlobal Boolean @default(false) @map("is_global") // System-wide (ownerId NULL) vs user-specific

  // LLM parameters
  model             String   @db.VarChar(255)
  visionModel       String?  @map("vision_model") @db.VarChar(255)
  temperature       Decimal? @db.Decimal(3, 2)
  topP              Decimal? @map("top_p") @db.Decimal(3, 2)
  topK              Int?     @map("top_k")
  frequencyPenalty  Decimal? @map("frequency_penalty") @db.Decimal(3, 2)
  presencePenalty   Decimal? @map("presence_penalty") @db.Decimal(3, 2)
  repetitionPenalty Decimal? @map("repetition_penalty") @db.Decimal(3, 2)
  maxTokens         Int?     @map("max_tokens")

  // Memory retrieval settings
  memoryScoreThreshold Decimal? @map("memory_score_threshold") @db.Decimal(3, 2)
  memoryLimit          Int?     @map("memory_limit")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  personalitiesUsingAsDefault PersonalityDefaultConfig[]
  userPersonalityConfigs      UserPersonalityConfig[]

  @@index([ownerId])
  @@index([isGlobal])
  @@map("llm_configs")
}

// Track default LLM config per personality (global level)
model PersonalityDefaultConfig {
  personalityId String      @unique @map("personality_id") @db.Uuid
  personality   Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  llmConfigId String    @map("llm_config_id") @db.Uuid
  llmConfig   LlmConfig @relation(fields: [llmConfigId], references: [id], onDelete: Cascade)

  updatedAt DateTime @updatedAt @map("updated_at")

  @@id([personalityId])
  @@map("personality_default_configs")
}
```

### System Prompts (global only, unchanged)

```prisma
model SystemPrompt {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  description String? @db.Text
  content     String  @db.Text
  isDefault   Boolean @default(false) @map("is_default")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  personalities Personality[]

  @@index([isDefault])
  @@map("system_prompts")
}
```

### Personalities (simplified, no circular dependencies)

```prisma
model Personality {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  displayName String? @map("display_name") @db.VarChar(255)
  slug        String  @unique @db.VarChar(255)
  avatarUrl   String? @map("avatar_url") @db.Text

  // Core behavior - system prompt (global only)
  systemPromptId String?       @map("system_prompt_id") @db.Uuid
  systemPrompt   SystemPrompt? @relation(fields: [systemPromptId], references: [id], onDelete: SetNull)

  // Default LLM config tracked in separate table (no FK here!)

  // Character definition
  characterInfo          String  @map("character_info") @db.Text
  personalityTraits      String  @map("personality_traits") @db.Text
  personalityTone        String? @map("personality_tone") @db.VarChar(500)
  personalityAge         String? @map("personality_age") @db.VarChar(100)
  personalityLikes       String? @map("personality_likes") @db.Text
  personalityDislikes    String? @map("personality_dislikes") @db.Text
  conversationalGoals    String? @map("conversational_goals") @db.Text
  conversationalExamples String? @map("conversational_examples") @db.Text
  customFields           Json?   @map("custom_fields")

  // Voice settings
  voiceEnabled  Boolean @default(false) @map("voice_enabled")
  voiceSettings Json?   @map("voice_settings")

  // Image settings
  imageEnabled  Boolean @default(false) @map("image_enabled")
  imageSettings Json?   @map("image_settings")

  // Memory settings
  memoryEnabled     Boolean @default(true) @map("memory_enabled")
  contextWindowSize Int     @default(20) @map("context_window_size")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  owners               PersonalityOwner[]
  defaultConfigLink    PersonalityDefaultConfig?
  userConfigs          UserPersonalityConfig[]
  conversationHistory  ConversationHistory[]
  activatedChannels    ActivatedChannel[]

  @@index([slug])
  @@map("personalities")
}

model PersonalityOwner {
  personalityId String      @map("personality_id") @db.Uuid
  personality   Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  role String @default("owner") @db.VarChar(50)

  createdAt DateTime @default(now()) @map("created_at")

  @@id([personalityId, userId])
  @@index([userId])
  @@index([personalityId])
  @@map("personality_owners")
}
```

### User-Personality Configuration (combines persona + LLM config overrides)

```prisma
model UserPersonalityConfig {
  id String @id @default(uuid()) @db.Uuid

  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  personalityId String      @map("personality_id") @db.Uuid
  personality   Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  // Override persona for this user+personality combo
  personaId String?  @map("persona_id") @db.Uuid
  persona   Persona? @relation(fields: [personaId], references: [id], onDelete: SetNull)

  // Override LLM config for this user+personality combo
  llmConfigId String?    @map("llm_config_id") @db.Uuid
  llmConfig   LlmConfig? @relation(fields: [llmConfigId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([userId, personalityId])
  @@index([userId])
  @@index([personalityId])
  @@map("user_personality_configs")
}
```

## Key Improvements

### 1. No Circular Dependencies

- User → Persona (one-way via ownerId)
- User → LlmConfig (one-way via ownerId)
- Separate tracking tables for defaults/active configs

### 2. Clear Ownership

- Personas: ALWAYS user-owned (ownerId NOT NULL)
- LlmConfigs: Can be global (ownerId NULL, isGlobal true) OR user-owned (ownerId set)
- SystemPrompts: Always global (no ownership)

### 3. Active/Default Tracking

- `UserDefaultPersona`: One default persona per user
- `PersonalityDefaultConfig`: One default LLM config per personality (global level)
- `UserPersonalityConfig`: Per-user overrides for personality configs (persona + LLM config)

### 4. Clear Resolution Hierarchy

**For LLM Config:**

1. Check `UserPersonalityConfig.llmConfigId` (user override)
2. Fall back to `PersonalityDefaultConfig.llmConfigId` (personality default)
3. Fall back to system default (query `LlmConfig` where `isGlobal = true` and `isDefault = true`)

**For Persona:**

1. Check `UserPersonalityConfig.personaId` (per-personality override)
2. Fall back to `UserDefaultPersona.personaId` (user's default)
3. Fall back to auto-generated default (create on user registration)

## Migration Strategy

1. Create new tables: `UserDefaultPersona`, `PersonalityDefaultConfig`
2. Rename `UserPersonalitySettings` → `UserPersonalityConfig`
3. Migrate existing data:
   - Move `User.globalPersonaId` → `UserDefaultPersona.personaId`
   - Move `Personality.llmConfigId` → `PersonalityDefaultConfig.llmConfigId`
   - Set `Persona.ownerId` from context (or admin user ID for orphans)
   - Mark existing LLM configs as global
4. Drop old columns: `User.globalPersonaId`, `Personality.llmConfigId`, `Persona.isGlobal`
5. Make `Persona.ownerId` NOT NULL

## Benefits

✅ No circular dependencies in the schema
✅ Clear ownership model (personas always user-owned, configs can be global or user-owned)
✅ Explicit tracking of defaults/active configs (separate tables)
✅ Clean resolution hierarchy for overrides
✅ Scales to future features (favorites, recent, templates, etc.)
✅ No confusion about nullable FKs where they shouldn't exist
✅ Database constraints properly enforce business rules

## Design Decisions (Resolved)

1. ✅ **User-created LLM configs**: YES - users can create/edit their own LLM configs via slash commands
2. ✅ **System personas**: NO - not needed. Personalities define bot behavior; personas define user identity
3. ✅ **System prompt templates**: Deferred - shapes.inc had templates, but not urgent for v3 MVP

## Implementation Status

- [x] Schema design complete
- [ ] Prisma migration created
- [ ] Data migration script
- [ ] Applied to development
- [ ] Applied to production
- [ ] Application code updated to use new tables
