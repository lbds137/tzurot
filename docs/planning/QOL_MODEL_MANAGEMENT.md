# Quality of Life: Model & Personality Management

> **Status:** Planning
> **Created:** 2025-11-06
> **Priority:** High - Blocking production issues
> **Branch:** `feat/qol-model-management` (off `develop`)

## Context

**Immediate Problem:** Claude Haiku gave a refusal message to a new user despite jailbreak, requiring manual model switch to Gemini 2.5 Flash. No easy way to manage LLM configs globally or per-user.

**Strategic Decision:** De-emphasize OpenMemory migration temporarily to focus on QoL improvements that make managing production issues easier. OpenMemory will resume after these are implemented.

## Goals

1. **Easy model switching** - Users and bot owner can quickly change models
2. **Persona management** - Users can create/edit multiple personas, set defaults, override per-personality
3. **Global vs per-user settings** - Clear hierarchy for LLM configs and personas
4. **Personality ownership** - Proper ownership model (bot owner = superuser, not special case)
5. **Visibility control** - Public/private personalities
6. **Interactive slash commands** - User-friendly CLI-style interface

## Database Schema Analysis

### What We Already Have ✅

The schema is already well-designed for this! We just need to wire it up properly:

#### `LlmConfig` (lines 73-101 in schema.prisma)

```prisma
model LlmConfig {
  id                   String    @id @default(uuid())
  name                 String    // "Uncensored", "Fast", "High Quality"
  description          String?
  ownerId              String?   // null = global, set = user-owned
  isGlobal             Boolean   @default(false)  // ✅ Already exists!
  isDefault            Boolean   @default(false)  // ✅ Already exists!
  model                String    // "google/gemini-2.5-flash"
  visionModel          String?
  temperature          Decimal?
  topP                 Decimal?
  topK                 Int?
  frequencyPenalty     Decimal?
  presencePenalty      Decimal?
  repetitionPenalty    Decimal?
  maxTokens            Int?
  memoryScoreThreshold Decimal?
  memoryLimit          Int?
  contextWindowSize    Int       @default(20)
  // ... relations
}
```

#### `PersonalityOwner` (lines 149-162)

```prisma
model PersonalityOwner {
  personalityId String
  userId        String
  role          String @default("owner")  // ✅ Already exists!
  // ... relations
  @@id([personalityId, userId])
}
```

#### `PersonalityDefaultConfig` (lines 103-112)

```prisma
model PersonalityDefaultConfig {
  personalityId String  @id @unique
  llmConfigId   String
  // ... relations
}
```

#### `UserPersonalityConfig` (lines 164-181)

```prisma
model UserPersonalityConfig {
  id            String   @id @default(uuid())
  userId        String
  personalityId String
  personaId     String?  // ✅ Already exists for persona overrides!
  llmConfigId   String?  // ✅ Already exists for LLM config overrides!
  @@unique([userId, personalityId])
}
```

#### `Persona` (lines 27-46)

```prisma
model Persona {
  name          String
  description   String?
  content       String          // Main persona text for LLM
  preferredName String?         // How LLM should address user
  pronouns      String?         // User's pronouns
  ownerId       String          // ✅ Already has ownership!
  // ... relations
}
```

#### `UserDefaultPersona` (lines 48-57)

```prisma
model UserDefaultPersona {
  userId    String  @id @unique
  personaId String
  // ... relations
  // ✅ Already exists for default persona!
}
```

### What's Missing ❌

1. **Personality visibility field** - Need `isPublic` boolean on `Personality` model
2. **Superuser role** - Need `isSuperuser` boolean on `User` model
3. **Ownership for existing personalities** - Need to assign bot owner as owner

## Schema Changes Required

### Migration 1: Add Personality Visibility

```prisma
model Personality {
  // ... existing fields
  isPublic  Boolean  @default(true)  // NEW: Controls visibility
  // ... existing fields
}
```

### Migration 2: Add Superuser Role

```prisma
model User {
  // ... existing fields
  isSuperuser  Boolean  @default(false)  // NEW: Bot owner flag
  // ... existing fields
}
```

