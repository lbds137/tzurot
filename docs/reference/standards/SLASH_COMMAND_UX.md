# Slash Command UX Standards

> **Purpose**: Define consistent, user-friendly patterns for Discord slash commands in Tzurot v3.

## Core Principles

### 1. User-Centric Design

Commands should be organized by **user intent**, not database schema or internal architecture.

```
❌ BAD: /llm-config create    (exposes internal "LLM Config" concept)
✅ GOOD: /preset create       (user understands "preset")

❌ BAD: /model set-default    (abstract - "model" of what?)
✅ GOOD: /me settings model   (clear - MY settings, MY model choice)
```

### 2. Discoverability

- Common actions should be easy to find
- Related functionality should be grouped together
- Help should be top-level, not buried

```
❌ BAD: /utility help         (buried under utility)
✅ GOOD: /help                (top-level, immediately discoverable)
```

### 3. Consistency

- Similar operations should work the same way across commands
- Use consistent naming patterns (see Naming Conventions)
- Use consistent response patterns (see Response Types)

### 4. Progressive Disclosure

- Show simple options first, advanced options on demand
- Use the Dashboard pattern for complex entities
- Don't overwhelm users with options upfront

---

## Command Structure

### Naming Conventions

| Pattern              | Usage                    | Examples                                 |
| -------------------- | ------------------------ | ---------------------------------------- |
| Singular nouns       | Entity commands          | `/character`, `/preset`, `/persona`      |
| `/settings`          | User's own settings/data | `/settings timezone`, `/settings apikey` |
| Verbs as subcommands | Actions on entities      | `create`, `edit`, `delete`, `browse`     |
| Lowercase, no spaces | All command names        | `/character`, not `/Character`           |

### Standard Subcommand Names

Use these consistently across all entity commands:

| Subcommand | Purpose                  | Notes                         |
| ---------- | ------------------------ | ----------------------------- |
| `list`     | Show all items           | Always first in definition    |
| `view`     | View single item details | Read-only display             |
| `create`   | Create new item          | Opens modal or takes args     |
| `edit`     | Modify existing item     | Opens dashboard or modal      |
| `delete`   | Remove item              | Always requires confirmation  |
| `set`      | Set a value/preference   | For simple key-value settings |
| `clear`    | Remove/reset a value     | Opposite of `set`             |

### Subcommand Groups

Use groups to organize related functionality within a command:

```typescript
// Good structure
/me
  ├── persona       (group)
  │   ├── view
  │   ├── edit
  │   ├── create
  │   └── list
  ├── settings      (group)
  │   ├── timezone
  │   └── model
  └── overrides     (group)
      ├── list
      ├── set
      └── clear
```

**When to use groups vs flat subcommands:**

- Use groups when you have 3+ subcommands for a distinct sub-feature
- Use flat subcommands for simple commands with 1-4 actions
- Never nest deeper than one group level (Discord limitation)

---

## The Dashboard Pattern

Use the Dashboard pattern for **complex entities with multiple editable fields** that exceed Discord's 5-field modal limit.

### When to Use

✅ Use Dashboard for:

- Entities with 6+ editable fields
- Entities where users frequently edit subsets of fields
- Entities that benefit from visual status indicators

❌ Don't use Dashboard for:

- Simple settings (use direct modals)
- Single-field operations
- One-time setup flows

### How It Works

```
1. User runs /command create
   └── Minimal "seed" modal (3-4 required fields only)

2. Entity created → Dashboard embed appears
   ├── Shows current values with status indicators
   ├── Select menu to choose section to edit
   └── Action buttons (refresh, close, special actions)

3. User selects section → Section modal opens
   └── Pre-filled with current values (max 5 fields)

4. User submits → Dashboard refreshes with new data
```

### Dashboard Components

```typescript
// Dashboard embed shows entity status
const embed = buildDashboardEmbed(config, entityData);

// Edit menu + action buttons
const components = buildDashboardComponents(config, entityId, entityData, {
  showClose: true,
  showRefresh: true,
});

// Section modal for editing
const modal = buildSectionModal(config, section, entityId, entityData);
```

### Section Status Indicators

Use visual indicators to show field completion:

| Status   | Emoji | Meaning                    |
| -------- | ----- | -------------------------- |
| Complete | ✅    | All required fields filled |
| Partial  | ⚠️    | Some optional fields empty |
| Empty    | ❌    | Required fields missing    |

### Session Management

Track active dashboard sessions to:

- Prevent stale data on submit
- Enable refresh functionality
- Clean up on timeout

```typescript
const sessionManager = getSessionManager();
sessionManager.set(userId, entityType, entityId, data, messageId, channelId);
```

---

## Modal Best Practices

### Field Limits

- Discord allows **max 5 fields per modal**
- Plan sections accordingly (group related fields)
- Most important fields in first sections

### Field Types

| Type      | Use For                     | Max Length |
| --------- | --------------------------- | ---------- |
| Short     | Names, slugs, single values | 100 chars  |
| Paragraph | Descriptions, bios, prompts | 4000 chars |

### Pre-filling Values

Always pre-fill modals with current values when editing:

```typescript
const modal = buildSectionModal(config, section, entityId, currentData);
// Values are automatically truncated to maxLength
```

### Validation

Validate on submit and show clear error messages:

```typescript
const result = validateModalValues(values, fields);
if (!result.valid) {
  await interaction.reply({
    content: `❌ Validation failed:\n${result.errors.join('\n')}`,
    flags: MessageFlags.Ephemeral,
  });
  return;
}
```

---

## Autocomplete Patterns

### When to Use

✅ Use autocomplete for:

- Entity selection (characters, presets, personas)
- Model selection (large lists)
- Timezone selection
- Any list > 10 items

