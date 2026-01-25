/**
 * Tests for DiagnosticCollector
 *
 * Tests the flight recorder that accumulates diagnostic data through the LLM pipeline:
 * - Meta information recording
 * - Input processing stage
 * - Memory retrieval stage
 * - Token budget allocation
 * - Prompt assembly
 * - LLM configuration
 * - LLM response recording
 * - Post-processing transforms
 * - Timing calculations
 * - Default values for missing stages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { DiagnosticCollector, type DiagnosticCollectorOptions } from './DiagnosticCollector.js';
import { AttachmentType } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('DiagnosticCollector', () => {
  const defaultOptions: DiagnosticCollectorOptions = {
    requestId: 'test-request-123',
    personalityId: 'personality-uuid-456',
    personalityName: 'Test Personality',
    userId: '123456789',
    guildId: '987654321',
    channelId: '111222333',
  };

  let collector: DiagnosticCollector;

  beforeEach(() => {
    collector = new DiagnosticCollector(defaultOptions);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with correct meta information', () => {
      const payload = collector.finalize();

      expect(payload.meta).toEqual({
        requestId: 'test-request-123',
        personalityId: 'personality-uuid-456',
        personalityName: 'Test Personality',
        userId: '123456789',
        guildId: '987654321',
        channelId: '111222333',
        timestamp: expect.any(String),
      });
    });

    it('should handle null guildId for DMs', () => {
      const dmCollector = new DiagnosticCollector({
        ...defaultOptions,
        guildId: null,
      });

      const payload = dmCollector.finalize();
      expect(payload.meta.guildId).toBeNull();
    });
  });

  describe('recordInputProcessing', () => {
    it('should record basic user message', () => {
      collector.recordInputProcessing({
        rawUserMessage: 'Hello, AI!',
        processedAttachments: [],
        searchQuery: 'hello ai',
      });

      const payload = collector.finalize();

      expect(payload.inputProcessing.rawUserMessage).toBe('Hello, AI!');
      expect(payload.inputProcessing.searchQuery).toBe('hello ai');
      expect(payload.inputProcessing.attachmentDescriptions).toEqual([]);
    });

    it('should record attachments with descriptions', () => {
      collector.recordInputProcessing({
        rawUserMessage: 'Check this image',
        processedAttachments: [
          {
            type: AttachmentType.Image,
            description: 'A photo of a sunset',
            originalUrl: 'https://example.com/image.jpg',
            metadata: { mimeType: 'image/jpeg', url: 'https://example.com/image.jpg' },
          },
        ],
        searchQuery: 'image sunset',
      });

      const payload = collector.finalize();
      expect(payload.inputProcessing.attachmentDescriptions).toEqual(['A photo of a sunset']);
    });

    it('should fallback to type for attachments with null/undefined description', () => {
      collector.recordInputProcessing({
        rawUserMessage: 'Check this',
        processedAttachments: [
          {
            type: AttachmentType.Image,
            description: null as unknown as string, // Null description
            originalUrl: 'https://example.com/image.jpg',
            metadata: { mimeType: 'image/jpeg', url: 'https://example.com/image.jpg' },
          },
        ],
        searchQuery: 'check',
      });

      const payload = collector.finalize();
      expect(payload.inputProcessing.attachmentDescriptions).toEqual(['[image]']);
    });

    it('should keep empty string description as-is', () => {
      collector.recordInputProcessing({
        rawUserMessage: 'Check this',
        processedAttachments: [
          {
            type: AttachmentType.Image,
            description: '', // Empty description
            originalUrl: 'https://example.com/image.jpg',
            metadata: { mimeType: 'image/jpeg', url: 'https://example.com/image.jpg' },
          },
        ],
        searchQuery: 'check',
      });

      const payload = collector.finalize();
      // Empty string is kept as-is since ?? only handles null/undefined
      expect(payload.inputProcessing.attachmentDescriptions).toEqual(['']);
    });

    it('should extract voice transcript from audio attachment', () => {
      collector.recordInputProcessing({
        rawUserMessage: '',
        processedAttachments: [
          {
            type: AttachmentType.Audio,
            description: 'This is my voice message transcription',
            originalUrl: 'https://example.com/audio.ogg',
            metadata: { mimeType: 'audio/ogg', url: 'https://example.com/audio.ogg' },
          },
        ],
        searchQuery: 'voice message',
      });

      const payload = collector.finalize();
      expect(payload.inputProcessing.voiceTranscript).toBe(
        'This is my voice message transcription'
      );
    });

    it('should record referenced messages', () => {
      collector.recordInputProcessing({
        rawUserMessage: 'What about that?',
        processedAttachments: [],
        referencedMessages: [
          { discordMessageId: 'msg-111', content: 'Original message content' },
          { discordMessageId: 'msg-222', content: 'Another referenced message' },
        ],
        searchQuery: 'about that',
      });

      const payload = collector.finalize();
      expect(payload.inputProcessing.referencedMessageIds).toEqual(['msg-111', 'msg-222']);
      expect(payload.inputProcessing.referencedMessagesContent).toEqual([
        'Original message content',
        'Another referenced message',
      ]);
    });
  });

  describe('recordMemoryRetrieval', () => {
    it('should record retrieved memories with scores', () => {
      collector.markMemoryRetrievalStart();

      collector.recordMemoryRetrieval({
        retrievedMemories: [
          {
            pageContent: 'Memory about cats',
            metadata: { id: 'mem-1', score: 0.95 },
          },
          {
            pageContent: 'Memory about dogs',
            metadata: { id: 'mem-2', score: 0.8 },
          },
        ],
        selectedMemories: [{ pageContent: 'Memory about cats', metadata: { id: 'mem-1' } }],
        focusModeEnabled: false,
      });

      const payload = collector.finalize();

      expect(payload.memoryRetrieval.memoriesFound).toHaveLength(2);
      expect(payload.memoryRetrieval.memoriesFound[0]).toEqual({
        id: 'mem-1',
        score: 0.95,
        preview: 'Memory about cats',
        includedInPrompt: true,
      });
      expect(payload.memoryRetrieval.memoriesFound[1].includedInPrompt).toBe(false);
    });

    it('should track focus mode status', () => {
      collector.recordMemoryRetrieval({
        retrievedMemories: [],
        selectedMemories: [],
        focusModeEnabled: true,
      });

      const payload = collector.finalize();
      expect(payload.memoryRetrieval.focusModeEnabled).toBe(true);
    });

    it('should create preview for long content', () => {
      const longContent = 'A'.repeat(300); // Longer than 200 chars

      collector.recordMemoryRetrieval({
        retrievedMemories: [{ pageContent: longContent, metadata: { id: 'mem-1', score: 0.9 } }],
        selectedMemories: [],
        focusModeEnabled: false,
      });

      const payload = collector.finalize();
      const preview = payload.memoryRetrieval.memoriesFound[0].preview;

      // Should be first 100 + " ... " + last 100
      expect(preview).toMatch(/^A{100} \.\.\. A{100}$/);
      expect(preview.length).toBe(205); // 100 + 5 + 100
    });
  });

  describe('recordTokenBudget', () => {
    it('should record token allocation', () => {
      collector.recordTokenBudget({
        contextWindowSize: 128000,
        systemPromptTokens: 500,
        memoryTokensUsed: 1500,
        historyTokensUsed: 3000,
        memoriesDropped: 2,
        historyMessagesDropped: 5,
      });

      const payload = collector.finalize();

      expect(payload.tokenBudget).toEqual({
        contextWindowSize: 128000,
        systemPromptTokens: 500,
        memoryTokensUsed: 1500,
        historyTokensUsed: 3000,
        memoriesDropped: 2,
        historyMessagesDropped: 5,
      });
    });
  });

  describe('recordAssembledPrompt', () => {
    it('should convert LangChain messages to diagnostic format', () => {
      const messages = [
        new SystemMessage('You are a helpful assistant.'),
        new HumanMessage('Hello!'),
        new AIMessage('Hi there! How can I help?'),
        new HumanMessage('What is 2+2?'),
      ];

      collector.recordAssembledPrompt(messages, 100);

      const payload = collector.finalize();

      expect(payload.assembledPrompt.messages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there! How can I help?' },
        { role: 'user', content: 'What is 2+2?' },
      ]);
      expect(payload.assembledPrompt.totalTokenEstimate).toBe(100);
    });

    it('should handle array content in messages', () => {
      const message = new HumanMessage({
        content: [{ type: 'text', text: 'First part' }, 'Second part'],
      });

      collector.recordAssembledPrompt([message], 50);

      const payload = collector.finalize();
      expect(payload.assembledPrompt.messages[0].content).toBe('First partSecond part');
    });
  });

  describe('recordLlmConfig', () => {
    it('should record full LLM configuration', () => {
      collector.recordLlmConfig({
        model: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        temperature: 0.8,
        topP: 0.9,
        topK: 50,
        maxTokens: 4096,
        frequencyPenalty: 0.0,
        presencePenalty: 0.1,
        repetitionPenalty: 1.0,
        stopSequences: ['Human:', 'User:'],
      });

      const payload = collector.finalize();

      expect(payload.llmConfig.model).toBe('claude-3-5-sonnet-20241022');
      expect(payload.llmConfig.provider).toBe('anthropic');
      expect(payload.llmConfig.temperature).toBe(0.8);
      expect(payload.llmConfig.stopSequences).toEqual(['Human:', 'User:']);
    });

    it('should handle optional parameters', () => {
      collector.recordLlmConfig({
        model: 'gpt-4',
        provider: 'openai',
        stopSequences: [],
      });

      const payload = collector.finalize();

      expect(payload.llmConfig.model).toBe('gpt-4');
      expect(payload.llmConfig.temperature).toBeUndefined();
      expect(payload.llmConfig.topP).toBeUndefined();
    });
  });

  describe('recordLlmResponse', () => {
    it('should record raw LLM response', () => {
      collector.markLlmInvocationStart();

      collector.recordLlmResponse({
        rawContent: 'The answer is 4.',
        finishReason: 'stop',
        stopSequenceTriggered: null,
        promptTokens: 50,
        completionTokens: 10,
        modelUsed: 'claude-3-5-sonnet-20241022',
      });

      const payload = collector.finalize();

      expect(payload.llmResponse).toEqual({
        rawContent: 'The answer is 4.',
        finishReason: 'stop',
        stopSequenceTriggered: null,
        promptTokens: 50,
        completionTokens: 10,
        modelUsed: 'claude-3-5-sonnet-20241022',
      });
    });

    it('should record stop sequence when triggered', () => {
      collector.recordLlmResponse({
        rawContent: 'Some response',
        finishReason: 'stop_sequence',
        stopSequenceTriggered: 'Human:',
        promptTokens: 100,
        completionTokens: 20,
        modelUsed: 'gpt-4',
      });

      const payload = collector.finalize();
      expect(payload.llmResponse.stopSequenceTriggered).toBe('Human:');
    });
  });

  describe('recordPostProcessing', () => {
    it('should detect duplicate removal', () => {
      collector.recordPostProcessing({
        rawContent: 'Hello Hello',
        deduplicatedContent: 'Hello',
        thinkingContent: null,
        strippedContent: 'Hello',
        finalContent: 'Hello',
      });

      const payload = collector.finalize();

      expect(payload.postProcessing.transformsApplied).toContain('duplicate_removal');
      expect(payload.postProcessing.duplicateDetected).toBe(true);
    });

    it('should detect thinking extraction', () => {
      collector.recordPostProcessing({
        rawContent: '<thinking>Analyzing...</thinking>Response here',
        deduplicatedContent: '<thinking>Analyzing...</thinking>Response here',
        thinkingContent: 'Analyzing...',
        strippedContent: 'Response here',
        finalContent: 'Response here',
      });

      const payload = collector.finalize();

      expect(payload.postProcessing.transformsApplied).toContain('thinking_extraction');
      expect(payload.postProcessing.thinkingExtracted).toBe(true);
      expect(payload.postProcessing.thinkingContent).toBe('Analyzing...');
    });

    it('should detect artifact stripping', () => {
      collector.recordPostProcessing({
        rawContent: 'Content with artifact',
        deduplicatedContent: 'Content with artifact',
        thinkingContent: null,
        strippedContent: 'Content', // Artifact removed
        finalContent: 'Content',
      });

      const payload = collector.finalize();

      expect(payload.postProcessing.transformsApplied).toContain('artifact_strip');
    });

    it('should detect placeholder replacement', () => {
      collector.recordPostProcessing({
        rawContent: 'Hello {{USER}}',
        deduplicatedContent: 'Hello {{USER}}',
        thinkingContent: null,
        strippedContent: 'Hello {{USER}}',
        finalContent: 'Hello Lila',
      });

      const payload = collector.finalize();

      expect(payload.postProcessing.transformsApplied).toContain('placeholder_replacement');
    });

    it('should handle no transforms applied', () => {
      collector.recordPostProcessing({
        rawContent: 'Simple response',
        deduplicatedContent: 'Simple response',
        thinkingContent: null,
        strippedContent: 'Simple response',
        finalContent: 'Simple response',
      });

      const payload = collector.finalize();

      expect(payload.postProcessing.transformsApplied).toHaveLength(0);
    });
  });

  describe('timing', () => {
    it('should calculate total duration', async () => {
      vi.useRealTimers(); // Need real timers for this test

      const startCollector = new DiagnosticCollector(defaultOptions);
      await new Promise(resolve => setTimeout(resolve, 15));
      const payload = startCollector.finalize();

      // Use slightly lower threshold than sleep time to account for timer imprecision
      expect(payload.timing.totalDurationMs).toBeGreaterThanOrEqual(10);
    });

    it('should calculate memory retrieval timing', () => {
      vi.useRealTimers();

      collector = new DiagnosticCollector(defaultOptions);
      collector.markMemoryRetrievalStart();

      // Simulate some time passing
      const sleepSync = (ms: number) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          // busy wait
        }
      };
      sleepSync(5);

      collector.recordMemoryRetrieval({
        retrievedMemories: [],
        selectedMemories: [],
        focusModeEnabled: false,
      });

      const payload = collector.finalize();
      expect(payload.timing.memoryRetrievalMs).toBeGreaterThanOrEqual(5);
    });

    it('should calculate LLM invocation timing', () => {
      vi.useRealTimers();

      collector = new DiagnosticCollector(defaultOptions);
      collector.markLlmInvocationStart();

      const sleepSync = (ms: number) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          // busy wait
        }
      };
      sleepSync(5);

      collector.recordLlmResponse({
        rawContent: 'Response',
        finishReason: 'stop',
        stopSequenceTriggered: null,
        promptTokens: 10,
        completionTokens: 5,
        modelUsed: 'test-model',
      });

      const payload = collector.finalize();
      expect(payload.timing.llmInvocationMs).toBeGreaterThanOrEqual(5);
    });
  });

  describe('default values', () => {
    it('should return defaults for missing input processing', () => {
      const payload = collector.finalize();

      expect(payload.inputProcessing).toEqual({
        rawUserMessage: '[not recorded]',
        attachmentDescriptions: [],
        voiceTranscript: null,
        referencedMessageIds: [],
        referencedMessagesContent: [],
        searchQuery: null,
      });
    });

    it('should return defaults for missing memory retrieval', () => {
      const payload = collector.finalize();

      expect(payload.memoryRetrieval).toEqual({
        memoriesFound: [],
        focusModeEnabled: false,
      });
    });

    it('should return defaults for missing LLM config', () => {
      const payload = collector.finalize();

      expect(payload.llmConfig).toEqual({
        model: '[not recorded]',
        provider: '[not recorded]',
        stopSequences: [],
        allParams: {},
      });
    });

    it('should return defaults for missing LLM response', () => {
      const payload = collector.finalize();

      expect(payload.llmResponse).toEqual({
        rawContent: '[not recorded]',
        finishReason: 'unknown',
        stopSequenceTriggered: null,
        promptTokens: 0,
        completionTokens: 0,
        modelUsed: '[not recorded]',
      });
    });

    it('should return defaults for missing post processing', () => {
      const payload = collector.finalize();

      expect(payload.postProcessing).toEqual({
        transformsApplied: [],
        duplicateDetected: false,
        thinkingExtracted: false,
        thinkingContent: null,
        artifactsStripped: [],
        finalContent: '[not recorded]',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle memories without metadata id', () => {
      collector.recordMemoryRetrieval({
        retrievedMemories: [{ pageContent: 'Memory content', metadata: {} }],
        selectedMemories: [],
        focusModeEnabled: false,
      });

      const payload = collector.finalize();
      expect(payload.memoryRetrieval.memoriesFound[0].id).toBe('unknown');
    });

    it('should handle memories without score', () => {
      collector.recordMemoryRetrieval({
        retrievedMemories: [{ pageContent: 'Memory content', metadata: { id: 'test' } }],
        selectedMemories: [],
        focusModeEnabled: false,
      });

      const payload = collector.finalize();
      expect(payload.memoryRetrieval.memoriesFound[0].score).toBe(0);
    });

    it('should handle empty thinking content string', () => {
      collector.recordPostProcessing({
        rawContent: 'Response',
        deduplicatedContent: 'Response',
        thinkingContent: '', // Empty string, not null
        strippedContent: 'Response',
        finalContent: 'Response',
      });

      const payload = collector.finalize();
      expect(payload.postProcessing.transformsApplied).not.toContain('thinking_extraction');
    });
  });
});
