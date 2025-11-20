/**
 * Message Processors Unit Tests
 *
 * Tests for all message processors in the Chain of Responsibility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotMessageFilter } from '../../processors/BotMessageFilter.js';
import { EmptyMessageFilter } from '../../processors/EmptyMessageFilter.js';
import { VoiceMessageProcessor } from '../../processors/VoiceMessageProcessor.js';
import { ReplyMessageProcessor } from '../../processors/ReplyMessageProcessor.js';
import { PersonalityMentionProcessor } from '../../processors/PersonalityMentionProcessor.js';
import { BotMentionProcessor } from '../../processors/BotMentionProcessor.js';
import type { Message } from 'discord.js';
import type { LoadedPersonality, PersonalityService } from '@tzurot/common-types';
import type { VoiceTranscriptionService } from '../../services/VoiceTranscriptionService.js';

// Mock dependencies
vi.mock('../../services/VoiceTranscriptionService.js', () => ({
  VoiceTranscriptionService: vi.fn(),
}));

vi.mock('../../services/ReplyResolutionService.js', () => ({
  ReplyResolutionService: vi.fn(),
}));

vi.mock('../../services/PersonalityMessageHandler.js', () => ({
  PersonalityMessageHandler: vi.fn(),
}));

vi.mock('../../utils/personalityMentionParser.js', () => ({
  findPersonalityMention: vi.fn(),
}));

// Import getConfig to mock it
import { getConfig } from '@tzurot/common-types';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    PersonalityService: vi.fn(),
    getConfig: vi.fn(),
  };
});

import { findPersonalityMention } from '../../utils/personalityMentionParser.js';

describe('Message Processors', () => {
  describe('BotMessageFilter', () => {
    let filter: BotMessageFilter;

    beforeEach(() => {
      filter = new BotMessageFilter();
    });

    it('should filter out bot messages', async () => {
      const message = createMockMessage({ authorBot: true });

      const result = await filter.process(message);

      expect(result).toBe(true); // Should stop processing
    });

    it('should allow human messages', async () => {
      const message = createMockMessage({ authorBot: false });

      const result = await filter.process(message);

      expect(result).toBe(false); // Should continue processing
    });
  });

  describe('EmptyMessageFilter', () => {
    let filter: EmptyMessageFilter;

    beforeEach(() => {
      filter = new EmptyMessageFilter();
    });

    it('should filter out empty messages', async () => {
      const message = createMockMessage({ content: '', attachmentCount: 0 });

      const result = await filter.process(message);

      expect(result).toBe(true); // Should stop processing
    });

    it('should allow messages with content', async () => {
      const message = createMockMessage({ content: 'Hello', attachmentCount: 0 });

      const result = await filter.process(message);

      expect(result).toBe(false); // Should continue processing
    });

    it('should allow messages with attachments but no content', async () => {
      const message = createMockMessage({ content: '', attachmentCount: 1 });

      const result = await filter.process(message);

      expect(result).toBe(false); // Should continue processing
    });
  });

  describe('VoiceMessageProcessor', () => {
    let processor: VoiceMessageProcessor;
    let mockVoiceService: {
      hasVoiceAttachment: ReturnType<typeof vi.fn>;
      transcribe: ReturnType<typeof vi.fn>;
    };
    let mockPersonalityService: {
      loadPersonality: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      vi.clearAllMocks();

      mockVoiceService = {
        hasVoiceAttachment: vi.fn(),
        transcribe: vi.fn(),
      };

      mockPersonalityService = {
        loadPersonality: vi.fn(),
      };

      processor = new VoiceMessageProcessor(
        mockVoiceService as unknown as VoiceTranscriptionService,
        mockPersonalityService as unknown as PersonalityService
      );
    });

    it('should continue processing when AUTO_TRANSCRIBE_VOICE is disabled', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'false',
        BOT_MENTION_CHAR: '@',
      });

      const message = createMockMessage();
      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
      expect(mockVoiceService.hasVoiceAttachment).not.toHaveBeenCalled();
    });

    it('should continue processing when no voice attachment', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });

      mockVoiceService.hasVoiceAttachment.mockReturnValue(false);

      const message = createMockMessage();
      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
    });

    it('should stop processing for voice-only messages', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });

      const message = createMockMessage({ content: '' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: false, // Voice-only
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith(message, false, false);
      expect(result).toBe(true); // Should stop (voice-only)
    });

    it('should continue processing for voice+mention', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });

      const message = createMockMessage({ content: '@lilith' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: true, // Has mention
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: '',
      });

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
    });

    it('should store voice transcript on message object', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });

      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Stored transcript',
        continueToPersonalityHandler: true,
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await processor.process(message);

      // Should be able to retrieve transcript
      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);
      expect(transcript).toBe('Stored transcript');
    });

    it('should handle transcription errors gracefully', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });

      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue(null); // Transcription failed

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      // Should stop processing (transcription failed)
      expect(result).toBe(true);
    });
  });

  describe('ReplyMessageProcessor', () => {
    let processor: ReplyMessageProcessor;
    let mockReplyResolver: {
      resolvePersonality: ReturnType<typeof vi.fn>;
    };
    let mockPersonalityHandler: {
      handleMessage: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      vi.clearAllMocks();

      mockReplyResolver = {
        resolvePersonality: vi.fn(),
      };

      mockPersonalityHandler = {
        handleMessage: vi.fn().mockResolvedValue(undefined),
      };

      processor = new ReplyMessageProcessor(
        mockReplyResolver as any,
        mockPersonalityHandler as any
      );
    });

    it('should continue when message is not a reply', async () => {
      const message = createMockMessage({ reference: null });

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
      expect(mockReplyResolver.resolvePersonality).not.toHaveBeenCalled();
    });

    it('should continue when reply is not to a personality', async () => {
      const message = createMockMessage({ reference: { messageId: 'msg-123' } as any });
      mockReplyResolver.resolvePersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('should handle reply to personality', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({
        content: 'Reply text',
        reference: { messageId: 'msg-123' } as any,
      });

      mockReplyResolver.resolvePersonality.mockResolvedValue(mockPersonality);

      const result = await processor.process(message);

      expect(mockReplyResolver.resolvePersonality).toHaveBeenCalledWith(message);
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'Reply text'
      );
      expect(result).toBe(true); // Should stop
    });

    it('should use voice transcript if available', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({
        content: 'Text content',
        reference: { messageId: 'msg-123' } as any,
      });

      // Mock voice transcript storage
      Object.defineProperty(message, Symbol.for('voiceTranscript'), {
        value: 'Voice transcript',
        enumerable: false,
      });

      // Create a mock that returns the voice transcript
      vi.spyOn(VoiceMessageProcessor, 'getVoiceTranscript').mockReturnValue('Voice transcript');

      mockReplyResolver.resolvePersonality.mockResolvedValue(mockPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'Voice transcript' // Should use voice transcript, not text content
      );

      vi.restoreAllMocks();
    });
  });

  describe('PersonalityMentionProcessor', () => {
    let processor: PersonalityMentionProcessor;
    let mockPersonalityService: {
      loadPersonality: ReturnType<typeof vi.fn>;
    };
    let mockPersonalityHandler: {
      handleMessage: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      vi.clearAllMocks();

      mockPersonalityService = {
        loadPersonality: vi.fn(),
      };

      mockPersonalityHandler = {
        handleMessage: vi.fn().mockResolvedValue(undefined),
      };

      processor = new PersonalityMentionProcessor(
        mockPersonalityService as any,
        mockPersonalityHandler as any
      );
    });

    it('should continue when no personality mention', async () => {
      const message = createMockMessage({ content: 'Hello world' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
    });

    it('should continue when unknown personality mentioned', async () => {
      const message = createMockMessage({ content: '@unknown hello' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'unknown',
        cleanContent: 'hello',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('should handle personality mention', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({ content: '@lilith hello' });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: 'hello',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'hello'
      );
      expect(result).toBe(true); // Should stop
    });

    it('should use voice transcript if available', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({ content: '@lilith text' });

      vi.spyOn(VoiceMessageProcessor, 'getVoiceTranscript').mockReturnValue('Voice transcript');

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: 'text',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'Voice transcript'
      );

      vi.restoreAllMocks();
    });
  });

  describe('BotMentionProcessor', () => {
    let processor: BotMentionProcessor;
    let mockPersonalityService: {
      loadPersonality: ReturnType<typeof vi.fn>;
    };
    let mockPersonalityHandler: {
      handleMessage: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      vi.clearAllMocks();

      mockPersonalityService = {
        loadPersonality: vi.fn(),
      };

      mockPersonalityHandler = {
        handleMessage: vi.fn().mockResolvedValue(undefined),
      };

      processor = new BotMentionProcessor(
        mockPersonalityService as any,
        mockPersonalityHandler as any
      );
    });

    it('should continue when no bot mention', async () => {
      const message = createMockMessage({
        content: 'Hello world',
        hasBotMention: false,
      });

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
    });

    it('should continue when default personality not configured', async () => {
      const message = createMockMessage({
        content: '<@123456> hello',
        hasBotMention: true,
      });

      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('default');
      expect(result).toBe(false); // Should continue
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('should handle bot mention with default personality', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({
        content: '<@123456> hello there',
        hasBotMention: true,
      });

      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('default');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'hello there' // Discord mention tags removed
      );
      expect(result).toBe(true); // Should stop
    });

    it('should clean Discord mention tags from content', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({
        content: '<@123456> <@!789> hello world',
        hasBotMention: true,
      });

      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'hello world' // Both mention formats removed
      );
    });

    it('should use voice transcript if available', async () => {
      const mockPersonality = createMockPersonality();
      const message = createMockMessage({
        content: '<@123456> text',
        hasBotMention: true,
      });

      vi.spyOn(VoiceMessageProcessor, 'getVoiceTranscript').mockReturnValue('Voice transcript');

      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockPersonality,
        'Voice transcript'
      );

      vi.restoreAllMocks();
    });
  });
});

// Helper functions
interface MockMessageOptions {
  content?: string;
  authorBot?: boolean;
  attachmentCount?: number;
  reference?: any;
  hasBotMention?: boolean;
}

function createMockMessage(options: MockMessageOptions = {}): Message {
  const attachments = new Map();
  for (let i = 0; i < (options.attachmentCount || 0); i++) {
    attachments.set(`attachment-${i}`, { id: `attachment-${i}` });
  }

  const mentions = {
    has: vi.fn((user: any) => options.hasBotMention ?? false),
  };

  return {
    content: options.content ?? '',
    author: {
      bot: options.authorBot ?? false,
      id: 'author-123',
    },
    attachments,
    reference: options.reference ?? null,
    mentions,
    client: {
      user: {
        id: '123456',
      },
    },
  } as unknown as Message;
}

function createMockPersonality(): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'test-personality',
    displayName: 'Test Personality',
    systemPrompt: 'You are a test',
    llmConfig: {
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1000,
    },
  } as LoadedPersonality;
}