❌ Don't use autocomplete for:

- Boolean choices (use `addChoices` instead)
- Small fixed lists < 10 items
- Free-form text input

### Implementation Pattern

```typescript
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = focused.value.toLowerCase();

  // Filter and limit results
  const results = allItems
    .filter(
      item =>
        item.name.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query)
    )
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES); // 25 max

  await interaction.respond(
    results.map(item => ({
      name: item.displayName, // What user sees
      value: item.id, // What gets submitted
    }))
  );
}
```

### Display Format

For autocomplete display names, include helpful context:

```typescript
// Good: includes context
{ name: "Claude 3.5 Sonnet (anthropic) - Fast, smart", value: "anthropic/claude-3.5-sonnet" }

// Bad: just the ID
{ name: "anthropic/claude-3.5-sonnet", value: "anthropic/claude-3.5-sonnet" }
```

---

## Response Types

### Ephemeral Responses

Use ephemeral (private) responses for:

- Settings confirmations
- Error messages
- Sensitive data (API keys, usage stats)
- Dashboard interactions
- Anything user-specific

```typescript
await interaction.reply({
  content: '✅ Settings updated',
  flags: MessageFlags.Ephemeral,
});
```

### Public Responses

Use public responses for:

- Information others might find useful
- Character/personality info displays
- Help text (optional - can be ephemeral too)

### Deferred Responses

Defer when operation takes > 3 seconds:

```typescript
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
// ... slow operation ...
await interaction.editReply({ content: 'Done!' });
```

---

## Error Handling

### User-Facing Errors

Always provide actionable error messages:

```typescript
// ❌ Bad
await interaction.reply({ content: '❌ Error', flags: MessageFlags.Ephemeral });

// ✅ Good
await interaction.reply({
  content: '❌ Character not found.\n\nUse `/character list` to see available characters.',
  flags: MessageFlags.Ephemeral,
});
```

### Error Message Format

```
❌ [What went wrong]

[Why it happened - if helpful]
[What user can do to fix it]
```

### Permission Errors

```typescript
if (!canEdit) {
  await interaction.reply({
    content:
      `❌ You don't have permission to edit \`${name}\`.\n` +
      'You can only edit characters you own.',
    flags: MessageFlags.Ephemeral,
  });
  return;
}
```

---

## Confirmation Patterns

### Destructive Actions

Always confirm before:

- Deleting entities
- Clearing all data
- Irreversible operations

Use buttons for confirmation:

```typescript
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId('confirm-delete-abc123')
    .setLabel('Yes, delete')
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setCustomId('cancel-delete-abc123')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
);

await interaction.reply({
  content: `⚠️ Are you sure you want to delete **${name}**?\n\nThis cannot be undone.`,
  components: [row],
  flags: MessageFlags.Ephemeral,
});
```

---

## Success Feedback

Always confirm successful operations:

```typescript
// Simple success
await interaction.reply({
  content: '✅ Character created successfully!',
  flags: MessageFlags.Ephemeral,
});

// Success with next steps
await interaction.reply({
  content:
    '✅ Preset saved!\n\n' +
    'Use `/me settings model` to set it as your default, or\n' +
    '`/me overrides set` to use it for specific characters.',
  flags: MessageFlags.Ephemeral,
});
```

---

## Anti-Patterns to Avoid

### 1. Exposing Internal Concepts

```
❌ /llm-config         (internal naming)
✅ /preset             (user-friendly naming)
```

### 2. Duplicate Functionality

```
❌ /model set + /profile override set   (same thing, two places)
✅ /me overrides set                     (one place for user overrides)
```

### 3. Deep Nesting for Simple Operations

```
❌ /settings timezone set Europe/London   (too deep for one value)
✅ /me settings timezone Europe/London    (acceptable with /me grouping)
```

### 4. Non-Ephemeral Sensitive Data

```
❌ Public reply showing API key status
✅ Ephemeral reply for all wallet operations
```

### 5. Silent Failures

```
❌ No response on error
✅ Clear error message with guidance
```

### 6. Inconsistent Naming

```
❌ /character create + /preset add + /persona make   (different verbs)
✅ /character create + /preset create + /persona create   (consistent)
```

---

## Command Registration

### File Structure

```
commands/
├── character/
│   ├── index.ts         # Command definition + routing
│   ├── config.ts        # Dashboard config (if using pattern)
│   ├── autocomplete.ts  # Autocomplete handler
│   ├── create.ts        # Subcommand handlers
│   ├── edit.ts
│   └── *.test.ts        # Colocated tests
├── me/
│   ├── index.ts
│   ├── persona/         # Subcommand group
│   │   ├── view.ts
│   │   └── edit.ts
│   └── settings/
│       └── timezone.ts
```

### Command Definition Pattern

```typescript
export const data = new SlashCommandBuilder()
  .setName('commandname')
  .setDescription('Clear, action-oriented description')
  .addSubcommand(subcommand => subcommand.setName('list').setDescription('List all items'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new item')
      .addStringOption(option =>
        option.setName('name').setDescription('Item name').setRequired(true)
      )
  );
```

---

## Checklist for New Commands

Before implementing a new command:

- [ ] Does this fit an existing command? (avoid proliferation)
- [ ] Is the name user-centric, not system-centric?
- [ ] Are subcommands using standard naming (`list`, `create`, `edit`, etc.)?
- [ ] Is autocomplete used for entity selection?
- [ ] Are responses ephemeral for user-specific data?
- [ ] Are errors actionable with clear guidance?
- [ ] Are destructive actions confirmed?
- [ ] Is success feedback provided?
- [ ] Does complex entity editing use Dashboard pattern?
- [ ] Are tests written for all handlers?
