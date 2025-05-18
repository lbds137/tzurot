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

For user experience improvement, the bot automatically removes the triggering @mention from the message content before sending it to the AI. This means if you type:

```
@disposal chute please tell me about recycling
```

The bot will only send "please tell me about recycling" to the AI, since the personality has already been pinged through the mention. This makes conversations more natural by avoiding redundancy in the message.

Other mentions (like @user mentions) in the message will be preserved and passed to the AI as they may be relevant to the conversation.

### Technical Details

- The bot uses a sophisticated regex pattern to detect mentions with spaces
- It can identify aliases with up to 4 words (e.g., "robot disposal chute system")
- Mentions can appear anywhere in the message - beginning, middle, or end
- Mentions can be followed by punctuation (e.g., "@disposal chute?")
- Apostrophes and certain special characters in aliases are supported

## Examples

Here are examples of valid space alias mentions:

```
@disposal chute can you help me?
I need help from @robot disposal chute system
Is this working, @disposal chute?
Let's ask @bill's disposal system about this
```

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