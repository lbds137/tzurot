# Activate Command Fix

## Issue Description

The `!tz activate` command was not properly handling multi-word personality names. For example, when a user entered the command `!tz activate lucifer-seraph-ha-lev-nafal`, the command would only use the first word (`lucifer`) as the personality name and ignore the rest.

This caused issues when users tried to activate personalities with multi-word names that didn't have a single-word alias set up.

## Root Cause

In the `handleActivateCommand` function in `commands.js`, the command was only taking the first argument (`args[0]`) and using it as the personality name. This approach works for personalities with single-word names or those with aliases, but not for multi-word personality names.

The original code:

```javascript
const personalityQuery = args[0];

// Try with alias first
let personality = getPersonalityByAlias(personalityQuery);

// If not found by alias, try with full name
if (!personality) {
  personality = getPersonality(personalityQuery);
}
```

## Fix Implementation

The solution was to modify the `handleActivateCommand` function to properly handle multi-word personality names by joining all arguments with hyphens (the standard separator in personality names).

The updated code:

```javascript
// Join all arguments to support multi-word personality names
const personalityQuery = args.join('-');
logger.info(`[Commands] Attempting to activate personality with query: ${personalityQuery}`);

// Try with alias first
let personality = getPersonalityByAlias(personalityQuery);

// If not found by alias, try with full name
if (!personality) {
  logger.info(`[Commands] Personality not found by alias, trying with full name: ${personalityQuery}`);
  personality = getPersonality(personalityQuery);
}

// If still not found, try with just the first argument as a fallback for backwards compatibility
if (!personality && args.length > 1) {
  logger.info(`[Commands] Personality not found, trying with just the first argument: ${args[0]}`);
  personality = getPersonalityByAlias(args[0]);
  
  if (!personality) {
    personality = getPersonality(args[0]);
  }
}
```

We also updated the help text for the activate command to make it clearer that it supports multi-word personality names:

```javascript
case 'activate':
  return await directSend(
    `**${prefix} activate <personality>**\n` +
      `Activate a personality to automatically respond to all messages in the channel from any user.\n` +
      `- Requires the "Manage Messages" permission\n` +
      `- \`personality\` is the name or alias of the personality to activate (required)\n` +
      `- Multi-word personality names are supported (like \`${prefix} activate lucifer-seraph-ha-lev-nafal\`)\n\n` +
      `Examples:\n` +
      `\`${prefix} activate lilith\` - Activate personality with alias 'lilith'\n` +
      `\`${prefix} activate lucifer-seraph-ha-lev-nafal\` - Activate personality with multi-word name`
  );
```

## Additional Changes

We also created a test file `tests/unit/commands.activate.test.js` to test the various behaviors of the activate command, including:

1. Activating a personality with a simple name
2. Activating a personality by alias
3. Activating a personality with a multi-word name
4. Handling multi-word personality names passed as separate arguments
5. Handling the case where the user has insufficient permissions
6. Handling the case where no personality name is provided
7. Handling the case where the personality is not found
8. Falling back to first argument if multi-word personality is not found

## Backward Compatibility

For backward compatibility, if the multi-word name is not found, the function will try to use just the first argument as a fallback. This ensures that commands that worked before will continue to work.