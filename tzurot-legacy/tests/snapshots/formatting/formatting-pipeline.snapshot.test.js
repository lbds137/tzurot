/**
 * Golden Master Tests for Message Formatting Pipeline
 * 
 * These tests capture the current behavior of our message formatting system.
 * They serve as a safety net during refactoring - any change to the output
 * will be flagged, allowing us to verify if the change is intentional.
 * 
 * To update snapshots after verifying changes are correct:
 * npm test tests/snapshots/formatting -- -u
 */

const { MessageFactory, Factories } = require('../../factories');
const { formatApiMessages } = require('../../../src/utils/aiMessageFormatter');
const { formatContextMetadata } = require('../../../src/utils/contextMetadataFormatter');
const { prepareAndSplitMessage } = require('../../../src/utils/messageSplitting');

describe('Message Formatting Pipeline - Golden Masters', () => {
  // Mock Date.now() to ensure consistent timestamps in snapshots
  const FIXED_DATE = new Date('2024-01-15T12:00:00Z');
  const originalDateNow = Date.now;
  
  beforeAll(() => {
    Date.now = jest.fn(() => FIXED_DATE.getTime());
  });
  
  afterAll(() => {
    Date.now = originalDateNow;
  });
  
  describe('Basic Message Formatting', () => {
    test('formats simple text message', async () => {
      const message = Factories.createGuildMessage('Hello world!');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with emoji', async () => {
      const message = Factories.createGuildMessage('Hello 👋 world! 🌍');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with Discord markdown', async () => {
      const message = Factories.createGuildMessage('**Bold** *italic* __underline__ ~~strikethrough~~ `code`');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats empty message', async () => {
      const message = Factories.createGuildMessage('');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats whitespace-only message', async () => {
      const message = Factories.createGuildMessage('   \n\t  ');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });
  });

  describe('Personality Mentions', () => {
    test('formats message with single mention', async () => {
      const message = Factories.createGuildMessage('@claude Hello!');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with multiple mentions', async () => {
      const message = Factories.createGuildMessage('@claude @gpt4 @bard Which of you is best?');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with multi-word mention', async () => {
      const message = Factories.createGuildMessage('@cash money Can you help me?');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with only mentions', async () => {
      const message = Factories.createGuildMessage('@claude @gpt4');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });
  });

  describe('Context Metadata', () => {
    test('formats guild message with context metadata', () => {
      const message = new MessageFactory()
        .withContent('Test message')
        .inGuild({ name: 'Cool Server' })
        .inChannel({ name: 'general' })
        .createdAt(new Date('2024-01-15T12:30:45Z'))
        .build();
      
      const contextMetadata = formatContextMetadata(message);
      expect(contextMetadata).toMatchSnapshot();
    });

    test('formats DM without context metadata', () => {
      const message = Factories.createDMMessage('Private message');
      const contextMetadata = formatContextMetadata(message);
      expect(contextMetadata).toMatchSnapshot();
    });

    test('formats thread message with parent context', () => {
      const message = new MessageFactory()
        .withContent('Thread discussion')
        .asThread({ name: 'bug-discussion' })
        .inGuild({ name: 'Dev Server' })
        .createdAt(new Date('2024-01-15T14:00:00Z'))
        .build();
      
      const contextMetadata = formatContextMetadata(message);
      expect(contextMetadata).toMatchSnapshot();
    });
  });

  describe('Message Splitting', () => {
    test('does not split message under 2000 chars', () => {
      const content = 'This is a normal length message that fits comfortably within limits.';
      const chunks = prepareAndSplitMessage(content, {}, 'Test');
      expect(chunks).toMatchSnapshot();
    });

    test('splits message at exactly 2000 chars', () => {
      const content = 'a'.repeat(2000);
      const chunks = prepareAndSplitMessage(content, {}, 'Test');
      expect(chunks).toMatchSnapshot();
    });

    test('splits message at 2001 chars', () => {
      const content = 'a'.repeat(2001);
      const chunks = prepareAndSplitMessage(content, {}, 'Test');
      expect(chunks).toMatchSnapshot();
    });

    test('preserves code blocks when splitting', () => {
      const content = '```javascript\n' + 'console.log("hello");\n'.repeat(100) + '```';
      const chunks = prepareAndSplitMessage(content, {}, 'Test');
      expect(chunks).toMatchSnapshot();
    });

    test('adds model indicator before splitting', () => {
      const content = 'a'.repeat(1990); // Close to limit
      const options = {
        modelIndicator: '\n\n-# Fallback Model Used'
      };
      const chunks = prepareAndSplitMessage(content, options, 'Test');
      expect(chunks).toMatchSnapshot();
    });
  });

  describe('Special Message Types', () => {
    test('formats webhook message from PluralKit', async () => {
      const message = new MessageFactory()
        .withContent('This is from a system member')
        .asWebhook({ username: 'Alice | Wonderland System' })
        .build();
      
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats reply with referenced content', async () => {
      const originalMessage = Factories.createGuildMessage('Original question here');
      const replyMessage = new MessageFactory()
        .withContent('This is my reply')
        .asReplyTo(originalMessage)
        .build();
      
      const formatted = await formatApiMessages([replyMessage], {
        includeReferences: true
      });
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with image attachment', async () => {
      const message = new MessageFactory()
        .withContent('Check out this image!')
        .withAttachment('https://example.com/image.png', {
          contentType: 'image/png',
          name: 'screenshot.png'
        })
        .build();
      
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with audio attachment', async () => {
      const message = new MessageFactory()
        .withContent('Listen to this!')
        .withAttachment('https://example.com/audio.mp3', {
          contentType: 'audio/mpeg',
          name: 'recording.mp3'
        })
        .build();
      
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with embed', async () => {
      const message = new MessageFactory()
        .withContent('Check this out:')
        .withEmbed({
          title: 'Embedded Content',
          description: 'This is an embed description',
          url: 'https://example.com',
          color: 0x5865F2
        })
        .build();
      
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });
  });

  describe('Complex Scenarios', () => {
    test('formats conversation history with multiple messages', async () => {
      const messages = [
        Factories.createGuildMessage('First message'),
        Factories.createGuildMessage('Second message'),
        new MessageFactory()
          .withContent('Third with attachment')
          .withAttachment('https://example.com/file.pdf')
          .build(),
        Factories.createWebhookMessage('Fourth from PluralKit', 'System Member')
      ];
      
      const formatted = await formatApiMessages(messages, {
        includeContext: true
      });
      expect(formatted).toMatchSnapshot();
    });

    test('formats message with everything combined', async () => {
      const originalMessage = Factories.createGuildMessage('What do you think?');
      const message = new MessageFactory()
        .withContent('@claude **Check this out!** Here\'s some `code` and an image:')
        .inGuild({ name: 'Tech Server' })
        .inChannel({ name: 'bot-testing' })
        .asReplyTo(originalMessage)
        .withAttachment('https://example.com/diagram.png')
        .withEmbed({
          title: 'Related Article',
          description: 'Some interesting content here'
        })
        .createdAt(new Date('2024-01-15T16:45:30Z'))
        .build();
      
      const formatted = await formatApiMessages([message], {
        includeReferences: true,
        includeContext: true
      });
      expect(formatted).toMatchSnapshot();
    });

    test('formats long message with mentions, code, and splitting', async () => {
      const longCode = '```javascript\nfunction example() {\n  console.log("test");\n}\n```\n'.repeat(50);
      const message = new MessageFactory()
        .withContent(`@claude Can you review this code?\n\n${longCode}\n\nThanks!`)
        .build();
      
      const formatted = await formatApiMessages([message], {});
      // formatApiMessages returns an array of message objects for the API
      // We need to extract the content from the formatted result
      const messageContent = formatted && formatted.length > 0 && formatted[0] 
        ? (formatted[0].content || formatted[0].text || '') 
        : '';
      
      const chunks = prepareAndSplitMessage(messageContent, {
        modelIndicator: '\n\n-# Primary Model Used (Free)'
      }, 'Test');
      
      expect({
        formattedMessages: formatted,
        extractedContent: messageContent,
        chunks,
        chunkCount: chunks.length
      }).toMatchSnapshot();
    });
  });

  describe('Edge Cases', () => {
    test('handles null/undefined values gracefully', async () => {
      const message = new MessageFactory()
        .withContent(null)
        .with({ 
          author: { ...Factories.createGuildMessage().author, username: null },
          guild: { ...Factories.createGuildMessage().guild, name: undefined }
        })
        .build();
      
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('handles messages with special characters', async () => {
      const message = Factories.createGuildMessage('Test <@123> & "quotes" \'apostrophes\' \\ backslash');
      const formatted = await formatApiMessages([message], {});
      expect(formatted).toMatchSnapshot();
    });

    test('handles very long single word', () => {
      const longWord = 'a'.repeat(2100); // Exceeds Discord limit
      const chunks = prepareAndSplitMessage(longWord, {}, 'Test');
      expect(chunks).toMatchSnapshot();
    });
  });
});

