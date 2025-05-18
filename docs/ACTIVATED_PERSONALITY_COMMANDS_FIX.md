# Activated Personality Commands Fix

## Issue Description

When a personality is activated in a channel using `!tz activate <personality>`, it should:
- **Respond to all regular messages** from any user in that channel
- **Ignore command messages** that start with the bot prefix (e.g., `!tz deactivate`)

Previously, the activated personality would respond to all messages in the channel, including command messages like `!tz deactivate`, which caused confusion and made it difficult to deactivate the personality.

## Fix Implementation

The fix was implemented in the `bot.js` file by adding a check to determine if a message is a command before processing it with the activated personality.

### Initial Code Changes

**In `bot.js` (original fix):**

```javascript
// Check for activated channel personality
const activatedPersonalityName = getActivatedPersonality(message.channel.id);
if (activatedPersonalityName) {
  logger.debug(`Found activated personality in channel: ${activatedPersonalityName}`);
  
  // Check if this message is a command - activated personalities should ignore commands
  const isCommand = message.content.startsWith(botPrefix + ' ') || message.content === botPrefix;
  
  if (isCommand) {
    logger.info(`Activated personality ignoring command message: ${message.content}`);
  } else {
    // Not a command, continue with personality response
```

### Bug Fix Update

The initial implementation had a bug where commands that started with the bot prefix without a space (e.g., `!tzhelp`) were not being detected as commands. This caused activated personalities to still respond to these command formats.

**In `bot.js` (updated fix):**

```javascript
// Check for activated channel personality
const activatedPersonalityName = getActivatedPersonality(message.channel.id);
if (activatedPersonalityName) {
  logger.debug(`Found activated personality in channel: ${activatedPersonalityName}`);
  
  // Check if this message is a command - activated personalities should ignore commands
  // Modified check to ensure we catch any command format that would be processed by the processCommand function
  const isCommand = message.content.startsWith(botPrefix);
  
  if (isCommand) {
    logger.info(`Activated personality ignoring command message: ${message.content}`);
  } else {
    // Not a command, continue with personality response
    
    // First try to get personality directly by full name
    let personality = getPersonality(activatedPersonalityName);

    // If not found as direct name, try it as an alias
    if (!personality) {
      personality = getPersonalityByAlias(activatedPersonalityName);
    }

    logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

    if (personality) {
      // Process the message with this personality
      // Since this is not a direct @mention, pass null for triggeringMention
      await handlePersonalityInteraction(message, personality, null);
    }
  }
}
```

## Testing

The fix was tested by:

1. Activating a personality in a channel with `!tz activate <personality>`
2. Sending regular messages (verified that the personality responded)
3. Sending command messages in various formats:
   - With a space: `!tz help` (verified the personality did not respond)
   - Without a space: `!tzhelp` (verified the personality did not respond) 
   - Just the prefix: `!tz` (verified the personality did not respond)
4. Confirming that the `!tz deactivate` command worked and properly deactivated the personality

A test file was also created at `/tests/unit/bot.activated.command.test.js` to verify the behavior. The test file was updated to include a specific test for the bug fix, verifying that commands without a space after the prefix are properly ignored.

## Benefits

1. **Better User Experience**: Users can now use commands in a channel with an activated personality without confusing the bot
2. **Easier Personality Management**: Users can easily deactivate personalities without the personalities responding to the deactivate command
3. **More Natural Behavior**: The bot now behaves more like a human would, responding only to non-command messages when active

## Future Considerations

- We might want to add a way for personalities to acknowledge when they're being deactivated to provide better feedback to users.
- Consider adding an option for personalities to respond to specific commands (e.g., help commands) while activated.