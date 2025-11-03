# Discord Slash Command UX Features & Implementation Plan

> Created: 2025-10-22
> Status: Planning document for future implementation

## Overview

Discord slash commands in 2025 offer rich interactive features beyond simple text responses. This document outlines available features and our implementation plan for v3.

## Available Discord Features

### 1. **Subcommand Groups** ✅ (Planned)

Organize related commands under a single parent command.

**Example:**

```
/admin
  ├─ servers
  ├─ kick <server_id>
  ├─ usage
  └─ personality
      ├─ list
      ├─ create <name> <slug> <system-prompt-id> <llm-config-id>
      ├─ update <slug> [options]
      └─ delete <slug>
  └─ llm-config
      ├─ list
      ├─ create <name> <model> [options]
      ├─ update <id> [options]
      └─ delete <id>
  └─ system-prompt
      ├─ list
      ├─ create <name> <content>
      ├─ update <id> <content>
      └─ delete <id>
```

**Benefits:**

- Counts as 1 command instead of 12+
- Better organization
- Cleaner command list
- Easier to discover related functionality

**Limits:**

- Max 100 global commands
- Max 100 guild-specific commands
- Max 25 options per command
- 4000 character limit for entire command tree (names + descriptions + options)

---

### 2. **Autocomplete** 🔮 (High Value)

Dynamic suggestions as user types command arguments.

**Use Cases for Tzurot:**

- `/admin personality update <slug>` → Autocomplete personality names from database
- `/admin llm-config update <name>` → Autocomplete config names
- Model selection → Show available models (gpt-4, claude-3, etc.)

**Benefits:**

- Reduces typos
- Improves discoverability
- Better UX than remembering exact names

**Implementation:**

```typescript
data.addStringOption(option =>
  option
    .setName('personality')
    .setDescription('Choose a personality')
    .setAutocomplete(true)  // Enable autocomplete
);

// In autocomplete handler:
async autocomplete(interaction: AutocompleteInteraction) {
  const focusedValue = interaction.options.getFocused();
  const personalities = await db.personality.findMany({
    where: { slug: { contains: focusedValue } }
  });
  await interaction.respond(
    personalities.slice(0, 25).map(p => ({ name: p.name, value: p.slug }))
  );
}
```

**Limits:**

- Up to 25 suggestions
- Must respond within 3 seconds
- Cannot defer autocomplete responses

---

### 3. **Ephemeral Messages** 🔒 (Already Using)

Private responses only visible to command user.

**Current Usage:**

- All `/admin-*` commands already use `MessageFlags.Ephemeral`

**Benefits:**

