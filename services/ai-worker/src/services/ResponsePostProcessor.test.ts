/**
 * Tests for ResponsePostProcessor
 *
 * Unit tests for response cleaning, reasoning extraction, and reference filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponsePostProcessor, looksLikeLeakedThinking } from './ResponsePostProcessor.js';

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockRemoveDuplicateResponse,
  mockStripResponseArtifacts,
  mockStripUserMessageEcho,
  mockExtractThinkingBlocks,
  mockExtractApiReasoningContent,
  mockMergeThinkingContent,
  mockReplacePromptPlaceholders,
  mockLogger,
} = vi.hoisted(() => ({
  mockRemoveDuplicateResponse: vi.fn(),
  mockStripResponseArtifacts: vi.fn(),
  mockStripUserMessageEcho: vi.fn(),
  mockExtractThinkingBlocks: vi.fn(),
  mockExtractApiReasoningContent: vi.fn(),
  mockMergeThinkingContent: vi.fn(),
  mockReplacePromptPlaceholders: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

vi.mock('../utils/duplicateDetection.js', () => ({
  removeDuplicateResponse: mockRemoveDuplicateResponse,
}));

vi.mock('../utils/responseArtifacts.js', () => ({
  stripResponseArtifacts: mockStripResponseArtifacts,
  stripUserMessageEcho: mockStripUserMessageEcho,
}));

vi.mock('../utils/thinkingExtraction.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/thinkingExtraction.js')>();
  return {
    // Real, not mocked: `wrapperTagUnwrap` (reached through the processor, not
    // stubbed here) derives its exclusion set from this vocabulary at module
    // load, so a stubbed-out constant would crash the import.
    KNOWN_THINKING_TAGS: actual.KNOWN_THINKING_TAGS,
    extractThinkingBlocks: mockExtractThinkingBlocks,
    extractApiReasoningContent: mockExtractApiReasoningContent,
    mergeThinkingContent: mockMergeThinkingContent,
  };
});

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: mockReplacePromptPlaceholders,
}));

describe('ResponsePostProcessor', () => {
  let processor: ResponsePostProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new ResponsePostProcessor();

    // Default mock implementations
    mockRemoveDuplicateResponse.mockImplementation((content: string) => content);
    mockStripResponseArtifacts.mockImplementation((content: string) => content);
    mockStripUserMessageEcho.mockImplementation((content: string) => content);
    mockExtractThinkingBlocks.mockReturnValue({ thinkingContent: null, visibleContent: '' });
    mockExtractApiReasoningContent.mockReturnValue(null);
    mockMergeThinkingContent.mockReturnValue(null);
    mockReplacePromptPlaceholders.mockImplementation((content: string) => content);
  });

  describe('extractApiReasoning', () => {
    it('should extract reasoning from additional_kwargs.reasoning (primary source)', () => {
      const additionalKwargs = { reasoning: 'API-level reasoning content' };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBe('API-level reasoning content');
      // Should not call fallback
      expect(mockExtractApiReasoningContent).not.toHaveBeenCalled();
    });

    it('should fall back to reasoning_details when additional_kwargs.reasoning is missing', () => {
      mockExtractApiReasoningContent.mockReturnValue('Fallback reasoning');
      const responseMetadata = { reasoning_details: [{ type: 'thinking', text: 'step1' }] };

      const result = processor.extractApiReasoning(undefined, responseMetadata);

      expect(result).toBe('Fallback reasoning');
      expect(mockExtractApiReasoningContent).toHaveBeenCalledWith([
        { type: 'thinking', text: 'step1' },
      ]);
    });

    it('should return null when no reasoning is available', () => {
      mockExtractApiReasoningContent.mockReturnValue(null);

      const result = processor.extractApiReasoning(undefined, undefined);

      expect(result).toBeNull();
    });

    it('should ignore empty reasoning string', () => {
      mockExtractApiReasoningContent.mockReturnValue('Fallback');
      const additionalKwargs = { reasoning: '' };

      const result = processor.extractApiReasoning(additionalKwargs, { reasoning_details: [] });

      expect(result).toBe('Fallback');
    });

    it('should ignore non-string reasoning values', () => {
      mockExtractApiReasoningContent.mockReturnValue(null);
      const additionalKwargs = { reasoning: 123 as unknown as string };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBeNull();
    });

    it('should extract reasoning from additional_kwargs.reasoning_content (z.ai convention)', () => {
      // z.ai's chat-completion API returns reasoning under the snake_case
      // `reasoning_content` field (not OpenRouter's `reasoning`). For a z.ai-
      // direct request, this is the only source — the OpenRouter `reasoning`
      // field is absent.
      const additionalKwargs = { reasoning_content: 'GLM thinking trace' };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBe('GLM thinking trace');
      // Should not call the reasoning_details fallback
      expect(mockExtractApiReasoningContent).not.toHaveBeenCalled();
    });

    it('should prefer reasoning over reasoning_content when both are set', () => {
      // Defensive: if a future provider sets both fields, prefer the
      // OpenRouter convention to keep existing behavior unchanged.
      const additionalKwargs = {
        reasoning: 'OpenRouter trace',
        reasoning_content: 'z.ai trace',
      };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBe('OpenRouter trace');
    });

    it('should fall back from empty reasoning to reasoning_content', () => {
      // If `reasoning` is present but empty, skip past it to `reasoning_content`
      // before falling all the way through to reasoning_details.
      const additionalKwargs = { reasoning: '', reasoning_content: 'z.ai backup' };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBe('z.ai backup');
    });

    it('should ignore non-string reasoning_content values', () => {
      mockExtractApiReasoningContent.mockReturnValue(null);
      const additionalKwargs = {
        reasoning_content: { nested: 'value' } as unknown as string,
      };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBeNull();
      // Explicit fallthrough check: when reasoning_content fails the typeof
      // guard, we should reach the third source (reasoning_details) — not
      // just return null from somewhere upstream.
      expect(mockExtractApiReasoningContent).toHaveBeenCalled();
    });
  });

  describe('processThinkingContent', () => {
    it('should extract inline thinking and merge with API reasoning', () => {
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'Inline thinking',
        visibleContent: 'Visible response',
      });
      mockMergeThinkingContent.mockReturnValue('Merged: API + Inline');

      const result = processor.processThinkingContent('raw content', 'API reasoning');

      expect(result.visibleContent).toBe('Visible response');
      expect(result.thinkingContent).toBe('Merged: API + Inline');
      expect(mockMergeThinkingContent).toHaveBeenCalledWith('API reasoning', 'Inline thinking');
    });

    it('should return empty visible content when model only produces thinking', () => {
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'Only thinking, no response',
        visibleContent: '   ',
      });
      mockMergeThinkingContent.mockReturnValue('Only thinking, no response');

      const result = processor.processThinkingContent('raw', null);

      expect(result.visibleContent).toBe('   ');
      expect(result.thinkingContent).toBe('Only thinking, no response');
    });

    it('should handle content with no thinking', () => {
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'Just a normal response',
      });
      mockMergeThinkingContent.mockReturnValue(null);

      const result = processor.processThinkingContent('Just a normal response', null);

      expect(result.visibleContent).toBe('Just a normal response');
      expect(result.thinkingContent).toBeNull();
    });
  });

  describe('processResponse', () => {
    const defaultContext = {
      personalityName: 'TestBot',
      userName: 'TestUser',
      discordUsername: 'testuser#1234',
    };

    it('should run full processing pipeline in order', () => {
      // Set up mock chain - return same content to indicate no deduplication
      mockRemoveDuplicateResponse.mockReturnValue('raw content');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'raw content',
      });
      mockMergeThinkingContent.mockReturnValue(null);
      mockStripResponseArtifacts.mockReturnValue('stripped');
      mockStripUserMessageEcho.mockReturnValue('echo-stripped');
      mockReplacePromptPlaceholders.mockReturnValue('final content');

      const result = processor.processResponse('raw content', undefined, undefined, defaultContext);

      expect(result.cleanedContent).toBe('final content');
      expect(result.thinkingContent).toBeNull();
      expect(result.wasDeduplicated).toBe(false);
      expect(result.onlyThinkingProduced).toBe(false);

      // Verify order of operations — echo strip runs between artifact strip and placeholder replace
      expect(mockRemoveDuplicateResponse).toHaveBeenCalledWith('raw content');
      expect(mockStripResponseArtifacts).toHaveBeenCalledWith('raw content', 'TestBot');
      expect(mockStripUserMessageEcho).toHaveBeenCalledWith('stripped', undefined, 'TestBot');
      expect(mockReplacePromptPlaceholders).toHaveBeenCalledWith(
        'echo-stripped',
        'TestUser',
        'TestBot',
        'testuser#1234'
      );
    });

    it('should thread context.userMessage through to stripUserMessageEcho', () => {
      mockRemoveDuplicateResponse.mockReturnValue('raw');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'raw',
      });
      mockStripResponseArtifacts.mockReturnValue('stripped');
      mockStripUserMessageEcho.mockReturnValue('echo-stripped');
      mockReplacePromptPlaceholders.mockReturnValue('final');

      const userMessage = 'hello there, I have a question for you';
      processor.processResponse('raw', undefined, undefined, {
        ...defaultContext,
        userMessage,
      });

      expect(mockStripUserMessageEcho).toHaveBeenCalledWith('stripped', userMessage, 'TestBot');
    });

    it('should detect when deduplication was applied', () => {
      mockRemoveDuplicateResponse.mockReturnValue('shortened content');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'shortened content',
      });

      const result = processor.processResponse(
        'original longer content',
        undefined,
        undefined,
        defaultContext
      );

      expect(result.wasDeduplicated).toBe(true);
    });

    it('should extract API reasoning when present', () => {
      const additionalKwargs = { reasoning: 'API thinking' };

      mockRemoveDuplicateResponse.mockReturnValue('content');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'content',
      });
      mockMergeThinkingContent.mockReturnValue('API thinking');
      mockStripResponseArtifacts.mockReturnValue('content');
      mockReplacePromptPlaceholders.mockReturnValue('content');

      const result = processor.processResponse(
        'content',
        additionalKwargs,
        undefined,
        defaultContext
      );

      expect(result.thinkingContent).toBe('API thinking');
    });

    it('should handle response with both API and inline thinking', () => {
      const additionalKwargs = { reasoning: 'API level' };

      mockRemoveDuplicateResponse.mockReturnValue('<think>Inline</think>Response');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'Inline',
        visibleContent: 'Response',
      });
      mockMergeThinkingContent.mockReturnValue('API level\n\n---\n\nInline');
      mockStripResponseArtifacts.mockReturnValue('Response');
      mockReplacePromptPlaceholders.mockReturnValue('Response');

      const result = processor.processResponse(
        '<think>Inline</think>Response',
        additionalKwargs,
        undefined,
        defaultContext
      );

      expect(result.thinkingContent).toBe('API level\n\n---\n\nInline');
      expect(result.cleanedContent).toBe('Response');
    });
  });

  describe('processResponse wrapper-tag unwrap (seam)', () => {
    // Every other test in this file mocks the pipeline's collaborators, which
    // is exactly what cannot catch this bug: the failure lives in the ORDER of
    // two real passes. `stripResponseArtifacts` carries a generic
    // trailing-closing-tag pattern that eats a reply-final `</action>` and
    // leaves the opener behind, so the unwrap has to reach the pair first.
    // These cases therefore run the real chain end-to-end.
    beforeEach(async () => {
      const [dedup, thinking, artifacts, placeholders] = await Promise.all([
        vi.importActual<typeof import('../utils/duplicateDetection.js')>(
          '../utils/duplicateDetection.js'
        ),
        vi.importActual<typeof import('../utils/thinkingExtraction.js')>(
          '../utils/thinkingExtraction.js'
        ),
        vi.importActual<typeof import('../utils/responseArtifacts.js')>(
          '../utils/responseArtifacts.js'
        ),
        vi.importActual<typeof import('../utils/promptPlaceholders.js')>(
          '../utils/promptPlaceholders.js'
        ),
      ]);

      mockRemoveDuplicateResponse.mockImplementation(dedup.removeDuplicateResponse);
      mockExtractThinkingBlocks.mockImplementation(thinking.extractThinkingBlocks);
      mockExtractApiReasoningContent.mockImplementation(thinking.extractApiReasoningContent);
      mockMergeThinkingContent.mockImplementation(thinking.mergeThinkingContent);
      mockStripResponseArtifacts.mockImplementation(artifacts.stripResponseArtifacts);
      mockStripUserMessageEcho.mockImplementation(artifacts.stripUserMessageEcho);
      mockReplacePromptPlaceholders.mockImplementation(placeholders.replacePromptPlaceholders);
    });

    const seamContext = {
      personalityName: 'Lilith',
      userName: 'Lila',
    };

    it('delivers the unwrapped text for a reply-final wrapped stage direction', () => {
      // The production shape: dialogue lines plus a stage direction the model
      // wrapped in invented markup, with the closing tag last in the message.
      const raw = [
        '"You should not be here."',
        '<action>She steps back into the shadows.</action>',
      ].join('\n');

      const result = processor.processResponse(raw, undefined, undefined, seamContext);

      expect(result.cleanedContent).toBe(
        '"You should not be here."\nShe steps back into the shadows.'
      );
      // The orphan-opener assertion is the regression: if the artifact pass ran
      // first it would strip the trailing `</action>` and leave `<action>`.
      expect(result.cleanedContent).not.toContain('<action>');
      expect(result.cleanedContent).not.toContain('</action>');
    });

    it('delivers the unwrapped text for a mid-reply wrapped stage direction', () => {
      const raw = [
        '"You should not be here."',
        '<action>She steps back into the shadows.</action>',
        '"Go home, Lila."',
      ].join('\n');

      const result = processor.processResponse(raw, undefined, undefined, seamContext);

      expect(result.cleanedContent).toBe(
        '"You should not be here."\nShe steps back into the shadows.\n"Go home, Lila."'
      );
      expect(result.cleanedContent).not.toContain('action>');
    });

    it('leaves an inline wrapped stage direction byte-identical rather than orphaning its opener', () => {
      // The residual shape the unwrap DECLINES by design: the pair shares a line
      // with other text, so it is indistinguishable from prose that mentions
      // markup. Declining is only safe if the next pass leaves it alone too —
      // the artifact pass's generic trailing-closer strip used to delete the
      // reply-final `</action>` and ship the orphaned `<action>` to the reader.
      const raw = '"You should not be here." <action>She steps back into the shadows.</action>';

      const result = processor.processResponse(raw, undefined, undefined, seamContext);

      expect(result.cleanedContent).toBe(raw);
    });

    it('delivers the unwrapped text for a multi-line wrapped block mid-reply', () => {
      // The span shape: delimiters on their own lines around a block. Neither
      // the whole-message mode (content does not start with the tag) nor the
      // line mode (the opener's line has no closer) reaches it, so before the
      // span mode existed both literal tags shipped to the reader.
      const raw = [
        '"Dialogue here."',
        '',
        '<action>',
        'She walks to the window, pauses, and looks out at the rain falling',
        'gently on the street below.',
        '</action>',
        '',
        '"More dialogue."',
      ].join('\n');

      const result = processor.processResponse(raw, undefined, undefined, seamContext);

      expect(result.cleanedContent).toBe(
        [
          '"Dialogue here."',
          '',
          'She walks to the window, pauses, and looks out at the rain falling',
          'gently on the street below.',
          '',
          '"More dialogue."',
        ].join('\n')
      );
      expect(result.cleanedContent).not.toContain('action>');
    });

    it('leaves a reply that merely discusses the markup byte-identical', () => {
      const raw = [
        '"It kept doing it," she says. "Sticking <action>walks away</action> into the',
        'middle of a sentence like the tag was part of the prose."',
      ].join('\n');

      const result = processor.processResponse(raw, undefined, undefined, seamContext);

      expect(result.cleanedContent).toBe(raw);
    });
  });

  describe('looksLikeLeakedThinking', () => {
    it('should detect analytical content without dialogue', () => {
      const content = `The user is asking about their day.
I should consider the character voice carefully.
Key elements: maintain the persona's tone.
Check against constraints: no breaking character.`;

      expect(looksLikeLeakedThinking(content)).toBe(true);
    });

    it('should NOT flag content with dialogue markers (quotes)', () => {
      const content = `"Hello there!" she said with a warm smile.
The user seems curious about the weather.
I should keep the conversation light.`;

      expect(looksLikeLeakedThinking(content)).toBe(false);
    });

    it('should NOT flag content with roleplay asterisks', () => {
      const content = `*waves enthusiastically*
The user seems curious.
I need to maintain character.`;

      expect(looksLikeLeakedThinking(content)).toBe(false);
    });

    it('should NOT flag content with only one analytical marker', () => {
      const content = `The user is asking about something interesting.
This is a normal response with some analysis but mostly narrative content.`;

      expect(looksLikeLeakedThinking(content)).toBe(false);
    });

    it('should NOT flag normal conversational content', () => {
      expect(looksLikeLeakedThinking('Hey, how are you doing today?')).toBe(false);
      expect(looksLikeLeakedThinking('The weather is quite nice outside.')).toBe(false);
    });
  });

  describe('processResponse glitch detection', () => {
    const reasoningContext = {
      personalityName: 'TestBot',
      userName: 'TestUser',
      reasoningEnabled: true,
    };

    it('should set onlyThinkingProduced when leaked thinking is detected', () => {
      const leakedContent = `The user is asking about their day.
I should maintain character voice.
Key elements: stay in persona.
Check against constraints: avoid breaking character.`;

      mockRemoveDuplicateResponse.mockReturnValue(leakedContent);
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: leakedContent,
      });
      mockMergeThinkingContent.mockReturnValue(null);
      mockStripResponseArtifacts.mockReturnValue(leakedContent);
      mockReplacePromptPlaceholders.mockReturnValue(leakedContent);

      const result = processor.processResponse(
        leakedContent,
        undefined,
        undefined,
        reasoningContext
      );

      expect(result.onlyThinkingProduced).toBe(true);
    });

    it('should NOT set onlyThinkingProduced when reasoning is not enabled', () => {
      const leakedContent = `The user is asking about their day.
I should maintain character voice.
Key elements: stay in persona.`;

      mockRemoveDuplicateResponse.mockReturnValue(leakedContent);
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: leakedContent,
      });
      mockMergeThinkingContent.mockReturnValue(null);
      mockStripResponseArtifacts.mockReturnValue(leakedContent);
      mockReplacePromptPlaceholders.mockReturnValue(leakedContent);

      const result = processor.processResponse(leakedContent, undefined, undefined, {
        personalityName: 'TestBot',
        userName: 'TestUser',
        // reasoningEnabled not set
      });

      expect(result.onlyThinkingProduced).toBe(false);
    });

    it('should NOT set onlyThinkingProduced when thinking was properly extracted', () => {
      mockRemoveDuplicateResponse.mockReturnValue('<think>analysis</think>Normal response');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'analysis',
        visibleContent: 'Normal response',
      });
      mockMergeThinkingContent.mockReturnValue('analysis');
      mockStripResponseArtifacts.mockReturnValue('Normal response');
      mockReplacePromptPlaceholders.mockReturnValue('Normal response');

      const result = processor.processResponse(
        '<think>analysis</think>Normal response',
        undefined,
        undefined,
        reasoningContext
      );

      expect(result.onlyThinkingProduced).toBe(false);
    });
  });

  describe('processResponse reasoning-engagement telemetry', () => {
    const reasoningContext = {
      personalityName: 'TestBot',
      userName: 'TestUser',
      reasoningEnabled: true,
    };

    it('does not emit reasoning-telemetry log when reasoning was NOT requested', () => {
      mockRemoveDuplicateResponse.mockReturnValue('Normal response');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'Normal response',
      });
      mockStripResponseArtifacts.mockReturnValue('Normal response');
      mockReplacePromptPlaceholders.mockReturnValue('Normal response');

      processor.processResponse('Normal response', undefined, undefined, {
        personalityName: 'TestBot',
        userName: 'TestUser',
      });

      // Neither path should have emitted the reasoning-engagement telemetry
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Reasoning mode')
      );
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Reasoning mode')
      );
    });

    it('emits info when reasoning requested AND actually engaged', () => {
      mockRemoveDuplicateResponse.mockReturnValue('Normal response');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'actual reasoning content',
        visibleContent: 'Normal response',
      });
      mockMergeThinkingContent.mockReturnValue('actual reasoning content');
      mockStripResponseArtifacts.mockReturnValue('Normal response');
      mockReplacePromptPlaceholders.mockReturnValue('Normal response');

      processor.processResponse('Normal response', undefined, undefined, reasoningContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoningRequested: true,
          reasoningActuallyEngaged: true,
          personalityName: 'TestBot',
        }),
        expect.stringContaining('engaged as requested')
      );
    });

    it('emits warn when reasoning requested but did NOT engage', () => {
      mockRemoveDuplicateResponse.mockReturnValue('Normal response');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'Normal response',
      });
      mockMergeThinkingContent.mockReturnValue(null);
      mockStripResponseArtifacts.mockReturnValue('Normal response');
      mockReplacePromptPlaceholders.mockReturnValue('Normal response');

      processor.processResponse('Normal response', undefined, undefined, reasoningContext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoningRequested: true,
          reasoningActuallyEngaged: false,
          personalityName: 'TestBot',
        }),
        expect.stringContaining('did NOT engage')
      );
    });
  });
});
