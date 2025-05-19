# Referenced Message Handling Fixes

## Problem Description

When replying to webhook messages from personalities, several issues were occurring:

1. Generic "Referring to previous message" was being used instead of properly identifying which personality sent the message
2. System prompt artifacts like "You are Lilith" were appearing in responses
3. Audio/image files from personality-generated messages were being unnecessarily sent to the AI service
4. The "same personality" reference optimization was disabled due to previous issues
5. When referencing messages from different personalities, content duplication and additional system prompt artifacts would appear

## Root Cause Analysis

Multiple interconnected issues were identified:

1. Variable Scope Issue:
   - The `referencedPersonalityInfo` and `referencedWebhookName` variables were being declared as local variables within an if-block
   - Later code was checking for these variables as if they were defined at a higher scope
   - This caused the AI model to receive incomplete context about referenced messages
   - Without proper attribution, the AI model would sometimes insert artifacts from its system prompt

2. Same-Personality Reference Issue:
   - The optimization to skip redundant references was disabled as a workaround
   - With the variable scope fixed, it should be safe to re-enable this optimization

3. Redundant Media Issue:
   - Media URLs (audio/images) from personality messages were being sent to the AI service
   - This was unnecessary since personality messages already contain their content as text
   - This redundancy may have contributed to unexpected behavior in responses

4. Cross-Personality Reference Issue:
   - When referencing a different personality's message, the AI would sometimes duplicate the content and mix in system prompt artifacts
   - The reference format wasn't clear enough about the source vs. current context

5. Linked Message Media Issue:
   - Discord message links were being processed differently from direct replies
   - Media from linked messages was always included, even from personality messages where it's redundant
   - An audio file from a linked message was incorrectly being presented as an image
   
6. Reference Format Issues:
   - Messages used generic "The user" instead of actual Discord usernames
   - The reference format didn't specify that messages were from Discord
   - Discord links were completely removed from the message content

## Implementation

Seven important fixes were made:

1. Fixed Variable Scope:
   ```javascript
   // Initialize reference personality variables at a higher scope so they're accessible later
   let referencedPersonalityInfo = null;
   let referencedWebhookName = null;
   ```

2. Re-enabled Same-Personality Reference Optimization:
   ```javascript
   // Re-enable the same-personality optimization now that we've fixed the variable scope issues
   const isReferencingSamePersonality = samePersonality && sameChannel && isRecent;
   ```

3. Skip Media for Personality Messages:
   ```javascript
   // Skip media attachments for personalities since they're redundant with text content
   const isFromPersonality = repliedToMessage.webhookId && referencedPersonalityInfo?.name;
   
   // Only process media for non-personality messages
   if (!isFromPersonality && repliedToMessage.attachments && repliedToMessage.attachments.size > 0) {
     // Media processing code...
   }
   ```

4. Improved Reference Format for Cross-Personality References:
   ```javascript
   // Use a clearer format with personalized user name and Discord context
   referencePrefix = `[${userName} is referencing a Discord message from the AI personality ${content.referencedMessage.personalityDisplayName || content.referencedMessage.personalityName}. That message said: "${cleanContent}"] `;
   ```

5. Skip Media for Referenced Personality Messages in AI Service:
   ```javascript
   // Only handle media if present AND this is NOT a personality message
   const isFromPersonality = content.referencedMessage.isFromBot && content.referencedMessage.personalityName;
   
   if (!isFromPersonality && mediaUrl) {
     // Media handling code...
   } else if (isFromPersonality && mediaUrl) {
     logger.debug(`[AIService] Skipping media from personality message (${content.referencedMessage.personalityName}): ${mediaType}`);
   }
   ```

6. Skip Media from Linked Messages from Personalities:
   ```javascript
   // Skip media attachments for personalities since they're redundant with text content
   const isFromPersonality = linkedMessage.webhookId && 
                             referencedPersonalityInfo?.name;
   
   // Check for media attachments in the linked message, but only for non-personality messages
   if (!isFromPersonality && linkedMessage.attachments && linkedMessage.attachments.size > 0) {
     // Media processing code...
   } else if (isFromPersonality && linkedMessage.attachments && linkedMessage.attachments.size > 0) {
     logger.info(`[Bot] Skipping media attachments for personality linked message from: ${referencedPersonalityInfo.name}`);
   }
   ```

7. Preserve Discord Link Information:
   ```javascript
   // Replace the message link with a placeholder that clarifies what was linked
   messageContent = messageContent.replace(messageLinkMatch[0], '[referenced Discord message link]').trim();
   ```

## Benefits

These changes provide several benefits:

1. Proper personality attribution in referenced messages
2. Prevention of system prompt artifacts appearing in responses
3. Reduced redundancy in API requests by eliminating duplicate media for personality messages
4. Better context management for same-personality conversations
5. Clearer distinction between original message content and current personality's response
6. More efficient message handling with optimizations re-enabled
7. Cleaner code with proper variable scoping

## Note on Sanitization

While the sanitization approach implemented earlier would have worked as a band-aid by removing system prompt artifacts after they occurred, fixing the variable scope and message handling is a much better solution because:

1. It addresses the root causes rather than treating symptoms
2. It's more efficient (no need for complex pattern matching and filtering)
3. It provides better context to the AI model, leading to more relevant responses
4. It avoids potential false positives in content filtering

We're keeping the sanitization function as a safety net, but with these fixes, we should see far fewer system prompt artifacts appearing in the first place.