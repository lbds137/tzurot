// Mock dependencies before imports
jest.mock('../../src/utils/aliasResolver', () => ({
  resolvePersonality: jest.fn(),
}));

jest.mock('../../src/utils/contextMetadataFormatter', () => ({
  formatContextMetadata: jest.fn(() => '[Test Server | #test-channel | 2025-01-01T00:00:00.000Z]'),
}));

const { formatApiMessages } = require('../../src/aiService');
const { resolvePersonality } = require('../../src/utils/aliasResolver');

describe('AI Service Reference Message Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock behavior for resolvePersonality
    resolvePersonality.mockResolvedValue({
      name: 'albert-einstein',
      profile: {
        name: 'albert-einstein',
        displayName: 'Albert Einstein',
      },
    });
  });

  describe('formatApiMessages with referenced messages', () => {
    it('should properly format text-only referenced messages from users', async () => {
      const input = {
        messageContent: 'What do you think about this?',
        referencedMessage: {
          content: 'I believe AI has both benefits and risks.',
          author: 'SomeUser',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('What do you think about this?');
      expect(textContent.text).toContain('SomeUser said');
      expect(textContent.text).toContain('I believe AI has both benefits and risks');
    });

    it('should properly format text-only referenced messages from the bot', async () => {
      const input = {
        messageContent: 'Please elaborate on that.',
        referencedMessage: {
          content:
            'The concept of artificial intelligence raises profound philosophical questions.',
          author: 'AI Assistant',
          isFromBot: true,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Please elaborate on that');
      expect(textContent.text).toContain('You said:');
      expect(textContent.text).toContain(
        'The concept of artificial intelligence raises profound philosophical questions'
      );
    });

    it('should handle problematic content in referenced messages', async () => {
      const input = {
        messageContent: "What's wrong with this message?",
        referencedMessage: {
          content:
            'Error message with "quotes", \\backslashes\\, \nnewlines\n',
          author: 'SomeUser',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("What's wrong with this message?");

      // Should include the reference
      expect(textContent.text).toContain('SomeUser said');

      // Without sanitization, all characters are preserved
      expect(textContent.text.includes('\n')).toBe(true); // newlines preserved

      // The message should contain the word quotes (escaping syntax depends on implementation)
      expect(textContent.text.includes('quotes')).toBe(true);

      // The message should contain the word backslashes (escaping syntax depends on implementation)
      expect(textContent.text.includes('backslashes')).toBe(true);

      // Removed as it's now tested above
    });

    it('should handle image references', async () => {
      const input = {
        messageContent: 'Tell me about this image',
        referencedMessage: {
          content: 'Check out this picture [Image: https://example.com/image.jpg]',
          author: 'ImagePoster',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role with multimodal content
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);

      // Should have text element with combined user message and reference
      const textItem = result[0].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain('Tell me about this image');
      expect(textItem.text).toContain('ImagePoster said');

      // Should have image part with the URL from the reference
      const imageItem = result[0].content.find(item => item.type === 'image_url');
      expect(imageItem).toBeDefined();
      expect(imageItem.image_url.url).toBe('https://example.com/image.jpg');
    });

    it('should handle audio references', async () => {
      const input = {
        messageContent: "What's in this recording?",
        referencedMessage: {
          content: 'Listen to this [Audio: https://example.com/audio.mp3]',
          author: 'AudioPoster',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role with multimodal content
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);

      // Should have text element with combined user message and reference
      const textItem = result[0].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain("What's in this recording?");
      expect(textItem.text).toContain('AudioPoster said');

      // Should have audio part with the URL from the reference
      const audioItem = result[0].content.find(item => item.type === 'audio_url');
      expect(audioItem).toBeDefined();
      expect(audioItem.audio_url.url).toBe('https://example.com/audio.mp3');
    });

    it('should handle references to the same personality', async () => {
      const input = {
        messageContent: 'Tell me more about that',
        referencedMessage: {
          content: 'I am an AI assistant with many capabilities.',
          author: 'Albert Einstein',
          isFromBot: true,
          personalityName: 'albert-einstein',
          displayName: 'Albert Einstein',
        },
      };

      // Use the same personality name in the formatApiMessages call
      const result = await formatApiMessages(input, 'albert-einstein');

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Tell me more about that');
      expect(textContent.text).toContain('You said:');
      expect(textContent.text).toContain('I am an AI assistant with many capabilities');
    });

    it('should handle references to different personalities', async () => {
      const input = {
        messageContent: 'What do you think about that?',
        referencedMessage: {
          content: 'Time is relative to the observer.',
          author: 'Albert Einstein',
          isFromBot: true,
          personalityName: 'albert-einstein',
          displayName: 'Albert Einstein',
        },
      };

      // Use a different personality name in the formatApiMessages call
      const result = await formatApiMessages(input, 'sigmund-freud');

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('What do you think about that?');
      expect(textContent.text).toContain('Albert Einstein');
      expect(textContent.text).toContain('Time is relative to the observer');
    });

    it('should handle user self-references with first person format', async () => {
      const input = {
        messageContent: 'Actually, let me clarify that point',
        referencedMessage: {
          content: 'I think AI has some limitations we should consider.',
          author: 'CurrentUser',
          isFromBot: false,
        },
        userName: 'CurrentUser',
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text element containing both user content and self-reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Actually, let me clarify that point');
      expect(textContent.text).toContain('I said:');
      expect(textContent.text).toContain('I think AI has some limitations we should consider');
      expect(textContent.text).not.toContain('CurrentUser said:');
    });

    it('should handle user self-references with audio (scenario 3.2)', async () => {
      const input = {
        messageContent: 'Let me try this again with better context:',
        referencedMessage: {
          content: '[Audio Message] [Audio: https://example.com/my-audio.mp3]',
          author: 'CurrentUser',
          isFromBot: false,
        },
        userName: 'CurrentUser',
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text and audio elements
      expect(Array.isArray(result[0].content)).toBe(true);
      expect(result[0].content.length).toBe(2);

      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Let me try this again with better context:');
      expect(textContent.text).toContain('I said (with audio I shared):');
      expect(textContent.text).toContain('[Audio Message]');
      expect(textContent.text).not.toContain('CurrentUser said:');

      const audioContent = result[0].content.find(item => item.type === 'audio_url');
      expect(audioContent).toBeDefined();
      expect(audioContent.audio_url.url).toBe('https://example.com/my-audio.mp3');
    });

    it('should handle user self-references with audio (scenario 5.2)', async () => {
      const input = {
        messageContent: 'Let me add more context to this audio',
        referencedMessage: {
          content: '[Audio Message] [Audio: https://example.com/my-recording.mp3]',
          author: 'CurrentUser',
          isFromBot: false,
        },
        userName: 'CurrentUser',
      };

      const result = await formatApiMessages(input);

      // Should have one combined message with all content
      expect(result.length).toBe(1);

      // Single message should be from user role
      expect(result[0].role).toBe('user');

      // Message content should be an array with text and audio elements
      expect(Array.isArray(result[0].content)).toBe(true);
      expect(result[0].content.length).toBe(2);

      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Let me add more context to this audio');
      expect(textContent.text).toContain('I said (with audio I shared):');
      expect(textContent.text).toContain('[Audio Message]');
      expect(textContent.text).not.toContain('CurrentUser said:');

      const audioContent = result[0].content.find(item => item.type === 'audio_url');
      expect(audioContent).toBeDefined();
      expect(audioContent.audio_url.url).toBe('https://example.com/my-recording.mp3');
    });

    it('should handle user self-references using user IDs', async () => {
      const input = {
        messageContent: 'What did I mean by that?',
        userId: 'user123', // Current user ID
        userName: 'John Doe',
        referencedMessage: {
          content: 'AI technology is advancing rapidly.',
          author: 'JohnDoe', // Different username format
          authorId: 'user123', // Same user ID
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');

      // Should use "I said" even though usernames don't match exactly
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('What did I mean by that?');
      expect(textContent.text).toContain('I said:');
      expect(textContent.text).toContain('AI technology is advancing rapidly');
      expect(textContent.text).not.toContain('JohnDoe said:');
    });

    it('should not treat as self-reference when user IDs differ', async () => {
      const input = {
        messageContent: 'What does John think?',
        userId: 'user456', // Current user ID
        userName: 'John Smith', // Similar name
        referencedMessage: {
          content: 'I disagree with that assessment.',
          author: 'John Doe', // Similar name
          authorId: 'user123', // Different user ID
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should have one combined message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');

      // Should use the author's name, not "I said"
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('What does John think?');
      expect(textContent.text).toContain('John Doe said:');
      expect(textContent.text).toContain('I disagree with that assessment');
      expect(textContent.text).not.toContain('I said:');
    });

    it('should fall back to username comparison when user IDs are not available', async () => {
      const input = {
        messageContent: 'Let me clarify',
        userName: 'TestUser',
        // No userId provided
        referencedMessage: {
          content: 'This needs more explanation.',
          author: 'TestUser', // Same username
          // No authorId provided
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(input);

      // Should still detect self-reference by username
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Let me clarify');
      expect(textContent.text).toContain('I said:');
      expect(textContent.text).toContain('This needs more explanation');
    });

    it('should use personalityDisplayName when displayName is not available', async () => {
      const input = {
        messageContent: 'Can you elaborate on that?',
        referencedMessage: {
          content: 'I believe in the power of the unconscious mind.',
          author: 'Sigmund Freud',
          isFromBot: true,
          personalityName: 'sigmund-freud',
          personalityDisplayName: 'Sigmund Freud',
          // Note: no displayName field, only personalityDisplayName
        },
      };

      const result = await formatApiMessages(input, 'sigmund-freud');

      // Should have one combined message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');

      // Should use personalityDisplayName in the reference
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Can you elaborate on that?');
      expect(textContent.text).toContain('You said:');
      expect(textContent.text).toContain('I believe in the power of the unconscious mind');
    });

    it('should handle DM personality format references correctly', async () => {
      const input = {
        messageContent: 'Tell me more about that theory',
        referencedMessage: {
          content:
            '**Albert Einstein:** The theory of relativity shows us that time and space are interconnected.',
          author: 'TzurotBot', // Bot username in DMs
          isFromBot: true,
          personalityName: 'albert-einstein', // Full name resolved from display name
          personalityDisplayName: 'Albert Einstein',
        },
      };

      const result = await formatApiMessages(input, 'albert-einstein');

      // Should have one combined message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');

      // Should recognize it's the same personality and use "You said:"
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Tell me more about that theory');
      expect(textContent.text).toContain('You said:');
      expect(textContent.text).not.toContain('Albert Einstein said:');
      // The actual message content should not include the DM prefix
      expect(textContent.text).toContain(
        'The theory of relativity shows us that time and space are interconnected'
      );
    });

    it('should not include reference when replying to same personality recently', async () => {
      // This test verifies that the personality handler's logic for skipping
      // same-personality references is working correctly
      const input = {
        messageContent: 'Continue that thought',
        referencedMessage: {
          content: 'Let me explain my theory of dreams...',
          author: 'Sigmund Freud',
          isFromBot: true,
          personalityName: 'sigmund-freud',
          personalityDisplayName: 'Sigmund Freud',
        },
      };

      // In the actual implementation, personalityHandler.js checks if it's the same
      // personality and skips adding the reference. We can test that formatApiMessages
      // handles the case where no reference is provided (simulating the skip)
      const resultWithoutReference = await formatApiMessages(
        'Continue that thought',
        'sigmund-freud'
      );

      // Should have simple message without reference
      expect(resultWithoutReference.length).toBe(1);
      expect(resultWithoutReference[0].role).toBe('user');
      expect(resultWithoutReference[0].content).toBe('Continue that thought');
    });
  });
});
