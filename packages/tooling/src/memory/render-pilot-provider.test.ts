import { describe, it, expect } from 'vitest';
import { AI_ENDPOINTS } from '@tzurot/common-types/constants/ai';
import {
  providerEnvVar,
  providerUrl,
  providerHeaders,
  providerModelId,
  thinkingBody,
} from './render-pilot-provider.js';

describe('providerEnvVar', () => {
  it('names OPENROUTER_API_KEY for openrouter', () => {
    expect(providerEnvVar('openrouter')).toBe('OPENROUTER_API_KEY');
  });

  it('names ZAI_CODING_API_KEY for zai-coding', () => {
    expect(providerEnvVar('zai-coding')).toBe('ZAI_CODING_API_KEY');
  });
});

describe('providerUrl', () => {
  it('routes openrouter to the OpenRouter chat-completions URL', () => {
    expect(providerUrl('openrouter')).toBe(`${AI_ENDPOINTS.OPENROUTER_BASE_URL}/chat/completions`);
  });

  it('routes zai-coding to the coding-plan chat-completions URL', () => {
    expect(providerUrl('zai-coding')).toBe(`${AI_ENDPOINTS.ZAI_CODING_BASE_URL}/chat/completions`);
  });
});

describe('providerHeaders', () => {
  it('keeps all four OpenRouter headers, including HTTP-Referer and X-Title', () => {
    const headers = providerHeaders('openrouter', 'sk-test');
    expect(headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/lbds137/tzurot',
      'X-Title': 'tzurot render pilot',
    });
  });

  it('sends only Authorization + Content-Type for zai-coding, omitting HTTP-Referer/X-Title', () => {
    const headers = providerHeaders('zai-coding', 'sk-test');
    expect(headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    });
    expect(headers).not.toHaveProperty('HTTP-Referer');
    expect(headers).not.toHaveProperty('X-Title');
  });
});

describe('providerModelId', () => {
  it('leaves the model id unchanged for openrouter, prefix and all', () => {
    expect(providerModelId('openrouter', 'z-ai/glm-5.3')).toBe('z-ai/glm-5.3');
  });

  it('strips the z-ai/ prefix for zai-coding', () => {
    expect(providerModelId('zai-coding', 'z-ai/glm-5.3')).toBe('glm-5.3');
  });

  it('leaves an already-bare id unchanged for zai-coding', () => {
    expect(providerModelId('zai-coding', 'glm-5.3')).toBe('glm-5.3');
  });

  // Case-preservation: toZaiWireModelId slices off the ORIGINAL string, not a
  // lowercased copy — a wrong wire-sent id would be z.ai's 400 "modelCode:
  // does not exist" this behavior exists to avoid.
  it('preserves case in the bare id for zai-coding', () => {
    expect(providerModelId('zai-coding', 'Z-AI/GLM-5.3')).toBe('GLM-5.3');
  });
});

describe('thinkingBody', () => {
  it('sends an empty fragment for openrouter regardless of the thinking setting', () => {
    expect(thinkingBody('openrouter', 'disabled')).toEqual({});
    expect(thinkingBody('openrouter', 'high')).toEqual({});
    expect(thinkingBody('openrouter', undefined)).toEqual({});
  });

  it('sends an empty fragment for zai-coding when thinking is omitted', () => {
    expect(thinkingBody('zai-coding', undefined)).toEqual({});
  });

  it('sends an explicit disable for zai-coding "disabled"', () => {
    expect(thinkingBody('zai-coding', 'disabled')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('sends enabled + high reasoning_effort for zai-coding "high"', () => {
    expect(thinkingBody('zai-coding', 'high')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
  });
});