## Implementation Phases

### Phase 1: Database Setup (1 session)

**Tasks:**

1. Create migration for `Personality.isPublic` field
2. Create migration for `User.isSuperuser` field
3. Write data migration script:
   - Find bot owner's User record (query by Discord ID from env var)
   - Set `isSuperuser = true` for bot owner
   - Create `PersonalityOwner` records for all existing personalities → bot owner
   - Set visibility based on bot owner's preferences:
     - Query bot owner: which personalities should be public vs private
     - Update `isPublic` field accordingly

**Deliverables:**

- `prisma/migrations/XXX_add_personality_visibility/migration.sql`
- `prisma/migrations/XXX_add_superuser_role/migration.sql`
- `scripts/setup-personality-ownership.ts` (one-time data migration)

### Phase 2: LLM Config Management Slash Commands (2 sessions)

**Commands to implement:**

#### User Commands (bot-client)

```
/llm-config list
  → Shows user's saved configs + global configs
  → Format: table with name, model, temp, owner (global/you)

/llm-config create
  → Interactive: bot asks questions step-by-step
  → Questions:
    1. "What would you like to name this config?" (validates unique for user)
    2. "Which model?" (dropdown from OpenRouter models or manual entry)
    3. "Temperature? (0.0-2.0, default 0.8)"
    4. "Max tokens? (optional, press Enter to skip)"
    5. "Description? (optional)"
  → Shows summary and asks for confirmation
  → Saves to database

/llm-config delete <name>
  → Deletes user's config (can't delete global ones)
  → Confirmation prompt

/llm-config show <name>
  → Shows full details of a config
  → Works for both user configs and global configs
```

#### Admin Commands (bot-client, superuser only)

```
/admin llm-config create-global
  → Same interactive flow as /llm-config create
  → Sets isGlobal=true
  → Available to all users

/admin llm-config delete-global <name>
  → Deletes global config
  → Warns if any personalities are using it

/admin llm-config set-default <name>
  → Sets global default LLM config (isDefault=true)
  → Used as fallback when no other config specified
```

**Implementation:**

- Create `services/bot-client/src/commands/llm-config.ts`
- Create `services/bot-client/src/commands/admin/llm-config.ts`
- Add interactive prompt helpers (reusable utility)
- Add permission checks (isSuperuser from database)

### Phase 3: Personality Model Override Commands (2 sessions)

**Commands to implement:**

#### User Commands

```
/model set <personality>
  → Shows dropdown of available configs (user configs + global configs)
  → Creates/updates UserPersonalityConfig with selected llmConfigId
  → Shows: "✅ @Lilith will now use 'Uncensored' config (gemini-2.5-flash)"

/model reset <personality>
  → Removes user's override
  → Reverts to personality's default config
  → Shows: "✅ @Lilith will now use personality default"

/model show <personality>
  → Shows current config hierarchy:
    "Current config for @Lilith:
     - Your override: Uncensored (gemini-2.5-flash, temp 0.9)
     - Personality default: High Quality (claude-sonnet-4-5, temp 0.8)
     - Global default: Standard (gpt-4o, temp 0.7)"
```

#### Admin Commands

```
/admin model set-personality-default <personality> <config-name>
  → Sets PersonalityDefaultConfig
  → Updates the fallback config for this personality
  → Shows: "✅ @Lilith's default model is now 'Uncensored'"

/admin personality set-visibility <personality> <public|private>
  → Updates Personality.isPublic
  → Private personalities only visible to owner
  → Shows: "✅ @Lilith is now private (only you can use it)"

/admin personality list
  → Shows all personalities with owner and visibility
  → Format: table with name, owner, visibility, default config
```

**Implementation:**

- Create `services/bot-client/src/commands/model.ts`
- Create `services/bot-client/src/commands/admin/personality.ts`
- Add permission checks for admin commands
- Update personality visibility logic in bot-client

### Phase 4: Persona Management Commands (2 sessions)

**Commands to implement:**

#### User Commands

