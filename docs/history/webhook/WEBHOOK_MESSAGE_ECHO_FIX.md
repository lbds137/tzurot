# Webhook Message Echo Fix

## Issue Description

After implementing the webhook authentication bypass for the bot's own webhooks, a new issue was observed where the system would sometimes echo back the reply from the personality as if it came from the user. This resulted in confusing conversations where the AI would repeat parts of its own previous messages.

## Root Cause

The issue occurred because of how referenced messages were handled in `aiService.js`:

1. In the recent fix to identify the bot's own webhooks, we changed all referenced messages to use the 'user' role for consistency to ensure they were visible to the AI.
2. However, this approach didn't distinguish between references to the current personality's own messages vs. other personalities or users.
3. When a user replied to a message from the same personality, the AI didn't recognize the referenced message as its own previous response, causing it to echo back parts of that content.

## Fix Implementation

The solution was to update the `formatApiMessages` function in `aiService.js` to use appropriate message roles for references:

1. **Role-Based Reference Handling**: 
   - For messages referenced from the same personality, use the 'assistant' role to indicate they are the AI's own previous responses
   - For messages referenced from different personalities or users, continue using the 'user' role

2. **Key Code Changes**:
   ```javascript
   // When the reference is to a bot message (personality), format it as appropriate
   // For bot messages we want to use assistant role ONLY for the current personality
   // For other personalities and users, we use user role to ensure the AI can see them consistently
   let referenceDescriptor;
   
   if (content.referencedMessage.isFromBot) {
     // Check if it's the same personality as the one we're using now
     const isSamePersonality = content.referencedMessage.personalityName === personalityName;
     
     if (isSamePersonality) {
       // Use assistant role for the personality's own messages to avoid echo
       referenceDescriptor = { 
         role: 'assistant', 
         content: assistantReferenceContent || content.referencedMessage.content 
       };
       logger.debug(`[AIService] Using assistant role for reference to same personality: ${personalityName}`);
     } else {
       // Use user role for references to other personalities
       referenceDescriptor = { 
         role: 'user', 
         content: assistantReferenceContent || content.referencedMessage.content 
       };
       logger.debug(`[AIService] Using user role for reference to different personality: ${content.referencedMessage.personalityName}`);
     }
   } else {
     // Use user role for user messages
     referenceDescriptor = { role: 'user', content: fullReferenceContent };
     logger.debug(`[AIService] Using user role for reference to user message`);
   }
   ```

3. **First/Third Person Handling**: 
   - Enhanced the formatting of personality references to use first-person pronouns for the same personality: "As Albert Einstein, I said earlier..."
   - For other personalities, use third-person references: "Albert Einstein said..."

4. **Detailed Logging**: 
   - Added debug-level logging to track which role is being used for references
   - This helps with troubleshooting future issues related to message roles

## Testing

Updated the unit tests in `aiService.reference.test.js` to verify:

1. References to the same personality use 'assistant' role and first-person pronouns
2. References to different personalities use 'user' role and third-person format
3. References to user messages use 'user' role
4. Media (images and audio) in referenced messages is correctly handled

Added specific test cases to verify the behavior with both same and different personalities.

## Related Files

- `/src/aiService.js` - Updated the `formatApiMessages` function to use appropriate roles
- `/tests/unit/aiService.reference.test.js` - Updated tests to reflect the new behavior

## Preventing Future Issues

To avoid similar issues in the future:

1. Always consider the AI's perspective when formatting messages:
   - 'user' role: Messages the AI should respond to
   - 'assistant' role: The AI's own previous responses (to avoid echo)
   - 'system' role: Instructions about how the AI should behave

2. Be careful when handling references to the AI's own messages:
   - Always use the 'assistant' role for the AI's own previous messages
   - Set clear boundaries between what the AI said vs. what others said

3. For webhook authentication bypasses:
   - Make sure authentication bypass doesn't impact message role assignment
   - The two concerns (authentication and role assignment) should be handled separately

## Benefits

This fix ensures a more natural conversation flow when users reply to webhook personalities, by:

1. Preventing the AI from echoing back its own previous messages
2. Using appropriate first-person or third-person references based on which personality is speaking
3. Maintaining consistent message formatting for media content in referenced messages