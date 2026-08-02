/**
 * Tests for Reasoning Model Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  detectReasoningModelType,
  isReasoningModel,
  ReasoningModelType,
} from './reasoningModelUtils.js';

describe('ReasoningModelUtils', () => {
  describe('detectReasoningModelType', () => {
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

    describe('GPT-OSS detection', () => {
      it('should detect GPT-OSS models', () => {
        expect(detectReasoningModelType('openai/gpt-oss-120b:free')).toBe(
          ReasoningModelType.GptOss
        );
        expect(detectReasoningModelType('gpt-oss-120b')).toBe(ReasoningModelType.GptOss);
      });
    });

    describe('StepFun detection', () => {
      it('should detect StepFun Step 3.5 models', () => {
        expect(detectReasoningModelType('stepfun/step-3.5-flash:free')).toBe(
          ReasoningModelType.StepFun
        );
        expect(detectReasoningModelType('step-3.5-flash')).toBe(ReasoningModelType.StepFun);
      });
    });

    describe('Hermes 4 detection', () => {
      it('should detect Hermes 4 models', () => {
        expect(detectReasoningModelType('nousresearch/hermes-4-70b')).toBe(
          ReasoningModelType.Hermes4
        );
        expect(detectReasoningModelType('hermes-4-70b')).toBe(ReasoningModelType.Hermes4);
      });

      it('should NOT detect Hermes 3 models', () => {
        expect(detectReasoningModelType('nousresearch/hermes-3-llama-3.1-405b:free')).toBe(
          ReasoningModelType.Standard
        );
      });
    });

    describe('MiMo detection', () => {
      it('should detect MiMo v2 models', () => {
        expect(detectReasoningModelType('xiaomi/mimo-v2-flash')).toBe(ReasoningModelType.MiMo);
        expect(detectReasoningModelType('mimo-v2-flash')).toBe(ReasoningModelType.MiMo);
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

  describe('isReasoningModel', () => {
    it('should return true for reasoning models', () => {
      expect(isReasoningModel('claude-3-7-sonnet')).toBe(true);
      expect(isReasoningModel('gemini-2.0-flash-thinking')).toBe(true);
    });

    it('should return true for new thinking models', () => {
      expect(isReasoningModel('deepseek/deepseek-r1')).toBe(true);
      expect(isReasoningModel('qwen/qwq-32b')).toBe(true);
      expect(isReasoningModel('glm-4.7')).toBe(true);
      expect(isReasoningModel('kimi-k2')).toBe(true);
      expect(isReasoningModel('openai/gpt-oss-120b:free')).toBe(true);
      expect(isReasoningModel('stepfun/step-3.5-flash:free')).toBe(true);
      expect(isReasoningModel('nousresearch/hermes-4-70b')).toBe(true);
      expect(isReasoningModel('xiaomi/mimo-v2-flash')).toBe(true);
    });

    it('should return false for standard models', () => {
      expect(isReasoningModel('gpt-4')).toBe(false);
      expect(isReasoningModel('claude-3-5-sonnet')).toBe(false);
      expect(isReasoningModel('gemini-2.0-flash')).toBe(false);
      expect(isReasoningModel('deepseek/deepseek-chat')).toBe(false);
    });

    it('should return false for the deprecated OpenAI o-series (pattern deleted)', () => {
      // The o-series is fully deprecated upstream; its detection pattern and the
      // system-message transform it gated were removed. Names like these now
      // detect as Standard, which is correct for models that no longer exist.
      expect(isReasoningModel('o1')).toBe(false);
      expect(isReasoningModel('openai/o1-preview')).toBe(false);
      expect(isReasoningModel('o3-mini')).toBe(false);
    });
  });
});
