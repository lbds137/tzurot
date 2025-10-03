# Space Aliases in Tzurot

This document explains how to use aliases with spaces in the Tzurot Discord bot.

## About Space Aliases

Tzurot now supports using @mentions with spaces in aliases, allowing for more natural interactions with personalities. For example, you can now use `@disposal chute` to mention a personality with that alias.

## How It Works

### Creating Space Aliases

When you add a personality or set an alias, you can include spaces in the alias name. For example:

```
!tz alias disposal-chute "disposal chute"
```

This creates an alias "disposal chute" for the personality "disposal-chute".

### Using Space Aliases

To mention a personality using a space alias, simply type the @ symbol followed by the alias with spaces:

```
Hey @disposal chute, can you help me with something?
```

The bot will recognize this as a mention for the "disposal-chute" personality.

### Message Processing

When you mention a personality using an alias with spaces, the bot will identify the personality and respond accordingly. All mentions in the message content, including the triggering @mention, are preserved and sent to the AI as they appear in the original message.

### Technical Details

- The bot uses a sophisticated regex pattern to detect mentions with spaces
- It can identify aliases with up to 4 words (e.g., "robot disposal chute system")
- Mentions can appear anywhere in the message - beginning, middle, or end
- Mentions can be followed by punctuation (e.g., "@disposal chute?")
- Apostrophes and certain special characters in aliases are supported
- Self-referential aliases are no longer created (e.g., no alias needed for `lilith-tzel-shani` since `@lilith-tzel-shani` works directly)
- The bot prioritizes the longest matching alias first. For example, if both `bambi` and `bambi prime` are valid aliases, the message `@bambi prime hi` will trigger the `bambi prime` personality, not `bambi`. This ensures that more specific aliases take precedence over less specific ones.

## Examples

Here are examples of valid space alias mentions:

```
@disposal chute can you help me?
I need help from @robot disposal chute system
Is this working, @disposal chute?
Let's ask @bill's disposal system about this
```

### Longest Match Priority Example

When you have overlapping aliases like `bambi` and `bambi prime`, the bot will correctly prioritize the longer match:

```
@bambi can you help me?            // Triggers bambi personality
@bambi prime can you help me?      // Triggers bambi prime personality, NOT bambi
@robot disposal chute system help! // Triggers the full 4-word personality
```

This prioritization ensures that more specific personalities are triggered correctly when their name starts with the same words as another personality.

## Limitations

- The maximum length for a space alias is 4 words
- If multiple multi-word @mentions are included in a message, only the first match will be processed
- When space aliases overlap with standard aliases, the standard alias is checked first

## Troubleshooting

If your space alias isn't being recognized:

1. Make sure the alias is correctly set up: `!tz alias list`
2. Ensure you're using the @ symbol before the alias
3. Try with fewer words if the alias has many words
4. Check that the spelling and spacing match the alias exactly

## Tips for Creating Good Space Aliases

- Keep aliases short and memorable (2-3 words is ideal)
- Use distinctive names that won't be confused with other text
- Test aliases to ensure they work as expected
- Consider using single-word aliases as well for flexibility