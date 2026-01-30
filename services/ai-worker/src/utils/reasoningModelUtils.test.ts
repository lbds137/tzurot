/**
 * Tests for Reasoning Model Utilities
 */

import { describe, it, expect, vi } from 'vitest';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  detectReasoningModelType,
  getReasoningModelConfig,
  isReasoningModel,
  transformMessagesForReasoningModel,
  stripThinkingTags,
  processReasoningModelOutput,
  ReasoningModelType,
} from './reasoningModelUtils.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('ReasoningModelUtils', () => {
  describe('detectReasoningModelType', () => {
    describe('OpenAI o-series detection', () => {
      it('should detect o1 as OpenAI reasoning model', () => {
        expect(detectReasoningModelType('o1')).toBe(ReasoningModelType.OpenAIReasoning);
        expect(detectReasoningModelType('openai/o1')).toBe(ReasoningModelType.OpenAIReasoning);
      });

      it('should detect o1-preview as OpenAI reasoning model', () => {
        expect(detectReasoningModelType('o1-preview')).toBe(ReasoningModelType.OpenAIReasoning);
        expect(detectReasoningModelType('openai/o1-preview')).toBe(
          ReasoningModelType.OpenAIReasoning
        );
      });

      it('should detect o1-mini as OpenAI reasoning model', () => {
        expect(detectReasoningModelType('o1-mini')).toBe(ReasoningModelType.OpenAIReasoning);
        expect(detectReasoningModelType('openai/o1-mini')).toBe(ReasoningModelType.OpenAIReasoning);
      });

      it('should detect o3 as OpenAI reasoning model', () => {
        expect(detectReasoningModelType('o3')).toBe(ReasoningModelType.OpenAIReasoning);
        expect(detectReasoningModelType('openai/o3')).toBe(ReasoningModelType.OpenAIReasoning);
      });

      it('should detect o3-mini as OpenAI reasoning model', () => {
        expect(detectReasoningModelType('o3-mini')).toBe(ReasoningModelType.OpenAIReasoning);
      });

      it('should handle date suffixes', () => {
        expect(detectReasoningModelType('o1-2024')).toBe(ReasoningModelType.OpenAIReasoning);
      });
    });

    describe('Claude extended thinking detection', () => {
      it('should detect Claude 3.7 as extended thinking model', () => {
        expect(detectReasoningModelType('claude-3-7-sonnet')).toBe(
          ReasoningModelType.ClaudeExtendedThinking
        );
        expect(detectReasoningModelType('anthropic/claude-3-7-sonnet-20250219')).toBe(
          ReasoningModelType.ClaudeExtendedThinking
        );
      });

      it('should detect Claude 3.8, 3.9 as extended thinking models', () => {
        expect(detectReasoningModelType('claude-3-8-opus')).toBe(
          ReasoningModelType.ClaudeExtendedThinking
        );
        expect(detectReasoningModelType('claude-3-9-haiku')).toBe(
          ReasoningModelType.ClaudeExtendedThinking
        );
      });

      it('should detect Claude 4 as extended thinking model', () => {
        expect(detectReasoningModelType('claude-4')).toBe(
          ReasoningModelType.ClaudeExtendedThinking
        );
        expect(detectReasoningModelType('anthropic/claude-4-opus')).toBe(
          ReasoningModelType.ClaudeExtendedThinking
        );
      });

      it('should NOT detect Claude 3.5 as extended thinking', () => {
        expect(detectReasoningModelType('claude-3-5-sonnet')).toBe(ReasoningModelType.Standard);
        expect(detectReasoningModelType('anthropic/claude-3-5-sonnet-20241022')).toBe(
          ReasoningModelType.Standard
        );
      });
    });

    describe('Gemini thinking detection', () => {
      it('should detect Gemini 2.0 Flash Thinking', () => {
        expect(detectReasoningModelType('gemini-2.0-flash-thinking')).toBe(
          ReasoningModelType.GeminiThinking
        );
        expect(detectReasoningModelType('google/gemini-2.0-flash-thinking-exp')).toBe(
          ReasoningModelType.GeminiThinking
        );
      });

      it('should NOT detect regular Gemini models', () => {
        expect(detectReasoningModelType('gemini-2.0-flash')).toBe(ReasoningModelType.Standard);
        expect(detectReasoningModelType('gemini-1.5-pro')).toBe(ReasoningModelType.Standard);
      });
    });

    describe('DeepSeek R1 detection', () => {
      it('should detect DeepSeek R1 models', () => {
        expect(detectReasoningModelType('deepseek/deepseek-r1')).toBe(
          ReasoningModelType.DeepSeekR1
        );
        expect(detectReasoningModelType('deepseek/deepseek-r1-distill-llama-70b')).toBe(
          ReasoningModelType.DeepSeekR1
        );
        expect(detectReasoningModelType('deepseek-r1')).toBe(ReasoningModelType.DeepSeekR1);
      });

      it('should detect R1T Chimera models (R1+V3 merge)', () => {
        expect(detectReasoningModelType('tngtech/tng-r1t-chimera')).toBe(
          ReasoningModelType.DeepSeekR1
        );
        expect(detectReasoningModelType('tngtech/tng-r1t-chimera:free')).toBe(
          ReasoningModelType.DeepSeekR1
        );
        expect(detectReasoningModelType('tngtech/deepseek-r1t-chimera')).toBe(
          ReasoningModelType.DeepSeekR1
        );
        expect(detectReasoningModelType('tngtech/deepseek-r1t2-chimera:free')).toBe(
          ReasoningModelType.DeepSeekR1
        );
      });

      it('should detect DeepSeek Reasoner models', () => {
        expect(detectReasoningModelType('deepseek/deepseek-reasoner')).toBe(
          ReasoningModelType.DeepSeekR1
        );
      });

      it('should NOT detect regular DeepSeek models', () => {
        expect(detectReasoningModelType('deepseek/deepseek-chat')).toBe(
          ReasoningModelType.Standard
        );
        expect(detectReasoningModelType('deepseek/deepseek-coder')).toBe(
          ReasoningModelType.Standard
        );
      });
    });

    describe('Qwen QwQ detection', () => {
      it('should detect Qwen QwQ models', () => {
        expect(detectReasoningModelType('qwen/qwq-32b')).toBe(ReasoningModelType.QwenReasoning);
        expect(detectReasoningModelType('qwen/qwen-qwq-32b-preview')).toBe(
          ReasoningModelType.QwenReasoning
        );
        expect(detectReasoningModelType('qwq-32b-preview')).toBe(ReasoningModelType.QwenReasoning);
      });

      it('should NOT detect regular Qwen models', () => {
        expect(detectReasoningModelType('qwen/qwen-2.5-72b')).toBe(ReasoningModelType.Standard);
        expect(detectReasoningModelType('qwen/qwen-2-vl')).toBe(ReasoningModelType.Standard);
      });
    });

    describe('GLM thinking detection', () => {
      it('should detect GLM-4.5+ thinking models', () => {
        expect(detectReasoningModelType('glm-4.5')).toBe(ReasoningModelType.GlmThinking);
        expect(detectReasoningModelType('glm-4.6')).toBe(ReasoningModelType.GlmThinking);
        expect(detectReasoningModelType('glm-4.7')).toBe(ReasoningModelType.GlmThinking);
        expect(detectReasoningModelType('zai/glm-4.7')).toBe(ReasoningModelType.GlmThinking);
      });

      it('should NOT detect older GLM models', () => {
        expect(detectReasoningModelType('glm-4')).toBe(ReasoningModelType.Standard);
        expect(detectReasoningModelType('glm-4.0')).toBe(ReasoningModelType.Standard);
      });
    });

    describe('Kimi thinking detection', () => {
      it('should detect Kimi K2 thinking models', () => {
        expect(detectReasoningModelType('moonshotai/kimi-k2-thinking')).toBe(
          ReasoningModelType.KimiThinking
        );
        expect(detectReasoningModelType('kimi-k2')).toBe(ReasoningModelType.KimiThinking);
      });
    });

    describe('generic thinking detection', () => {
      it('should detect models with "thinking" in name', () => {
        expect(detectReasoningModelType('some-model-thinking-v1')).toBe(
          ReasoningModelType.GenericThinking
        );
      });
    });

    describe('standard models', () => {
      it('should detect GPT-4 as standard', () => {
        expect(detectReasoningModelType('gpt-4')).toBe(ReasoningModelType.Standard);
        expect(detectReasoningModelType('openai/gpt-4-turbo')).toBe(ReasoningModelType.Standard);
      });

      it('should detect Claude 3.5 as standard', () => {
        expect(detectReasoningModelType('claude-3-5-sonnet')).toBe(ReasoningModelType.Standard);
      });

      it('should detect Gemini as standard', () => {
        expect(detectReasoningModelType('gemini-1.5-pro')).toBe(ReasoningModelType.Standard);
        expect(detectReasoningModelType('google/gemini-2.0-flash')).toBe(
          ReasoningModelType.Standard
        );
      });

      it('should detect Llama as standard', () => {
        expect(detectReasoningModelType('meta-llama/llama-3.1-70b')).toBe(
          ReasoningModelType.Standard
        );
      });
    });
  });

  describe('getReasoningModelConfig', () => {
    it('should return correct config for OpenAI o-series', () => {
      const config = getReasoningModelConfig('openai/o1');

      expect(config.type).toBe(ReasoningModelType.OpenAIReasoning);
      expect(config.allowsSystemMessage).toBe(false);
      expect(config.requiredTemperature).toBeNull();
      expect(config.useMaxCompletionTokens).toBe(true);
      expect(config.mayContainThinkingTags).toBe(true);
    });

    it('should return correct config for Claude extended thinking', () => {
      const config = getReasoningModelConfig('anthropic/claude-3-7-sonnet');

      expect(config.type).toBe(ReasoningModelType.ClaudeExtendedThinking);
      expect(config.allowsSystemMessage).toBe(true);
      expect(config.requiredTemperature).toBe(1.0);
      expect(config.useMaxCompletionTokens).toBe(false);
      expect(config.mayContainThinkingTags).toBe(true);
    });

    it('should return correct config for Gemini thinking', () => {
      const config = getReasoningModelConfig('gemini-2.0-flash-thinking');

      expect(config.type).toBe(ReasoningModelType.GeminiThinking);
      expect(config.allowsSystemMessage).toBe(true);
      expect(config.requiredTemperature).toBeNull();
      expect(config.mayContainThinkingTags).toBe(true);
    });

    it('should return standard config for regular models', () => {
      const config = getReasoningModelConfig('gpt-4-turbo');

      expect(config.type).toBe(ReasoningModelType.Standard);
      expect(config.allowsSystemMessage).toBe(true);
      expect(config.requiredTemperature).toBeNull();
      expect(config.useMaxCompletionTokens).toBe(false);
      expect(config.mayContainThinkingTags).toBe(false);
    });

    it('should return correct config for DeepSeek R1', () => {
      const config = getReasoningModelConfig('deepseek/deepseek-r1');

      expect(config.type).toBe(ReasoningModelType.DeepSeekR1);
      expect(config.allowsSystemMessage).toBe(true);
      expect(config.requiredTemperature).toBeNull();
      expect(config.mayContainThinkingTags).toBe(true);
    });

    it('should return correct config for Qwen QwQ', () => {
      const config = getReasoningModelConfig('qwen/qwq-32b');

      expect(config.type).toBe(ReasoningModelType.QwenReasoning);
      expect(config.allowsSystemMessage).toBe(true);
      expect(config.mayContainThinkingTags).toBe(true);
    });

    it('should return correct config for GLM thinking', () => {
      const config = getReasoningModelConfig('glm-4.7');

      expect(config.type).toBe(ReasoningModelType.GlmThinking);
      expect(config.allowsSystemMessage).toBe(true);
      expect(config.mayContainThinkingTags).toBe(true);
    });
  });

  describe('isReasoningModel', () => {
    it('should return true for reasoning models', () => {
      expect(isReasoningModel('o1')).toBe(true);
      expect(isReasoningModel('claude-3-7-sonnet')).toBe(true);
      expect(isReasoningModel('gemini-2.0-flash-thinking')).toBe(true);
    });

    it('should return true for new thinking models', () => {
      expect(isReasoningModel('deepseek/deepseek-r1')).toBe(true);
      expect(isReasoningModel('qwen/qwq-32b')).toBe(true);
      expect(isReasoningModel('glm-4.7')).toBe(true);
      expect(isReasoningModel('kimi-k2')).toBe(true);
    });

    it('should return false for standard models', () => {
      expect(isReasoningModel('gpt-4')).toBe(false);
      expect(isReasoningModel('claude-3-5-sonnet')).toBe(false);
      expect(isReasoningModel('gemini-2.0-flash')).toBe(false);
      expect(isReasoningModel('deepseek/deepseek-chat')).toBe(false);
    });
  });

  describe('transformMessagesForReasoningModel', () => {
    it('should not transform messages for standard models', () => {
      const messages = [
        new SystemMessage('You are a helpful assistant'),
        new HumanMessage('Hello'),
      ];

      const config = getReasoningModelConfig('gpt-4');
      const transformed = transformMessagesForReasoningModel(messages, config);

      expect(transformed).toHaveLength(2);
      expect(transformed[0]).toBeInstanceOf(SystemMessage);
    });

    it('should convert system message to human message prefix for o-series', () => {
      const messages = [
        new SystemMessage('You are a helpful assistant'),
        new HumanMessage('Hello'),
      ];

      const config = getReasoningModelConfig('o1');
      const transformed = transformMessagesForReasoningModel(messages, config);

      expect(transformed).toHaveLength(1);
      expect(transformed[0]).toBeInstanceOf(HumanMessage);
      expect(transformed[0].content).toContain('[System Instructions]');
      expect(transformed[0].content).toContain('You are a helpful assistant');
      expect(transformed[0].content).toContain('Hello');
    });

    it('should handle messages without system message', () => {
      const messages = [new HumanMessage('Hello'), new AIMessage('Hi there!')];

      const config = getReasoningModelConfig('o1');
      const transformed = transformMessagesForReasoningModel(messages, config);

      expect(transformed).toHaveLength(2);
      expect(transformed[0].content).toBe('Hello');
    });

    it('should preserve conversation history order', () => {
      const messages = [
        new SystemMessage('System'),
        new HumanMessage('User 1'),
        new AIMessage('AI 1'),
        new HumanMessage('User 2'),
      ];

      const config = getReasoningModelConfig('o1');
      const transformed = transformMessagesForReasoningModel(messages, config);

      // System merged into first human, then rest preserved
      expect(transformed).toHaveLength(3);
      expect(transformed[0]).toBeInstanceOf(HumanMessage);
      expect(transformed[0].content).toContain('[System Instructions]');
      expect(transformed[1]).toBeInstanceOf(AIMessage);
      expect(transformed[2]).toBeInstanceOf(HumanMessage);
      expect(transformed[2].content).toBe('User 2');
    });
  });

  describe('stripThinkingTags', () => {
    it('should remove <thinking> tags and their content', () => {
      const content = '<thinking>Let me think...</thinking>Here is my answer.';
      expect(stripThinkingTags(content)).toBe('Here is my answer.');
    });

    it('should handle multiline thinking content', () => {
      const content = `<thinking>
Step 1: Consider the problem
Step 2: Analyze options
Step 3: Form conclusion
</thinking>
The answer is 42.`;

      expect(stripThinkingTags(content)).toBe('The answer is 42.');
    });

    it('should handle multiple thinking blocks', () => {
      const content =
        '<thinking>First thought</thinking>Answer 1. <thinking>Second thought</thinking>Answer 2.';
      // Note: The space between Answer 1. and the second thinking block is preserved
      expect(stripThinkingTags(content)).toBe('Answer 1. Answer 2.');
    });

    it('should handle <think> variant', () => {
      const content = '<think>Some thinking</think>The answer.';
      expect(stripThinkingTags(content)).toBe('The answer.');
    });

    it('should be case insensitive', () => {
      const content = '<THINKING>Thoughts</THINKING>Answer';
      expect(stripThinkingTags(content)).toBe('Answer');
    });

    it('should handle nested content correctly', () => {
      const content =
        '<thinking>Outer <b>bold</b> text with newlines\nand more</thinking>Final answer.';
      expect(stripThinkingTags(content)).toBe('Final answer.');
    });

    it('should return original content when no thinking tags', () => {
      const content = 'Just a normal response without thinking.';
      expect(stripThinkingTags(content)).toBe('Just a normal response without thinking.');
    });

    it('should trim whitespace after stripping', () => {
      const content = '  <thinking>thoughts</thinking>  Answer  ';
      expect(stripThinkingTags(content)).toBe('Answer');
    });
  });

  describe('processReasoningModelOutput', () => {
    it('should strip thinking tags for reasoning models', () => {
      const content = '<thinking>Internal reasoning</thinking>User-facing response';
      const config = getReasoningModelConfig('o1');

      expect(processReasoningModelOutput(content, config)).toBe('User-facing response');
    });

    it('should not modify output for standard models', () => {
      const content = '<thinking>This should stay</thinking>Response';
      const config = getReasoningModelConfig('gpt-4');

      expect(processReasoningModelOutput(content, config)).toBe(content);
    });

    it('should handle Claude extended thinking output', () => {
      const content = `<thinking>
Let me consider this carefully:
1. First, I'll analyze the question
2. Then form a response
</thinking>

Based on my analysis, the answer is clear.`;

      const config = getReasoningModelConfig('claude-3-7-sonnet');
      const result = processReasoningModelOutput(content, config);

      expect(result).toBe('Based on my analysis, the answer is clear.');
    });
  });
});
