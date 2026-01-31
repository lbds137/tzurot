// Mock all dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/media/mediaHandler');
jest.mock('../../../src/utils/messageSplitting');

const logger = require('../../../src/logger');
const {
  processMediaForWebhook,
  prepareAttachmentOptions,
} = require('../../../src/utils/media/mediaHandler');
const { prepareAndSplitMessage, chunkHelpers } = require('../../../src/utils/messageSplitting');
const { sendFormattedMessageInDM } = require('../../../src/webhook/dmHandler');

describe('dmHandler', () => {
  let mockChannel;
  let mockDelayFn;
  let mockPersonality;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock channel
    mockChannel = {
      id: 'dm-channel-123',
      isDMBased: jest.fn().mockReturnValue(true),
      send: jest.fn(),
    };

    // Mock delay function
    mockDelayFn = jest.fn().mockResolvedValue(undefined);

    // Mock personality
    mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
    };

    // Mock prepareAndSplitMessage to return array
    prepareAndSplitMessage.mockImplementation((content, options, logPrefix) => {
      if (content.length <= 2000) {
        return [content];
      }
      // Simple split for testing
      const chunks = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks;
    });
    
    // Mock chunkHelpers
    chunkHelpers.isFirstChunk = jest.fn(i => i === 0);
    chunkHelpers.isLastChunk = jest.fn((i, len) => i === len - 1);
    chunkHelpers.getChunkDelay = jest.fn(() => 750);

    // Mock processMediaForWebhook to return input content unchanged by default
    processMediaForWebhook.mockImplementation(async content => ({
      content: content,
      attachments: [],
    }));

    // Mock prepareAttachmentOptions
    prepareAttachmentOptions.mockReturnValue({ files: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sendFormattedMessageInDM', () => {
    it('should format message with personality display name', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      await sendFormattedMessageInDM(
        mockChannel,
        'Hello from personality',
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Test Personality:** Hello from personality',
      });
    });

    it('should use fullName when displayName is missing', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const personalityNoDisplay = {
        fullName: 'test-personality',
      };

      await sendFormattedMessageInDM(mockChannel, 'Hello', personalityNoDisplay, {}, mockDelayFn);

      // Should extract and capitalize first part
      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Test:** Hello',
      });
    });

    it('should handle personality with no hyphen in fullName', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const personalityNoHyphen = {
        fullName: 'personality',
      };

      await sendFormattedMessageInDM(mockChannel, 'Hello', personalityNoHyphen, {}, mockDelayFn);

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Personality:** Hello',
      });
    });

    it('should fallback to Bot when no name available', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      await sendFormattedMessageInDM(mockChannel, 'Hello', {}, {}, mockDelayFn);

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Bot:** Hello',
      });
    });

    it('should process media URLs in content', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      processMediaForWebhook.mockResolvedValue({
        content: 'Check out this image',
        attachments: [{ name: 'image.png', attachment: Buffer.from('data') }],
      });

      prepareAttachmentOptions.mockReturnValue({
        files: [{ name: 'image.png', attachment: Buffer.from('data') }],
      });

      await sendFormattedMessageInDM(
        mockChannel,
        'Check out this image https://example.com/image.png',
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(processMediaForWebhook).toHaveBeenCalledWith(
        'Check out this image https://example.com/image.png'
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [{ name: 'image.png', attachment: Buffer.from('data') }],
        })
      );
    });

    it('should handle media processing errors gracefully', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      processMediaForWebhook.mockRejectedValue(new Error('Media error'));

      await sendFormattedMessageInDM(
        mockChannel,
        'Content with media',
        mockPersonality,
        {},
        mockDelayFn
      );

      // Should continue with original content
      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Test Personality:** Content with media',
      });
    });

    it('should handle multimodal content array', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const multimodalContent = [
        { type: 'text', text: 'Here is some text' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ];

      await sendFormattedMessageInDM(
        mockChannel,
        multimodalContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      // Should send text first
      expect(mockChannel.send).toHaveBeenNthCalledWith(1, {
        content: '**Test Personality:** Here is some text',
      });

      // Should send audio (prioritized over image)
      expect(mockChannel.send).toHaveBeenNthCalledWith(2, {
        content: '**Test Personality:** [Audio: https://example.com/audio.mp3]',
      });

      // Image should not be sent when audio is present
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });

    it('should send image when no audio in multimodal content', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const multimodalContent = [
        { type: 'text', text: 'Here is an image' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      ];

      await sendFormattedMessageInDM(
        mockChannel,
        multimodalContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenNthCalledWith(2, {
        content: '**Test Personality:** [Image: https://example.com/image.png]',
      });
    });

    it('should handle empty multimodal text content', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const multimodalContent = [
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      ];

      await sendFormattedMessageInDM(
        mockChannel,
        multimodalContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      // Should use default message
      expect(mockChannel.send).toHaveBeenNthCalledWith(1, {
        content: "**Test Personality:** Here's the media you requested:",
      });
    });

    it('should handle referenced media markers', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const contentWithMarker =
        'Check this out [REFERENCE_MEDIA:image:https://example.com/ref.png] cool right?';

      await sendFormattedMessageInDM(
        mockChannel,
        contentWithMarker,
        mockPersonality,
        {},
        mockDelayFn
      );

      // Should remove marker and send media separately
      expect(mockChannel.send).toHaveBeenNthCalledWith(1, {
        content: '**Test Personality:** Check this out  cool right?',
      });

      expect(mockChannel.send).toHaveBeenNthCalledWith(2, {
        content: '**Test Personality:** [Image: https://example.com/ref.png]',
      });
    });

    it('should handle audio reference markers', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const contentWithMarker =
        'Listen to this [REFERENCE_MEDIA:audio:https://example.com/sound.mp3]';

      await sendFormattedMessageInDM(
        mockChannel,
        contentWithMarker,
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(mockChannel.send).toHaveBeenNthCalledWith(2, {
        content: '**Test Personality:** [Audio: https://example.com/sound.mp3]',
      });
    });

    it('should split long messages into chunks', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const longContent = 'A'.repeat(2100);

      await sendFormattedMessageInDM(mockChannel, longContent, mockPersonality, {}, mockDelayFn);

      expect(prepareAndSplitMessage).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });

    it('should add delay between chunks', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const longContent = 'A'.repeat(2100);

      await sendFormattedMessageInDM(mockChannel, longContent, mockPersonality, {}, mockDelayFn);

      expect(mockDelayFn).toHaveBeenCalledWith(750);
    });

    it('should include embeds in last chunk only', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const embeds = [{ title: 'Test Embed' }];

      await sendFormattedMessageInDM(
        mockChannel,
        'Short message',
        mockPersonality,
        { embeds },
        mockDelayFn
      );

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Test Personality:** Short message',
        embeds,
      });
    });

    it('should handle media attachments in last chunk', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      processMediaForWebhook.mockResolvedValue({
        content: 'Content',
        attachments: [{ name: 'file.txt' }],
      });

      prepareAttachmentOptions.mockReturnValue({
        files: [{ name: 'file.txt' }],
      });

      await sendFormattedMessageInDM(
        mockChannel,
        'Content with attachment',
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [{ name: 'file.txt' }],
        })
      );
    });

    it('should add delay between media messages', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const multimodalContent = [
        { type: 'text', text: 'Text' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ];

      await sendFormattedMessageInDM(
        mockChannel,
        multimodalContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      // Should delay before sending audio
      expect(mockDelayFn).toHaveBeenCalledWith(750);
    });

    it('should handle errors when sending multimodal audio', async () => {
      mockChannel.send
        .mockResolvedValueOnce({ id: 'text-123' })
        .mockRejectedValueOnce(new Error('Audio send failed'));

      const multimodalContent = [
        { type: 'text', text: 'Text' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ];

      const result = await sendFormattedMessageInDM(
        mockChannel,
        multimodalContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      // Should still return success for text message
      expect(result.messageIds).toContain('text-123');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error sending audio message')
      );
    });

    it('should handle errors when sending multimodal image', async () => {
      mockChannel.send
        .mockResolvedValueOnce({ id: 'text-123' })
        .mockRejectedValueOnce(new Error('Image send failed'));

      const multimodalContent = [
        { type: 'text', text: 'Text' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      ];

      const result = await sendFormattedMessageInDM(
        mockChannel,
        multimodalContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(result.messageIds).toContain('text-123');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error sending image message')
      );
    });

    it('should return structured result with all message IDs', async () => {
      mockChannel.send
        .mockResolvedValueOnce({ id: 'message-1' })
        .mockResolvedValueOnce({ id: 'message-2' });

      const longContent = 'A'.repeat(2100);

      const result = await sendFormattedMessageInDM(
        mockChannel,
        longContent,
        mockPersonality,
        {},
        mockDelayFn
      );

      expect(result).toEqual({
        message: { id: 'message-1' },
        messageIds: ['message-1', 'message-2'],
        isDM: true,
        personalityName: 'test-personality',
      });
    });

    it('should handle channel send errors', async () => {
      mockChannel.send.mockRejectedValue(new Error('Send failed'));

      await expect(
        sendFormattedMessageInDM(mockChannel, 'Test', mockPersonality, {}, mockDelayFn)
      ).rejects.toThrow('Send failed');
    });

    it('should handle invalid reference media markers', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      // Marker without closing bracket
      const invalidMarker = 'Text [REFERENCE_MEDIA:image:url more text';

      await sendFormattedMessageInDM(mockChannel, invalidMarker, mockPersonality, {}, mockDelayFn);

      // Should send as-is without processing
      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '**Test Personality:** Text [REFERENCE_MEDIA:image:url more text',
      });
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });

    it('should handle reference markers with colons in URL', async () => {
      mockChannel.send.mockResolvedValue({ id: 'message-123' });

      const markerWithPort = 'Check [REFERENCE_MEDIA:image:https://example.com:8080/image.png] out';

      await sendFormattedMessageInDM(mockChannel, markerWithPort, mockPersonality, {}, mockDelayFn);

      // Should correctly parse URL with port
      expect(mockChannel.send).toHaveBeenNthCalledWith(2, {
        content: '**Test Personality:** [Image: https://example.com:8080/image.png]',
      });
    });
  });
});