```
/persona list
  → Shows user's personas with description
  → Indicates which is default
  → Format: table with name, description, is_default

/persona show <name>
  → Shows full persona details
  → Fields: name, description, content, preferredName, pronouns
  → Shows which personalities use this persona as override

/persona create
  → Interactive: bot asks questions step-by-step
  → Questions:
    1. "What would you like to name this persona?" (validates unique)
    2. "Description? (helps you remember what this is for)"
    3. "Persona content? (the text that describes you for the LLM)"
    4. "Preferred name? (optional - how the LLM should address you)"
    5. "Pronouns? (optional - she/her, they/them, etc.)"
  → Shows summary and asks for confirmation
  → Saves to database with ownerId = current user

/persona edit <name>
  → Shows dropdown of user's personas
  → Interactive editing of selected persona
  → Can edit any field (name, description, content, preferredName, pronouns)
  → Shows current value for each field
  → Press Enter to keep current value, or type new value

/persona delete <name>
  → Deletes user's persona
  → Warns if it's set as default (must change default first)
  → Warns if used as override for any personalities
  → Confirmation prompt

/persona set-default <name>
  → Sets persona as user's default
  → Updates UserDefaultPersona table
  → Shows: "✅ 'Casual Me' is now your default persona"

/persona set-for-personality <personality> <persona-name?>
  → Sets persona override for specific personality
  → If persona-name omitted, removes override (uses default)
  → Updates UserPersonalityConfig.personaId
  → Shows: "✅ When talking to @Lilith, you'll use 'Vampire RP' persona"
  → Or: "✅ When talking to @Lilith, you'll use your default persona"

/persona show-for-personality <personality>
  → Shows which persona is used for this personality
  → Shows hierarchy:
    "Persona for @Lilith:
     - Your override: Vampire RP
     - Your default: Casual Me
     (Currently using: Vampire RP)"
```

**Schema fields being used:**

```typescript
// Persona model (already exists)
{
  name: string;
  description: string;
  content: string; // Main persona text for LLM
  preferredName: string; // How LLM should address user
  pronouns: string; // User's pronouns
  ownerId: string; // User who owns this persona
}

// UserDefaultPersona (already exists)
{
  userId: string;
  personaId: string; // User's default persona
}

// UserPersonalityConfig.personaId (already exists)
{
  userId: string;
  personalityId: string;
  personaId: string; // Persona override for this personality
  llmConfigId: string; // LLM config override (from Phase 3)
}
```

**Interactive Edit Flow Example:**

```
User: /persona edit

Bot: Select a persona to edit:
     [Dropdown menu with user's personas]

User: [Selects "Vampire RP"]

Bot: Editing persona: Vampire RP

     Current name: Vampire RP
     New name? (press Enter to keep current)

User: [Enter]

Bot: Current description: For NSFW vampire roleplay
     New description? (press Enter to keep current)

User: For NSFW vampire and demon roleplay

Bot: Current content: I am Lila, a vampire-demon hybrid...
     New content? (press Enter to keep current, or 'edit' to open full editor)

User: edit

Bot: [Shows text input modal with full content]

User: [Edits content and submits]

Bot: Current preferred name: Lila
     New preferred name? (press Enter to keep current)

User: [Enter]

Bot: Current pronouns: she/her
     New pronouns? (press Enter to keep current)

User: [Enter]

Bot: Summary of changes:
     - Description: "For NSFW vampire roleplay" → "For NSFW vampire and demon roleplay"
     - Content: [Updated - 247 characters changed]

     Save these changes? (yes/no)

User: yes

Bot: ✅ Persona 'Vampire RP' updated!
```

**Implementation:**