- Security (admin commands don't spam channels)
- Privacy (user settings changes)
- Cleaner channels

**Implementation:**

```typescript
await interaction.reply({
  content: 'Private response',
  flags: MessageFlags.Ephemeral,
});
```

**Note:** Once sent, cannot change ephemeral state. Token valid for 15 minutes after initial response.

---

### 4. **Buttons** 🔘 (Medium Value)

Interactive buttons attached to messages.

**Use Cases for Tzurot:**

- `/admin personality list` → [Edit] [Delete] buttons per personality
- Confirmation prompts: "Delete personality Lilith? [Confirm] [Cancel]"
- Pagination: [Previous] [Next] for long lists

**Benefits:**

- No need to type follow-up commands
- Safer destructive actions (confirmation prompts)
- Better list navigation

**Implementation:**

```typescript
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId('delete_confirm')
    .setLabel('Confirm Delete')
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setCustomId('delete_cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
);

await interaction.reply({
  content: 'Delete personality "Lilith"?',
  components: [row],
  flags: MessageFlags.Ephemeral,
});
```

**Limits:**

- Max 5 action rows per message
- Max 25 buttons per message (5 per row)

---

### 5. **Select Menus** 📋 (High Value)

Dropdown menus for selecting from multiple options.

**Types:**

- **String Select Menu** - Custom options (most flexible)
- **User Select Menu** - Choose Discord users
- **Role Select Menu** - Choose server roles
- **Channel Select Menu** - Choose channels
- **Mentionable Select Menu** - Choose users/roles

**Use Cases for Tzurot:**

- Model selection dropdown (cleaner than autocomplete for fixed lists)
- Temperature presets: [Conservative, Balanced, Creative]
- Personality selection for batch operations

**Benefits:**

- Better than autocomplete for fixed option lists
- Supports multi-select (min/max values)
- Built-in validation

**Implementation:**

```typescript
const selectMenu = new StringSelectMenuBuilder()
  .setCustomId('model_select')
  .setPlaceholder('Choose an AI model')
  .addOptions([
    { label: 'GPT-4', value: 'openai/gpt-4' },
    { label: 'Claude 3 Opus', value: 'anthropic/claude-3-opus' },
    { label: 'Gemini Pro', value: 'google/gemini-pro' },
  ])
  .setMinValues(1)
  .setMaxValues(1);
```

**Limits:**

- Max 25 options per select menu

---

### 6. **Modals** 📝 (High Value for Multi-Line Input)

Pop-up forms for complex input.

**Use Cases for Tzurot:**

- Creating/editing system prompts (multi-line text)
- Creating personalities (multiple fields: name, description, traits, etc.)
- Editing personality info (better than multiple slash command args)

**Benefits:**

- Multi-line text input (perfect for prompts!)
- Multiple fields in one interaction
- Better UX than long command arguments
- Input validation

**Implementation:**

```typescript
const modal = new ModalBuilder()
  .setCustomId('create_personality')
  .setTitle('Create New Personality')
  .addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Personality Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('system_prompt')
        .setLabel('System Prompt')
        .setStyle(TextInputStyle.Paragraph) // Multi-line!
        .setRequired(true)
    )
  );

await interaction.showModal(modal);
```

**Limits:**

- Max 5 text input components per modal
- Text inputs can be Short (single line) or Paragraph (multi-line)

---

### 7. **Context Menus** 🖱️ (Lower Priority)

Right-click menu options on messages/users.

**Use Cases:**

- Right-click message → "Add to Memory"
- Right-click user → "View User Settings"

**Known Limitation:**

- Doesn't work if user lacks "Send Messages" permission (even for ephemeral responses)
- Discord acknowledged this as a known issue

**Implementation:**

```typescript
// User context menu
new ContextMenuCommandBuilder().setName('View Settings').setType(ApplicationCommandType.User);

// Message context menu
new ContextMenuCommandBuilder().setName('Add to Memory').setType(ApplicationCommandType.Message);
```

---

## Implementation Plan for v3

### Phase 1: Restructure Existing Admin Commands ✅

**Priority:** High
**Effort:** Low (1-2 hours)

1. Convert `/admin-servers`, `/admin-kick`, `/admin-usage` to subcommands
2. Create `/admin` parent command with subcommand groups
3. Maintain existing functionality, just reorganized

**Result:** `/admin servers`, `/admin kick`, `/admin usage`

---

### Phase 2: Add Database Management Commands 🎯

**Priority:** Critical (blocks daily operations)
**Effort:** Medium (4-6 hours)

Implement under `/admin` parent:

#### **Personality Management**

- `/admin personality list` - Show all personalities (with buttons for edit/delete?)
- `/admin personality create` - Open modal for creating personality
- `/admin personality update <slug>` - Open modal with current values pre-filled
- `/admin personality delete <slug>` - Confirmation button before delete

#### **LLM Config Management**

- `/admin llm-config list` - Show all configs
- `/admin llm-config create` - Modal for new config (includes model dropdown)
- `/admin llm-config update <name>` - Modal with current values
- `/admin llm-config delete <name>` - Confirmation button

#### **System Prompt Management**

- `/admin system-prompt list` - Show all prompts
- `/admin system-prompt create` - Modal (multi-line text for content)
- `/admin system-prompt update <name>` - Modal with current content
- `/admin system-prompt delete <name>` - Confirmation button

---

### Phase 3: Add UX Enhancements 🎨

**Priority:** Medium (quality of life)
**Effort:** Medium (3-4 hours)

1. **Autocomplete** for personality/config selection
2. **Modals** for multi-line input (system prompts!)
3. **Buttons** for confirmation prompts (safer deletes)
4. **Select Menus** for model selection (cleaner than typing)
5. **Pagination** for long lists (if >25 personalities/configs)

---

### Phase 4: User-Facing Commands (Post-BYOK) 🚀

**Priority:** Low (blocked by BYOK implementation)
**Effort:** High (ongoing)

Once BYOK is implemented, add user commands:

- `/settings` - User preferences (ephemeral)
- `/persona` - Manage user personas
- `/activate <personality>` - Activate in channel
- `/deactivate` - Deactivate current personality
- `/memory` - Manage conversation memory

---

## UX Best Practices

### Do ✅

- Use ephemeral responses for admin/settings commands
- Use modals for multi-line input (prompts!)
- Use autocomplete for database entity selection
- Use buttons for confirmation prompts
- Use select menus for fixed option lists
- Show clear success/error messages

### Don't ❌

- Don't spam channels with admin command results
- Don't use long argument lists when modals work better
- Don't delete things without confirmation
- Don't exceed Discord's limits (25 options, 4000 chars, etc.)
- Don't try to change ephemeral state after sending

---

## Technical Notes

### Interaction Token Lifecycle

- Initial response must be within 3 seconds
- Can defer response if needed: `await interaction.deferReply()`
- Token valid for 15 minutes after initial response
- Autocomplete cannot be deferred (must respond in 3 seconds)

### Modal Workflow

```typescript
// 1. Show modal
await interaction.showModal(modal);

// 2. Handle modal submission (separate event)
client.on('interactionCreate', async interaction => {
  if (interaction.isModalSubmit()) {
    const name = interaction.fields.getTextInputValue('name');
    // ... save to database
    await interaction.reply({ content: 'Created!', flags: MessageFlags.Ephemeral });
  }
});
```

### Button Workflow

```typescript
// 1. Send message with buttons
await interaction.reply({ components: [row] });

// 2. Handle button click (separate event)
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === 'delete_confirm') {
      // ... delete from database
      await interaction.update({ content: 'Deleted!', components: [] });
    }
  }
});
```

---

## Resources

- [Discord.js Guide - Slash Commands](https://discordjs.guide/slash-commands/)
- [Discord.js Guide - Buttons](https://discordjs.guide/message-components/buttons.html)
- [Discord.js Guide - Select Menus](https://discordjs.guide/message-components/select-menus.html)
- [Discord.js Guide - Modals](https://discordjs.guide/interactions/modals.html)
- [Discord API Docs - Interactions](https://discord.com/developers/docs/interactions/overview)

---

## Estimated Timeline

| Phase                    | Effort    | Priority     | Notes                          |
| ------------------------ | --------- | ------------ | ------------------------------ |
| Phase 1: Restructure     | 1-2 hours | High         | Quick win, better organization |
| Phase 2: DB Management   | 4-6 hours | **Critical** | Blocks daily operations        |
| Phase 3: UX Enhancements | 3-4 hours | Medium       | Quality of life improvements   |
| Phase 4: User Commands   | Ongoing   | Low          | Post-BYOK only                 |

**Total for Phases 1-3:** ~8-12 hours of focused work

**Recommended Approach:**

- Start with Phase 2 (database management) since it's blocking daily work
- Use basic slash commands first (no modals/buttons)
- Add UX enhancements (Phase 3) incrementally as time allows
- Phase 1 can be done anytime (low risk refactor)
