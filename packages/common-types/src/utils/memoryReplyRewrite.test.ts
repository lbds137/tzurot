import { describe, expect, it } from 'vitest';
import { rewriteReplyInExchangeText } from './memoryReplyRewrite.js';

describe('rewriteReplyInExchangeText', () => {
  it('replaces the assistant half', () => {
    expect(rewriteReplyInExchangeText('{user}: hi\n{assistant}: old', 'new')).toBe(
      '{user}: hi\n{assistant}: new'
    );
  });

  it('keeps the trailing referenced block', () => {
    const text = '{user}: hi\n{assistant}: old\n\n[Referenced content: ref]';
    expect(rewriteReplyInExchangeText(text, 'new')).toBe(
      '{user}: hi\n{assistant}: new\n\n[Referenced content: ref]'
    );
  });

  it('rewrites a user-part-block exchange when the new reply ends in a bracket', () => {
    const text = '{user}: hi\n\n[Referenced content: a quote]\n{assistant}: old reply';
    expect(rewriteReplyInExchangeText(text, '*smiles* [waves]')).toBe(
      '{user}: hi\n\n[Referenced content: a quote]\n{assistant}: *smiles* [waves]'
    );
  });

  it('returns null for text outside the template', () => {
    expect(rewriteReplyInExchangeText('not a memory', 'new')).toBeNull();
  });

  it('returns null when the new reply carries the separator', () => {
    expect(
      rewriteReplyInExchangeText('{user}: hi\n{assistant}: old', 'a\n{assistant}: b')
    ).toBeNull();
  });
});