- Create `services/bot-client/src/commands/persona.ts`
- Add interactive prompt helpers (reusable from Phase 2)
- Add dropdown menus for persona selection
- Add text modals for editing long content
- Handle persona validation (e.g., can't delete default persona)
- Update ai-worker to use persona overrides

### Phase 5: Config & Persona Resolution Logic (1 session)

**Update ai-worker to use both hierarchies:**

```typescript
// services/ai-worker/src/utils/resolveConfig.ts

interface ResolvedLlmConfig {
  llmConfig: LlmConfig;
  source: 'user-override' | 'personality-default' | 'global-default';
}

async function resolveLlmConfig(userId: string, personalityId: string): Promise<ResolvedLlmConfig> {
  // 1. Check user's override for this personality
  const userOverride = await prisma.userPersonalityConfig.findUnique({
    where: {
      userId_personalityId: { userId, personalityId },
    },
    include: { llmConfig: true },
  });

  if (userOverride?.llmConfig) {
    return {
      llmConfig: userOverride.llmConfig,
      source: 'user-override',
    };
  }

  // 2. Check personality's default config
  const personalityDefault = await prisma.personalityDefaultConfig.findUnique({
    where: { personalityId },
    include: { llmConfig: true },
  });

  if (personalityDefault?.llmConfig) {
    return {
      llmConfig: personalityDefault.llmConfig,
      source: 'personality-default',
    };
  }

  // 3. Fall back to global default
  const globalDefault = await prisma.llmConfig.findFirst({
    where: { isGlobal: true, isDefault: true },
  });

  if (!globalDefault) {
    throw new Error('No global default LLM config found');
  }

  return {
    llmConfig: globalDefault,
    source: 'global-default',
  };
}

interface ResolvedPersona {
  persona: Persona;
  source: 'personality-override' | 'user-default';
}

async function resolvePersona(userId: string, personalityId: string): Promise<ResolvedPersona> {
  // 1. Check user's override for this personality
  const userOverride = await prisma.userPersonalityConfig.findUnique({
    where: {
      userId_personalityId: { userId, personalityId },
    },
    include: { persona: true },
  });

  if (userOverride?.persona) {
    return {
      persona: userOverride.persona,
      source: 'personality-override',
    };
  }

  // 2. Fall back to user's default persona
  const defaultPersona = await prisma.userDefaultPersona.findUnique({
    where: { userId },
    include: { persona: true },
  });

  if (!defaultPersona?.persona) {
    throw new Error('User has no default persona');
  }

  return {
    persona: defaultPersona.persona,
    source: 'user-default',
  };
}
```

**Update ConversationalRAGService:**

- Replace hardcoded model selection with `resolveLlmConfig()`
- Replace persona lookup with `resolvePersona()`
- Log which config/persona sources were used (helps debugging)
- Handle vision models properly (separate field in LlmConfig)
- Use persona's `preferredName` and `pronouns` in prompt

### Phase 6: Testing & Refinement (1-2 sessions)

**LLM Config Test Cases:**

1. User creates LLM config → appears in `/llm-config list`
2. User sets model override → personality uses it
3. User resets override → reverts to personality default
4. Admin creates global config → available to all users
5. Admin sets personality visibility → non-owners can't see private
6. Config hierarchy works correctly (user > personality > global)
7. Interactive prompts handle invalid input gracefully

**Persona Test Cases:**

1. User creates persona → appears in `/persona list`
2. User sets default persona → used for all conversations (unless overridden)
3. User sets persona override for personality → that personality uses it
4. User edits persona → changes reflected in conversations
5. User tries to delete default persona → prevented with helpful error
6. Persona hierarchy works correctly (personality-override > user-default)
7. Interactive editing flow works smoothly

**Edge Cases:**

- Deleting a config that's in use (prevent or warn)
- User tries to delete global config (permission denied)
- Non-owner tries to use private personality (access denied)
- Personality has no default config (uses global)
- User has no default persona (error with helpful message)
- Deleting persona that's used as override (warn which personalities)
- User tries to delete last persona (must have at least one)

## Slash Command UX Design

### Interactive Flow Example

```
User: /llm-config create

Bot: Let's create a new LLM configuration!

     What would you like to name this config?
     (Examples: "Uncensored", "Fast & Cheap", "High Quality")

User: Uncensored

Bot: Great! Which model should this config use?

     Popular options:
     1. google/gemini-2.5-flash (fast, uncensored)
     2. anthropic/claude-sonnet-4-5 (high quality)
     3. openai/gpt-4o (balanced)
     4. Custom (type model name manually)

     Reply with a number or type a model name:

User: 1

Bot: Temperature setting? (0.0-2.0, default 0.8)
     Lower = more focused, Higher = more creative

     Press Enter for default or type a value:

User: 0.9

Bot: Max tokens? (optional)
     Leave blank to use model default

     Press Enter to skip or type a value:

User: [Enter]

Bot: Description? (optional)
     This helps you remember what this config is for

     Press Enter to skip or type a description:

User: For NSFW roleplay without censorship

Bot: Perfect! Here's your new config:

     Name: Uncensored
     Model: google/gemini-2.5-flash
     Temperature: 0.9
     Max Tokens: (model default)
     Description: For NSFW roleplay without censorship

     Save this config? (yes/no)

User: yes

Bot: ✅ Config 'Uncensored' created!

     Use it with: /model set <personality> Uncensored
```

### Dropdown Lists

For better UX, use Discord's native select menus where appropriate:

```typescript
// Example: Model selection dropdown
const modelSelectMenu = new StringSelectMenuBuilder()
  .setCustomId('model_select')
  .setPlaceholder('Choose a model')
  .addOptions([
    {
      label: 'Gemini 2.5 Flash (uncensored)',
      description: 'Fast, cheap, no refusals',
      value: 'google/gemini-2.5-flash',
    },
    {
      label: 'Claude Sonnet 4.5',
      description: 'High quality, expensive',
      value: 'anthropic/claude-sonnet-4-5',
    },
    // ... more options
    {
      label: 'Custom model',
      description: 'Enter model name manually',
      value: '__custom__',
    },
  ]);
```

## Permission System

### Superuser Check

```typescript
// services/bot-client/src/utils/permissions.ts

async function isSuperuser(discordUserId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { discordId: discordUserId },
    select: { isSuperuser: true },
  });

  return user?.isSuperuser ?? false;
}

async function requireSuperuser(interaction: ChatInputCommandInteraction): Promise<void> {
  const hasPermission = await isSuperuser(interaction.user.id);

  if (!hasPermission) {
    await interaction.reply({
      content: '❌ This command requires superuser permissions.',
      ephemeral: true,
    });
    throw new Error('Permission denied');
  }
}
```

### Personality Ownership Check

```typescript
async function canAccessPersonality(userId: string, personalityId: string): Promise<boolean> {
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    include: { owners: true },
  });

  if (!personality) return false;

  // Public personalities are accessible to everyone
  if (personality.isPublic) return true;

  // Check if user is an owner
  const isOwner = personality.owners.some(o => o.userId === userId);
  return isOwner;
}
```

## Data Migration Strategy

### Step 1: Identify Bot Owner

```typescript
// scripts/setup-personality-ownership.ts

// Bot owner's Discord ID from environment
const BOT_OWNER_DISCORD_ID = process.env.BOT_OWNER_DISCORD_ID;

if (!BOT_OWNER_DISCORD_ID) {
  throw new Error('BOT_OWNER_DISCORD_ID not set in environment');
}

// Find or create user record
let botOwner = await prisma.user.findUnique({
  where: { discordId: BOT_OWNER_DISCORD_ID },
});

if (!botOwner) {
  console.log('Bot owner user record not found - creating one');
  // Fetch from Discord API to get username
  const discordUser = await discord.users.fetch(BOT_OWNER_DISCORD_ID);

  botOwner = await prisma.user.create({
    data: {
      discordId: BOT_OWNER_DISCORD_ID,
      username: discordUser.username,
      isSuperuser: true,
    },
  });
}

// Set superuser flag if not already set
if (!botOwner.isSuperuser) {
  await prisma.user.update({
    where: { id: botOwner.id },
    data: { isSuperuser: true },
  });
}
```

### Step 2: Assign Ownership

```typescript
// Get all personalities without owners
const personalitiesWithoutOwners = await prisma.personality.findMany({
  where: {
    owners: { none: {} },
  },
});

console.log(`Found ${personalitiesWithoutOwners.length} personalities without owners`);

// Interactive prompt: which should be public?
const publicPersonalities = await promptForPublicPersonalities(personalitiesWithoutOwners);

// Assign ownership and visibility
for (const personality of personalitiesWithoutOwners) {
  const isPublic = publicPersonalities.includes(personality.id);

  await prisma.$transaction([
    // Create owner record
    prisma.personalityOwner.create({
      data: {
        personalityId: personality.id,
        userId: botOwner.id,
        role: 'owner',
      },
    }),

    // Set visibility
    prisma.personality.update({
      where: { id: personality.id },
      data: { isPublic },
    }),
  ]);

  console.log(`✅ ${personality.name}: owner=${botOwner.username}, public=${isPublic}`);
}
```

### Step 3: Interactive Visibility Selection

```typescript
async function promptForPublicPersonalities(personalities: Personality[]): Promise<string[]> {
  console.log('\nWhich personalities should be PUBLIC (visible to all users)?');
  console.log('You can change this later with /admin personality set-visibility\n');

  const choices = await checkbox({
    message: 'Select public personalities (space to toggle, enter to confirm)',
    choices: personalities.map(p => ({
      name: p.name,
      value: p.id,
      checked: true, // Default to public
    })),
  });

  return choices;
}
```

## Timeline Estimate

**Total: 9-11 focused work sessions**

| Phase                          | Sessions     | Description                        |
| ------------------------------ | ------------ | ---------------------------------- |
| 1. Database Setup              | 1 session    | Migrations, data migration script  |
| 2. LLM Config Commands         | 2 sessions   | User and admin commands            |
| 3. Model Override Commands     | 2 sessions   | Personality-specific commands      |
| 4. Persona Management Commands | 2 sessions   | Create, edit, delete, set defaults |
| 5. Config & Persona Resolution | 1 session    | Update ai-worker logic             |
| 6. Testing & Polish            | 1-2 sessions | Test all flows, edge cases         |

**Calendar time:**

- 2-3 sessions/week: **4-5 weeks**
- 3-4 sessions/week: **3 weeks**

## Success Criteria

**Phase completion means:**

**LLM Config Management:**

- ✅ Bot owner can create global LLM configs
- ✅ Bot owner can set default model per personality
- ✅ Bot owner can control personality visibility (public/private)
- ✅ Users can create their own LLM configs
- ✅ Users can override model for any personality they use
- ✅ Config hierarchy works correctly (user > personality > global)
- ✅ No more manual model switching in production emergencies!

**Persona Management:**

- ✅ Users can create multiple personas (different "you" for different contexts)
- ✅ Users can edit personas with interactive flow
- ✅ Users can set default persona (used unless overridden)
- ✅ Users can set persona per-personality (e.g., "Vampire RP" for @Lilith)
- ✅ Persona hierarchy works correctly (personality-override > user-default)
- ✅ Persona content properly integrated into prompts (preferredName, pronouns)

**Overall:**

- ✅ Interactive slash commands provide great UX
- ✅ All hierarchies clear and well-documented
- ✅ Edge cases handled gracefully with helpful errors

## After This Phase

Once QoL improvements are complete, we can:

1. Resume OpenMemory migration with better tooling
2. Handle model refusals gracefully (auto-fallback to uncensored model)
3. Users can experiment with different models without bothering bot owner
4. Bot owner has full control over defaults and visibility

## Environment Variables Needed

```bash
# Required for data migration
BOT_OWNER_DISCORD_ID=<your-discord-user-id>
```

## Related Documentation

- [OPENMEMORY_MIGRATION_PLAN.md](OPENMEMORY_MIGRATION_PLAN.md) - Will resume after QoL phase
- [V3_REFINEMENT_ROADMAP.md](V3_REFINEMENT_ROADMAP.md) - Overall v3 improvement roadmap
- [CLAUDE.md](../../CLAUDE.md) - Project workflow and git strategy
