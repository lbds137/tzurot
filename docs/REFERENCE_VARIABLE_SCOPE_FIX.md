# Referenced Message Handling Fixes

## Problem Description

When replying to a webhook message from a personality, several issues were occurring:

1. Generic "Referring to previous message" was being used instead of properly identifying which personality sent the message
2. System prompt artifacts like "You are Lilith" were appearing in responses
3. Audio/image files from personality-generated messages were being unnecessarily sent to the AI service
4. The "same personality" reference optimization was disabled due to previous issues

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

## Implementation

Three important fixes were made:

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

## Benefits

These changes provide several benefits:

1. Proper personality attribution in referenced messages
2. Prevention of system prompt artifacts appearing in responses
3. Reduced redundancy in API requests by eliminating duplicate media for personality messages
4. Better context management for same-personality conversations
5. More efficient message handling with optimizations re-enabled
6. Cleaner code with proper variable scoping

## Note on Sanitization

While the sanitization approach implemented earlier would have worked as a band-aid by removing system prompt artifacts after they occurred, fixing the variable scope and message handling is a much better solution because:

1. It addresses the root causes rather than treating symptoms
2. It's more efficient (no need for complex pattern matching and filtering)
3. It provides better context to the AI model, leading to more relevant responses
4. It avoids potential false positives in content filtering

We're keeping the sanitization function as a safety net, but with these fixes, we should see far fewer system prompt artifacts appearing in the first place.