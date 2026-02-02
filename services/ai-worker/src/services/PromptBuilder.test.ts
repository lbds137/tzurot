/**
 * Tests for PromptBuilder
 *
 * Comprehensive test coverage for prompt building, including:
 * - Search query building with attachments
 * - Human message construction
 * - System prompt assembly with personality
 * - Token counting utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PromptBuilder } from './PromptBuilder.js';
import { AttachmentType, type LoadedPersonality } from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type {
  MemoryDocument,
  DiscordEnvironment,
  ConversationContext,
} from './ConversationalRAGService.js';

// Factory function for ProcessedAttachment
function createProcessedAttachment(
  type: AttachmentType,
  description: string,
  url: string
): ProcessedAttachment {
  return {
    type,
    description,
    originalUrl: url,
    metadata: {
      url,
      contentType: type === AttachmentType.Audio ? 'audio/mpeg' : 'image/jpeg',
    },
  };
}

// Mock the dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({
      NODE_ENV: 'test',
    }),
    countTextTokens: vi.fn((text: string) => Math.ceil(text.length / 4)), // Mock: ~4 chars per token
    formatTimestampWithDelta: vi.fn((_date: Date) => ({
      absolute: 'Mon, Jan 15, 2024',
      relative: '2 weeks ago',
    })),
  };
});

import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: vi.fn((text: string) =>
    text.replace('{user}', 'TestUser').replace('{assistant}', 'TestBot')
  ),
}));

describe('PromptBuilder', () => {
  let promptBuilder: PromptBuilder;

  beforeEach(() => {
    promptBuilder = new PromptBuilder();
    vi.clearAllMocks();
  });

  describe('buildSearchQuery', () => {
    it('should return userMessage when no attachments', () => {
      const result = promptBuilder.buildSearchQuery('Hello world', []);
      expect(result).toBe('Hello world');
    });

    it('should use transcription for voice-only messages (userMessage="Hello")', () => {
      const attachments: ProcessedAttachment[] = [
        createProcessedAttachment(
          AttachmentType.Audio,
          'This is a voice transcription',
          'https://example.com/audio.mp3'
        ),
      ];

      const result = promptBuilder.buildSearchQuery('Hello', attachments);
      expect(result).toBe('This is a voice transcription');
    });

    it('should combine text with attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        createProcessedAttachment(
          AttachmentType.Image,
          'A beautiful sunset',
          'https://example.com/image.jpg'
        ),
      ];

      const result = promptBuilder.buildSearchQuery('Look at this!', attachments);
      expect(result).toBe('Look at this!\n\nA beautiful sunset');
    });

    it('should use descriptions only when userMessage is empty', () => {
      const attachments: ProcessedAttachment[] = [
        createProcessedAttachment(
          AttachmentType.Image,
          'An image description',
          'https://example.com/image.jpg'
        ),
      ];

      const result = promptBuilder.buildSearchQuery('', attachments);
      expect(result).toBe('An image description');
    });

    it('should filter out placeholder descriptions starting with [', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'Real description',
          originalUrl: 'https://example.com/image1.jpg',
          metadata: { url: 'https://example.com/image1.jpg', contentType: 'image/jpeg' },
        },
        {
          type: AttachmentType.Image,
          description: '[Placeholder: image pending]',
          originalUrl: 'https://example.com/image2.jpg',
          metadata: { url: 'https://example.com/image2.jpg', contentType: 'image/jpeg' },
        },
      ];

      const result = promptBuilder.buildSearchQuery('Test', attachments);
      expect(result).toBe('Test\n\nReal description');
    });

    it('should handle multiple attachments', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'First image',
          originalUrl: 'https://example.com/1.jpg',
          metadata: { url: 'https://example.com/1.jpg', contentType: 'image/jpeg' },
        },
        {
          type: AttachmentType.Image,
          description: 'Second image',
          originalUrl: 'https://example.com/2.jpg',
          metadata: { url: 'https://example.com/2.jpg', contentType: 'image/jpeg' },
        },
      ];

      const result = promptBuilder.buildSearchQuery('Check these out', attachments);
      expect(result).toBe('Check these out\n\nFirst image\n\nSecond image');
    });

    it('should include referenced message text in search query', () => {
      const referencedText = 'This is a message being referenced';
      const result = promptBuilder.buildSearchQuery('My reply', [], referencedText);
      expect(result).toBe('My reply\n\nThis is a message being referenced');
    });

    it('should combine user message, attachments, and referenced messages', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'An image description',
          originalUrl: 'https://example.com/image.jpg',
          metadata: { url: 'https://example.com/image.jpg', contentType: 'image/jpeg' },
        },
      ];
      const referencedText = 'Referenced message content';

      const result = promptBuilder.buildSearchQuery('Look at this', attachments, referencedText);
      expect(result).toBe('Look at this\n\nAn image description\n\nReferenced message content');
    });

    it('should use referenced messages even without user message or attachments', () => {
      const referencedText = 'Just the referenced content';
      const result = promptBuilder.buildSearchQuery('', [], referencedText);
      expect(result).toBe('Just the referenced content');
    });

    it('should skip "Hello" fallback when other content is available', () => {
      const referencedText = 'Referenced content';
      const result = promptBuilder.buildSearchQuery('Hello', [], referencedText);
      expect(result).toBe('Referenced content');
    });

    it('should handle voice transcription with referenced messages', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'Voice transcription',
          originalUrl: 'https://example.com/audio.mp3',
          metadata: { url: 'https://example.com/audio.mp3', contentType: 'image/jpeg' },
        },
      ];
      const referencedText = 'Referenced message';

      const result = promptBuilder.buildSearchQuery('Hello', attachments, referencedText);
      expect(result).toBe('Voice transcription\n\nReferenced message');
    });

    it('should handle empty/undefined referenced messages gracefully', () => {
      const result1 = promptBuilder.buildSearchQuery('Test', [], undefined);
      expect(result1).toBe('Test');

      const result2 = promptBuilder.buildSearchQuery('Test', [], '');
      expect(result2).toBe('Test');
    });

    describe('with recentHistoryWindow', () => {
      it('should include recent history window in search query', () => {
        const recentHistory = 'User: I love Dark Souls\nAssistant: It is a challenging game';
        const result = promptBuilder.buildSearchQuery(
          'What do you think about that?',
          [],
          undefined,
          recentHistory
        );

        // History should come FIRST for context
        expect(result).toBe(
          'User: I love Dark Souls\nAssistant: It is a challenging game\n\nWhat do you think about that?'
        );
      });

      it('should combine history, user message, attachments, and references', () => {
        const recentHistory = 'User: Previous message\nAssistant: Previous response';
        const attachments: ProcessedAttachment[] = [
          {
            type: AttachmentType.Image,
            description: 'Image description',
            originalUrl: 'https://example.com/img.jpg',
            metadata: { url: 'https://example.com/img.jpg', contentType: 'image/jpeg' },
          },
        ];
        const referencedText = 'Referenced message content';

        const result = promptBuilder.buildSearchQuery(
          'Current message',
          attachments,
          referencedText,
          recentHistory
        );

        expect(result).toBe(
          'User: Previous message\nAssistant: Previous response\n\n' +
            'Current message\n\n' +
            'Image description\n\n' +
            'Referenced message content'
        );
      });

      it('should handle undefined recent history gracefully', () => {
        const result = promptBuilder.buildSearchQuery('Test', [], undefined, undefined);
        expect(result).toBe('Test');
      });

      it('should handle empty recent history gracefully', () => {
        const result = promptBuilder.buildSearchQuery('Test', [], undefined, '');
        expect(result).toBe('Test');
      });

      it('should use history alone if user message is "Hello" fallback', () => {
        const recentHistory = 'User: What is the capital of France?\nAssistant: Paris';
        const result = promptBuilder.buildSearchQuery('Hello', [], undefined, recentHistory);

        // History provides context, Hello fallback is skipped
        expect(result).toBe('User: What is the capital of France?\nAssistant: Paris');
      });

      it('should help resolve pronouns like "that" through context', () => {
        const recentHistory = 'User: I bought a Tesla yesterday\nAssistant: That sounds exciting!';
        const result = promptBuilder.buildSearchQuery(
          'What do you know about it?',
          [],
          undefined,
          recentHistory
        );

        // The search now includes "Tesla" context to help LTM find relevant memories
        expect(result).toContain('Tesla');
        expect(result).toContain('What do you know about it?');
      });
    });
  });

  describe('buildHumanMessage', () => {
    it('should create simple text message without wrapper', () => {
      const result = promptBuilder.buildHumanMessage('Hello world', []);

      expect(result.message).toBeInstanceOf(HumanMessage);
      // User message is sent as-is (XML-escaped but no wrapper)
      // The LLM API already distinguishes system vs user messages via role
      expect(result.message.content).toBe('Hello world');
      expect(result.contentForStorage).toBe('Hello world');
    });

    it('should use transcription for voice messages', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'Voice transcription here',
          originalUrl: 'https://example.com/audio.mp3',
          metadata: { url: 'https://example.com/audio.mp3', contentType: 'image/jpeg' },
        },
      ];

      const result = promptBuilder.buildHumanMessage('Hello', attachments);

      // Message contains only the transcription (text ignored for voice)
      expect(result.message.content).toBe('Voice transcription here');
      expect(result.contentForStorage).toBe('Voice transcription here');
    });

    it('should combine text with attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'Image description',
          originalUrl: 'https://example.com/image.jpg',
          metadata: { url: 'https://example.com/image.jpg', contentType: 'image/jpeg' },
        },
      ];

      const result = promptBuilder.buildHumanMessage('Look at this', attachments);

      // Message contains both text and attachment description
      expect(result.message.content).toContain('Look at this');
      expect(result.message.content).toContain('Image description');
      expect(result.contentForStorage).toBe('Look at this\n\nImage description');
    });

    it('should append referenced messages to prompt but not to storage', () => {
      const references = '**Referenced Message**: Some earlier message';
      const result = promptBuilder.buildHumanMessage('Reply text', [], {
        referencedMessagesDescriptions: references,
      });

      // Message contains references for the LLM
      expect(result.message.content).toContain('Reply text');
      expect(result.message.content).toContain('**Referenced Message**: Some earlier message');

      // Storage has ONLY semantic content (references stored in messageMetadata)
      expect(result.contentForStorage).toBe('Reply text');
      expect(result.contentForStorage).not.toContain('**Referenced Message**');
    });

    it('should include speaker identification when activePersonaName is provided', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], { activePersonaName: 'Alice' });

      // User message includes <from> tag for speaker identification (no ID)
      expect(result.message.content).toBe('<from>Alice</from>\n\nHello');

      // Storage should NOT have the from wrapper (only semantic content)
      expect(result.contentForStorage).toBe('Hello');
    });

    it('should include persona ID in from tag when both name and ID are provided', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], {
        activePersonaName: 'Alice',
        activePersonaId: 'persona-123',
      });

      // User message includes <from id="..."> tag for speaker identification
      expect(result.message.content).toBe('<from id="persona-123">Alice</from>\n\nHello');

      // Storage should NOT have the from wrapper (only semantic content)
      expect(result.contentForStorage).toBe('Hello');
    });

    it('should work when activePersonaName is empty', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], { activePersonaName: '' });

      expect(result.message.content).toBe('Hello');
    });

    it('should handle complex combination: attachments + references + activePersona', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'An image',
          originalUrl: 'https://example.com/img.jpg',
          metadata: { url: 'https://example.com/img.jpg', contentType: 'image/jpeg' },
        },
      ];
      const references = '**Ref**: Earlier message';

      const result = promptBuilder.buildHumanMessage('My text', attachments, {
        activePersonaName: 'Bob',
        referencedMessagesDescriptions: references,
      });

      // Message has user content + attachments + references
      expect(result.message.content).toContain('My text');
      expect(result.message.content).toContain('An image');
      expect(result.message.content).toContain('**Ref**: Earlier message');

      // Storage has user message + attachments ONLY (references go in messageMetadata)
      // This is the storage philosophy: content = semantic text, metadata = contextual data
      expect(result.contentForStorage).toBe('My text\n\nAn image');
      expect(result.contentForStorage).not.toContain('**Ref**'); // References stored structurally, not in content
    });

    it('should disambiguate speaker when persona name matches personality name', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], {
        activePersonaName: 'Lila',
        activePersonaId: 'persona-123',
        discordUsername: 'lbds137',
        personalityName: 'Lila',
      });

      // Should disambiguate as "Lila (@lbds137)" to prevent AI confusion
      expect(result.message.content).toBe('<from id="persona-123">Lila (@lbds137)</from>\n\nHello');
      expect(result.contentForStorage).toBe('Hello');
    });

    it('should NOT disambiguate when names do not match', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], {
        activePersonaName: 'Bob',
        activePersonaId: 'persona-123',
        discordUsername: 'bob123',
        personalityName: 'Lila',
      });

      // No disambiguation needed - names don't match
      expect(result.message.content).toBe('<from id="persona-123">Bob</from>\n\nHello');
    });

    it('should NOT disambiguate when discordUsername is missing', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], {
        activePersonaName: 'Lila',
        activePersonaId: 'persona-123',
        personalityName: 'Lila',
        // discordUsername is undefined
      });

      // Can't disambiguate without discordUsername
      expect(result.message.content).toBe('<from id="persona-123">Lila</from>\n\nHello');
    });
  });

  describe('buildFullSystemPrompt', () => {
    const minimalPersonality: LoadedPersonality = {
      id: 'test-1',
      slug: 'test',
      name: 'TestBot',
      systemPrompt: 'You are a helpful assistant.',
      characterInfo: 'A test character',
      personalityTraits: 'Friendly and helpful',
      displayName: 'Test Bot',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
      contextWindowTokens: 8000,
    };

    const minimalContext: ConversationContext = {
      userId: 'user-1',
      channelId: 'channel-1',
      activePersonaName: 'User',
    };

    describe('XML structure and ordering', () => {
      it('should wrap persona in <system_identity> tags with sub-sections', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        const content = result.content as string;

        // System identity contains role and character (constraints are now separate sections)
        expect(content).toContain('<system_identity>');
        expect(content).toContain('</system_identity>');
        expect(content).toContain('<role>');
        expect(content).toContain('</role>');
        expect(content).toContain('<character>');
        expect(content).toContain('</character>');
        // Constraints are now separate: identity_constraints, platform_constraints, output_constraints
        expect(content).toContain('<identity_constraints>');
        expect(content).toContain('</identity_constraints>');
        expect(content).toContain('<platform_constraints>');
        expect(content).toContain('</platform_constraints>');
        expect(content).toContain('<output_constraints>');
        expect(content).toContain('</output_constraints>');
      });

      it('should wrap protocol in <protocol> tags when systemPrompt exists', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        const content = result.content as string;

        expect(content).toContain('<protocol>');
        expect(content).toContain('</protocol>');
        expect(content).toContain('You are a helpful assistant');
      });

      it('should not include <protocol> tags when systemPrompt is empty', () => {
        const personalityNoProtocol: LoadedPersonality = {
          ...minimalPersonality,
          systemPrompt: '',
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: personalityNoProtocol,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        const content = result.content as string;

        expect(content).not.toContain('<protocol>');
        expect(content).not.toContain('</protocol>');
      });

      it('should place system_identity at the START of the prompt (U-shaped attention)', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        const content = result.content as string;

        // system_identity should be at the very beginning
        expect(content.startsWith('<system_identity>')).toBe(true);
      });

      it('should place output_constraints at the END of the prompt (recency bias)', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        const content = result.content as string;

        // Output constraints should be at the very end (after protocol)
        expect(content.endsWith('</output_constraints>')).toBe(true);
      });

      it('should order sections correctly for U-shaped attention', () => {
        // Add all possible sections to verify complete ordering
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Test Server' },
          channel: { id: 'channel-1', name: 'general', type: 'text' },
        };

        const participants = new Map([
          ['Alice', { content: 'A tester', isActive: true, personaId: 'persona-alice' }],
        ]);

        const memories: MemoryDocument[] = [
          {
            pageContent: 'Test memory',
            metadata: { createdAt: new Date('2024-01-15').getTime() },
          },
        ];

        const contextWithEnv: ConversationContext = {
          ...minimalContext,
          environment: guildEnvironment,
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: participants,
          relevantMemories: memories,
          context: contextWithEnv,
          referencedMessagesFormatted:
            '<contextual_references>Referenced content</contextual_references>',
        });

        const content = result.content as string;

        // Get positions of each section - NEW structure
        const identityStart = content.indexOf('<system_identity>');
        const contextSection = content.indexOf('<context>');
        const locationSection = content.indexOf('<location');
        const participantsPos = content.indexOf('<participants>');
        const memories_pos = content.indexOf('<memory_archive');
        const references = content.indexOf('<contextual_references>');
        const protocolPos = content.indexOf('<protocol>');

        // Verify ordering: system_identity → context (with location) → participants → memories → references → protocol
        expect(identityStart).toBeLessThan(contextSection);
        expect(contextSection).toBeLessThan(locationSection);
        expect(locationSection).toBeLessThan(participantsPos);
        expect(participantsPos).toBeLessThan(memories_pos);
        expect(memories_pos).toBeLessThan(references);
        expect(references).toBeLessThan(protocolPos);
      });

      it('should have properly closed XML tags', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        const content = result.content as string;

        // Count opening and closing tags - NEW structure
        const identityOpen = (content.match(/<system_identity>/g) || []).length;
        const identityClose = (content.match(/<\/system_identity>/g) || []).length;
        const protocolOpen = (content.match(/<protocol>/g) || []).length;
        const protocolClose = (content.match(/<\/protocol>/g) || []).length;

        expect(identityOpen).toBe(1);
        expect(identityClose).toBe(1);
        expect(protocolOpen).toBe(1);
        expect(protocolClose).toBe(1);
      });
    });

    it('should create basic system prompt with minimal personality', () => {
      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: new Map(),
        relevantMemories: [],
        context: minimalContext,
      });

      expect(result).toBeInstanceOf(SystemMessage);
      const content = result.content as string;

      // Should contain core XML sections
      expect(content).toContain('<system_identity>');
      expect(content).toContain('<role>');
      expect(content).toContain('You are TestBot');
      expect(content).toContain('<character>');
      // XML tags inside <character> match database column names
      // display_name just contains the name, role section has "You are Name"
      expect(content).toContain('<display_name>Test Bot</display_name>');
      expect(content).toContain('<character_info>');
      expect(content).toContain('A test character');
      expect(content).toContain('<personality_traits>');
      expect(content).toContain('Friendly and helpful');
      // Context now in <context> section
      expect(content).toContain('<context>');
      expect(content).toContain('<datetime>');
      expect(content).toContain('<request_id>'); // Entropy injection to break API caching
      // Protocol section
      expect(content).toContain('<protocol>');
      expect(content).toContain('You are a helpful assistant');
    });

    it('should include all personality fields when present', () => {
      const fullPersonality: LoadedPersonality = {
        ...minimalPersonality,
        personalityTone: 'Casual and friendly',
        personalityAge: '25 years old',
        personalityAppearance: 'Tall with blue eyes',
        personalityLikes: 'Coding and music',
        personalityDislikes: 'Bugs and deadlines',
        conversationalGoals: 'Help users learn',
        conversationalExamples: 'Example: "How can I help?"',
      };

      const result = promptBuilder.buildFullSystemPrompt({
        personality: fullPersonality,
        participantPersonas: new Map(),
        relevantMemories: [],
        context: minimalContext,
      });

      const content = result.content as string;

      // XML tags match database column names
      expect(content).toContain('<personality_tone>');
      expect(content).toContain('Casual and friendly');
      expect(content).toContain('<personality_age>');
      expect(content).toContain('25 years old');
      expect(content).toContain('<personality_appearance>');
      expect(content).toContain('Tall with blue eyes');
      expect(content).toContain('<personality_likes>');
      expect(content).toContain('Coding and music');
      expect(content).toContain('<personality_dislikes>');
      expect(content).toContain('Bugs and deadlines');
      expect(content).toContain('<conversational_goals>');
      expect(content).toContain('Help users learn');
      expect(content).toContain('<conversational_examples>');
      expect(content).toContain('How can I help?');
    });

    it('should include conversation participants with XML structure', () => {
      const participants = new Map([
        ['Alice', { content: 'A software developer', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: 'A designer', isActive: false, personaId: 'persona-2' }],
      ]);

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: participants,
        relevantMemories: [],
        context: minimalContext,
      });

      const content = result.content as string;

      // Check for new XML structure with ID binding
      expect(content).toContain('<participants>');
      expect(content).toContain('</participants>');
      expect(content).toContain('<participant id="persona-1"');
      expect(content).toContain('<name>Alice</name>');
      expect(content).toContain('<![CDATA[A software developer]]>');
      expect(content).toContain('<participant id="persona-2"');
      expect(content).toContain('<name>Bob</name>');
      expect(content).toContain('<![CDATA[A designer]]>');
      // Group conversation note for multiple participants
      expect(content).toContain('<note>This is a group conversation');
    });

    it('should not show group note for single participant', () => {
      const participants = new Map([
        ['Alice', { content: 'A software developer', isActive: true, personaId: 'persona-1' }],
      ]);

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: participants,
        relevantMemories: [],
        context: minimalContext,
      });

      const content = result.content as string;

      // Should have participant but no group note
      expect(content).toContain('<participant id="persona-1"');
      expect(content).toContain('<name>Alice</name>');
      expect(content).not.toContain('<note>This is a group conversation');
    });

    it('should include relevant memories with timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'User likes pizza',
          metadata: {
            id: 'mem-1',
            createdAt: new Date('2024-01-15T12:00:00Z').getTime(),
          },
        },
        {
          pageContent: 'User dislikes spam',
          metadata: {
            id: 'mem-2',
            createdAt: new Date('2024-01-20T15:30:00Z').getTime(),
          },
        },
      ];

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: new Map(),
        relevantMemories: memories,
        context: minimalContext,
      });

      const content = result.content as string;

      // Now uses XML format with usage attribute
      expect(content).toContain('<memory_archive usage="context_only_do_not_repeat">');
      expect(content).toContain('<instruction>');
      expect(content).toContain('User likes pizza');
      expect(content).toContain('User dislikes spam');
    });

    it('should include referenced messages when provided', () => {
      const references = '**Referenced**: Some earlier context';

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: new Map(),
        relevantMemories: [],
        context: minimalContext,
        referencedMessagesFormatted: references,
      });

      const content = result.content as string;

      expect(content).toContain('**Referenced**: Some earlier context');
    });

    it('should include DM environment context in location XML', () => {
      const dmEnvironment: DiscordEnvironment = {
        type: 'dm',
        channel: {
          id: 'dm-1',
          name: 'Direct Message',
          type: 'DM',
        },
      };

      const contextWithEnv: ConversationContext = {
        ...minimalContext,
        environment: dmEnvironment,
      };

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: new Map(),
        relevantMemories: [],
        context: contextWithEnv,
      });

      const content = result.content as string;

      // NEW: Environment context is now in <context><location>
      expect(content).toContain('<context>');
      expect(content).toContain('<location type="dm">');
      expect(content).toContain('Direct Message');
      expect(content).toContain('private one-on-one chat');
    });

    it('should include guild environment context in location XML', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: {
          id: 'guild-1',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-1',
          name: 'general',
          type: 'text',
        },
        category: {
          id: 'cat-1',
          name: 'Community',
        },
      };

      const contextWithEnv: ConversationContext = {
        ...minimalContext,
        environment: guildEnvironment,
      };

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: new Map(),
        relevantMemories: [],
        context: contextWithEnv,
      });

      const content = result.content as string;

      // NEW: Environment context uses pure XML structure
      expect(content).toContain('<context>');
      expect(content).toContain('<location type="guild">');
      expect(content).toContain('<server name="Test Server"/>');
      expect(content).toContain('<category name="Community"/>');
      expect(content).toContain('<channel name="general" type="text"/>');
    });

    it('should include thread context when in thread', () => {
      const threadEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: {
          id: 'guild-1',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-1',
          name: 'general',
          type: 'text',
        },
        thread: {
          id: 'thread-1',
          name: 'Discussion Thread',
          parentChannel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
        },
      };

      const contextWithEnv: ConversationContext = {
        ...minimalContext,
        environment: threadEnvironment,
      };

      const result = promptBuilder.buildFullSystemPrompt({
        personality: minimalPersonality,
        participantPersonas: new Map(),
        relevantMemories: [],
        context: contextWithEnv,
      });

      const content = result.content as string;

      // NEW: Thread context in location XML
      expect(content).toContain('<location type="guild">');
      expect(content).toContain('<thread name="Discussion Thread"/>');
    });

    describe('name collision disambiguation', () => {
      it('should pass discordUsername to replacePromptPlaceholders for collision detection', () => {
        const contextWithDiscordUsername: ConversationContext = {
          ...minimalContext,
          activePersonaName: 'Lila',
          discordUsername: 'lbds137',
        };

        promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: contextWithDiscordUsername,
        });

        // Verify replacePromptPlaceholders was called with discordUsername
        // The 4th argument should be the discordUsername for collision detection
        expect(replacePromptPlaceholders).toHaveBeenCalledWith(
          minimalPersonality.systemPrompt,
          'Lila', // activePersonaName
          'TestBot', // personality.name
          'lbds137' // discordUsername
        );
      });

      it('should pass undefined discordUsername when not provided', () => {
        promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: minimalContext,
        });

        // Verify replacePromptPlaceholders was called with undefined discordUsername
        expect(replacePromptPlaceholders).toHaveBeenCalledWith(
          minimalPersonality.systemPrompt,
          'User', // Default when activePersonaName not set
          'TestBot', // personality.name
          undefined // No discordUsername
        );
      });

      it('should add collision instruction when user name matches personality name (case-insensitive)', () => {
        // Create a personality with name "Lila" (same as user's activePersonaName)
        const lilaPersonality: LoadedPersonality = {
          ...minimalPersonality,
          id: 'lila-1',
          slug: 'lila',
          name: 'Lila', // Same name as user
          displayName: 'Lila',
        };

        const contextWithCollision: ConversationContext = {
          ...minimalContext,
          activePersonaName: 'Lila', // User's persona name matches personality
          discordUsername: 'lbds137', // Required for collision detection
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: lilaPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: contextWithCollision,
        });

        const content = result.content as string;

        // Should include the collision instruction in constraints
        expect(content).toContain('A user named "Lila" shares your name');
        expect(content).toContain('Lila (@lbds137)');
        expect(content).toContain('This is a different person - address them naturally');
      });

      it('should NOT add collision instruction when names differ', () => {
        const contextWithDifferentName: ConversationContext = {
          ...minimalContext,
          activePersonaName: 'Alice', // Different from TestBot
          discordUsername: 'alice123',
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: minimalPersonality, // name: "TestBot"
          participantPersonas: new Map(),
          relevantMemories: [],
          context: contextWithDifferentName,
        });

        const content = result.content as string;

        // Should NOT include collision instruction
        expect(content).not.toContain('shares your name');
        expect(content).not.toContain('This is a different person');
      });

      it('should handle case-insensitive name matching', () => {
        const lilaPersonality: LoadedPersonality = {
          ...minimalPersonality,
          id: 'lila-1',
          slug: 'lila',
          name: 'LILA', // Uppercase
          displayName: 'LILA',
        };

        const contextWithLowercaseName: ConversationContext = {
          ...minimalContext,
          activePersonaName: 'lila', // lowercase
          discordUsername: 'lbds137',
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: lilaPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: contextWithLowercaseName,
        });

        const content = result.content as string;

        // Should detect collision despite case difference
        expect(content).toContain('shares your name');
      });

      it('should NOT add collision instruction when discordUsername is missing', () => {
        const lilaPersonality: LoadedPersonality = {
          ...minimalPersonality,
          id: 'lila-1',
          slug: 'lila',
          name: 'Lila',
          displayName: 'Lila',
        };

        const contextWithoutDiscordUsername: ConversationContext = {
          ...minimalContext,
          activePersonaName: 'Lila', // Same name
          // discordUsername is undefined - can't disambiguate without it
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: lilaPersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: contextWithoutDiscordUsername,
        });

        const content = result.content as string;

        // Should NOT include collision instruction (no discord username to show)
        expect(content).not.toContain('shares your name');
      });
    });
  });

  describe('formatUserMessage', () => {
    const minimalContext: ConversationContext = {
      userId: 'user-1',
      channelId: 'channel-1',
    };

    it('should format simple string message', () => {
      const result = promptBuilder.formatUserMessage('Hello world', minimalContext);
      expect(result).toBe('Hello world');
    });

    it('should add proxy message context', () => {
      const proxyContext: ConversationContext = {
        ...minimalContext,
        isProxyMessage: true,
        userName: 'Alice',
      };

      const result = promptBuilder.formatUserMessage('Test message', proxyContext);
      expect(result).toBe('[Message from Alice]\nTest message');
    });

    it('should handle object messages with content', () => {
      const message = { content: 'Object message' };
      const result = promptBuilder.formatUserMessage(message, minimalContext);
      expect(result).toBe('Object message');
    });

    it('should include referenced message context', () => {
      const message = {
        content: 'My reply',
        referencedMessage: {
          content: 'Original message',
          author: 'Bob',
        },
      };

      const result = promptBuilder.formatUserMessage(message, minimalContext);
      expect(result).toBe('[Replying to Bob: "Original message"]\nMy reply');
    });

    it('should note attachments', () => {
      const message = {
        content: 'Check this out',
        attachments: [{ name: 'image.jpg' }, { name: 'document.pdf' }],
      };

      const result = promptBuilder.formatUserMessage(message, minimalContext);
      expect(result).toContain('Check this out');
      expect(result).toContain('[Attachment: image.jpg]');
      expect(result).toContain('[Attachment: document.pdf]');
    });

    it('should return "Hello" for empty/invalid messages', () => {
      expect(promptBuilder.formatUserMessage('', minimalContext)).toBe('Hello');
      // Test with intentionally invalid input to verify error handling
      expect(promptBuilder.formatUserMessage({} as never, minimalContext)).toBe('Hello');
    });
  });

  describe('countTokens', () => {
    it('should count tokens for text', () => {
      const result = promptBuilder.countTokens('This is a test message');
      expect(result).toBeGreaterThan(0);
      expect(typeof result).toBe('number');
    });
  });

  describe('countMemoryTokens', () => {
    it('should return 0 for empty memories', () => {
      const result = promptBuilder.countMemoryTokens([]);
      expect(result).toBe(0);
    });

    it('should count tokens for memories with timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'First memory',
          metadata: {
            createdAt: new Date('2024-01-15T12:00:00Z').getTime(),
          },
        },
        {
          pageContent: 'Second memory',
          metadata: {
            createdAt: new Date('2024-01-20T15:30:00Z').getTime(),
          },
        },
      ];

      const result = promptBuilder.countMemoryTokens(memories);
      expect(result).toBeGreaterThan(0);
    });

    it('should count tokens for memories without timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory without timestamp',
          metadata: {},
        },
      ];

      const result = promptBuilder.countMemoryTokens(memories);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('countAttachmentTokens', () => {
    it('should return 0 for no attachments', () => {
      const result = promptBuilder.countAttachmentTokens([]);
      expect(result).toBe(0);
    });

    it('should count tokens from attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'A beautiful sunset over the ocean',
          originalUrl: 'https://example.com/sunset.jpg',
          metadata: { url: 'https://example.com/sunset.jpg', contentType: 'image/jpeg' },
        },
        {
          type: AttachmentType.Image,
          description: 'A mountain landscape',
          originalUrl: 'https://example.com/mountain.jpg',
          metadata: { url: 'https://example.com/mountain.jpg', contentType: 'image/jpeg' },
        },
      ];

      const result = promptBuilder.countAttachmentTokens(attachments);
      expect(result).toBeGreaterThan(0);
    });

    it('should filter out placeholder descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'Real description',
          originalUrl: 'https://example.com/image1.jpg',
          metadata: { url: 'https://example.com/image1.jpg', contentType: 'image/jpeg' },
        },
        {
          type: AttachmentType.Image,
          description: '[Placeholder]',
          originalUrl: 'https://example.com/image2.jpg',
          metadata: { url: 'https://example.com/image2.jpg', contentType: 'image/jpeg' },
        },
      ];

      const result = promptBuilder.countAttachmentTokens(attachments);
      // Should only count the real description
      expect(result).toBeGreaterThan(0);
    });
  });

  /**
   * SNAPSHOT TESTS
   *
   * These tests capture the full prompt output to detect unintentional regressions.
   * If a snapshot changes, review carefully - prompt changes can silently break AI behavior.
   *
   * Focus scenarios based on recent bugs:
   * - Forwarded messages with attachments
   * - Many participants (stop sequence generation)
   * - Extended context with image descriptions
   * - Voice transcripts
   */
  describe('Prompt Snapshots', () => {
    // Fixed date for deterministic snapshots
    const FIXED_DATE = new Date('2024-06-15T14:30:00Z');

    beforeEach(() => {
      vi.setSystemTime(FIXED_DATE);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const basePersonality: LoadedPersonality = {
      id: 'snapshot-personality-1',
      slug: 'snapshot-bot',
      name: 'SnapshotBot',
      systemPrompt: 'You are a helpful assistant. Always be kind and helpful.',
      characterInfo: 'A friendly AI assistant for testing',
      personalityTraits: 'Helpful, patient, thorough',
      displayName: 'Snapshot Bot',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
      contextWindowTokens: 8000,
    };

    const baseContext: ConversationContext = {
      userId: 'snapshot-user-1',
      channelId: 'snapshot-channel-1',
      activePersonaName: 'TestUser',
    };

    describe('buildFullSystemPrompt snapshots', () => {
      it('should match snapshot for minimal prompt', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: basePersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: baseContext,
        });

        // Normalize request_id which contains random entropy
        const content = (result.content as string).replace(
          /<request_id>[^<]+<\/request_id>/g,
          '<request_id>NORMALIZED</request_id>'
        );

        expect(content).toMatchSnapshot();
      });

      it('should match snapshot with multiple participants (stop sequence scenario)', () => {
        // This scenario triggered the >16 stop sequences bug with Google API
        const manyParticipants = new Map([
          [
            'Alice',
            {
              content: 'Software developer who loves TypeScript',
              isActive: true,
              personaId: 'p-alice',
            },
          ],
          [
            'Bob',
            {
              content: 'UX designer focused on accessibility',
              isActive: false,
              personaId: 'p-bob',
            },
          ],
          [
            'Charlie',
            {
              content: 'DevOps engineer managing infrastructure',
              isActive: false,
              personaId: 'p-charlie',
            },
          ],
          [
            'Diana',
            {
              content: 'Product manager setting priorities',
              isActive: false,
              personaId: 'p-diana',
            },
          ],
          [
            'Eve',
            {
              content: 'Security researcher finding vulnerabilities',
              isActive: false,
              personaId: 'p-eve',
            },
          ],
          [
            'Frank',
            { content: 'Backend developer working on APIs', isActive: false, personaId: 'p-frank' },
          ],
          [
            'Grace',
            { content: 'Data scientist building ML models', isActive: false, personaId: 'p-grace' },
          ],
          [
            'Henry',
            { content: 'QA engineer ensuring quality', isActive: false, personaId: 'p-henry' },
          ],
        ]);

        const result = promptBuilder.buildFullSystemPrompt({
          personality: basePersonality,
          participantPersonas: manyParticipants,
          relevantMemories: [],
          context: baseContext,
        });

        const content = (result.content as string).replace(
          /<request_id>[^<]+<\/request_id>/g,
          '<request_id>NORMALIZED</request_id>'
        );

        expect(content).toMatchSnapshot();
      });

      it('should match snapshot with memories and guild environment', () => {
        const memories: MemoryDocument[] = [
          {
            pageContent: 'User mentioned they prefer dark mode interfaces',
            metadata: { id: 'mem-1', createdAt: new Date('2024-06-10T10:00:00Z').getTime() },
          },
          {
            pageContent: 'User is working on a Discord bot project',
            metadata: { id: 'mem-2', createdAt: new Date('2024-06-12T15:30:00Z').getTime() },
          },
        ];

        const contextWithGuild: ConversationContext = {
          ...baseContext,
          environment: {
            type: 'guild',
            guild: { id: 'guild-1', name: 'Dev Community' },
            channel: { id: 'channel-1', name: 'bot-testing', type: 'text' },
            category: { id: 'cat-1', name: 'Development' },
          },
        };

        const result = promptBuilder.buildFullSystemPrompt({
          personality: basePersonality,
          participantPersonas: new Map([
            [
              'TestUser',
              { content: 'A developer testing the bot', isActive: true, personaId: 'p-test' },
            ],
          ]),
          relevantMemories: memories,
          context: contextWithGuild,
        });

        const content = (result.content as string).replace(
          /<request_id>[^<]+<\/request_id>/g,
          '<request_id>NORMALIZED</request_id>'
        );

        expect(content).toMatchSnapshot();
      });

      it('should match snapshot with referenced messages', () => {
        const result = promptBuilder.buildFullSystemPrompt({
          personality: basePersonality,
          participantPersonas: new Map(),
          relevantMemories: [],
          context: baseContext,
          referencedMessagesFormatted: `<contextual_references>
<referenced_message type="reply" author="Alice">
I was wondering about the performance implications of using pgvector
</referenced_message>
</contextual_references>`,
        });

        const content = (result.content as string).replace(
          /<request_id>[^<]+<\/request_id>/g,
          '<request_id>NORMALIZED</request_id>'
        );

        expect(content).toMatchSnapshot();
      });
    });

    describe('buildHumanMessage snapshots', () => {
      it('should match snapshot for simple message', () => {
        const result = promptBuilder.buildHumanMessage('Hello, how are you today?', []);
        expect(result.message.content).toMatchSnapshot();
        expect(result.contentForStorage).toMatchSnapshot();
      });

      it('should match snapshot with voice transcript', () => {
        const voiceAttachment: ProcessedAttachment[] = [
          {
            type: AttachmentType.Audio,
            description:
              'Hey, I was wondering if you could help me understand how the memory system works in this bot. I have been trying to figure out why some memories are not being retrieved properly.',
            originalUrl: 'https://cdn.discord.com/attachments/123/456/voice.ogg',
            metadata: {
              url: 'https://cdn.discord.com/attachments/123/456/voice.ogg',
              contentType: 'image/jpeg',
            },
          },
        ];

        const result = promptBuilder.buildHumanMessage('Hello', voiceAttachment, {
          activePersonaName: 'VoiceUser',
        });
        expect(result.message.content).toMatchSnapshot();
        expect(result.contentForStorage).toMatchSnapshot();
      });

      it('should match snapshot with image attachments', () => {
        const imageAttachments: ProcessedAttachment[] = [
          {
            type: AttachmentType.Image,
            description:
              'A screenshot showing an error message in the Discord bot. The error says "Rate limit exceeded" with a red background.',
            originalUrl: 'https://cdn.discord.com/attachments/123/456/error.png',
            metadata: {
              url: 'https://cdn.discord.com/attachments/123/456/error.png',
              contentType: 'image/jpeg',
            },
          },
          {
            type: AttachmentType.Image,
            description:
              'A diagram showing the architecture of a microservices system with three boxes labeled "bot-client", "api-gateway", and "ai-worker".',
            originalUrl: 'https://cdn.discord.com/attachments/123/456/architecture.png',
            metadata: {
              url: 'https://cdn.discord.com/attachments/123/456/architecture.png',
              contentType: 'image/jpeg',
            },
          },
        ];

        const result = promptBuilder.buildHumanMessage(
          'Can you explain what went wrong here?',
          imageAttachments,
          { activePersonaName: 'DebugUser' }
        );
        expect(result.message.content).toMatchSnapshot();
        expect(result.contentForStorage).toMatchSnapshot();
      });

      it('should match snapshot with forwarded/referenced message context', () => {
        const references = `**Forwarded from Alice:**
This is the original message that was forwarded. It contains important context about the discussion.

**Attached Image:** [Screenshot of a code snippet showing a TypeScript interface]`;

        const result = promptBuilder.buildHumanMessage('What do you think about this?', [], {
          activePersonaName: 'ForwardUser',
          referencedMessagesDescriptions: references,
        });
        expect(result.message.content).toMatchSnapshot();
        expect(result.contentForStorage).toMatchSnapshot();
      });

      it('should match snapshot with complex combination (attachments + references + persona)', () => {
        const attachments: ProcessedAttachment[] = [
          {
            type: AttachmentType.Image,
            description: 'A flowchart showing the message processing pipeline',
            originalUrl: 'https://cdn.discord.com/attachments/123/456/flow.png',
            metadata: {
              url: 'https://cdn.discord.com/attachments/123/456/flow.png',
              contentType: 'image/jpeg',
            },
          },
        ];

        const references = `<contextual_references>
<referenced_message type="reply" author="PreviousUser">
I tried implementing this but got stuck on the async handling
</referenced_message>
</contextual_references>`;

        const result = promptBuilder.buildHumanMessage(
          'Here is my updated implementation based on your feedback',
          attachments,
          {
            activePersonaName: 'ImplementerUser',
            referencedMessagesDescriptions: references,
          }
        );
        expect(result.message.content).toMatchSnapshot();
        expect(result.contentForStorage).toMatchSnapshot();
      });
    });

    describe('buildSearchQuery snapshots', () => {
      it('should match snapshot for pronoun resolution with history', () => {
        const recentHistory = `User: I've been working on a React project with TypeScript
Assistant: That sounds interesting! What features are you implementing?
User: Mainly authentication and user profiles`;

        const result = promptBuilder.buildSearchQuery(
          'What do you think about that approach?',
          [],
          undefined,
          recentHistory
        );

        expect(result).toMatchSnapshot();
      });

      it('should match snapshot with voice + references + history', () => {
        const voiceAttachment: ProcessedAttachment[] = [
          {
            type: AttachmentType.Audio,
            description: 'I want to add real-time notifications to my app',
            originalUrl: 'https://cdn.discord.com/voice.ogg',
            metadata: { url: 'https://cdn.discord.com/voice.ogg', contentType: 'image/jpeg' },
          },
        ];

        const result = promptBuilder.buildSearchQuery(
          'Hello', // Fallback that should be replaced by transcription
          voiceAttachment,
          'Previous discussion about WebSocket implementations',
          'User: How should I handle reconnection?\nAssistant: You should implement exponential backoff'
        );

        expect(result).toMatchSnapshot();
      });
    });
  });
});
