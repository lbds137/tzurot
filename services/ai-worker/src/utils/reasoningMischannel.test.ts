/**
 * Tests for the suspect reasoning mis-channel predicate.
 */

import { describe, it, expect } from 'vitest';
import { isSuspectReasoningMischannel } from './reasoningMischannel.js';

const glm = (contentLength: number, reasoningLength: number): boolean =>
  isSuspectReasoningMischannel({ modelName: 'glm-4.5-air', contentLength, reasoningLength });

describe('isSuspectReasoningMischannel', () => {
  it('matches the observed mis-channel shape (short content, reasoning dwarfs it)', () => {
    // The incident row: content 68 chars, reasoning_content 2,263 chars
    expect(glm(68, 2263)).toBe(true);
  });

  it('matches empty visible content with substantial reasoning', () => {
    expect(glm(0, 600)).toBe(true);
  });

  it('does not match a normal-length reply with long reasoning', () => {
    expect(glm(900, 2700)).toBe(false);
  });

  it('does not match short content with short reasoning', () => {
    expect(glm(68, 400)).toBe(false);
  });

  it('does not match short content when reasoning is under the ratio floor', () => {
    expect(glm(250, 600)).toBe(false);
  });

  it('excludes content at exactly the 300-char boundary (strict <)', () => {
    expect(glm(300, 2000)).toBe(false);
    expect(glm(299, 2000)).toBe(true);
  });

  it('excludes reasoning at exactly the 500-char boundary (strict >)', () => {
    expect(glm(100, 500)).toBe(false);
    expect(glm(100, 501)).toBe(true);
  });

  it('includes the exact 3x ratio boundary (inclusive >=)', () => {
    expect(glm(200, 600)).toBe(true);
    expect(glm(200, 599)).toBe(false);
  });

  it('does not match models outside the observed family, even on the incident shape', () => {
    // Mandatory-reasoning models emit huge reasoning with short replies as
    // their normal shape — the signature is only suspect for the GLM family.
    for (const model of ['deepseek/deepseek-r1', 'openai/gpt-oss-120b', 'stepfun/step-3.5']) {
      expect(
        isSuspectReasoningMischannel({ modelName: model, contentLength: 68, reasoningLength: 2263 })
      ).toBe(false);
    }
  });

  it('matches GLM-family model ids regardless of provider prefix or casing', () => {
    expect(
      isSuspectReasoningMischannel({
        modelName: 'z-ai/GLM-5.2',
        contentLength: 68,
        reasoningLength: 2263,
      })
    ).toBe(true);
  });

  it('does not match when modelName is absent (unattributable)', () => {
    expect(
      isSuspectReasoningMischannel({
        modelName: undefined,
        contentLength: 68,
        reasoningLength: 2263,
      })
    ).toBe(false);
  });
});
