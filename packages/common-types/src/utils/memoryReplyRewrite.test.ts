import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_SEPARATOR_DISPLAY,
  replyFitsExchangeTemplate,
  rewriteReplyInExchangeText,
} from './memoryReplyRewrite.js';

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

  it('returns null for text outside the template', () => {
    expect(rewriteReplyInExchangeText('not a memory', 'new')).toBeNull();
  });

  it('returns null when the new reply carries the separator', () => {
    expect(
      rewriteReplyInExchangeText('{user}: hi\n{assistant}: old', 'a\n{assistant}: b')
    ).toBeNull();
  });
});

describe('replyFitsExchangeTemplate', () => {
  it('accepts ordinary text', () => {
    expect(replyFitsExchangeTemplate('plain reply')).toBe(true);
  });

  it('rejects text containing the assistant separator', () => {
    expect(replyFitsExchangeTemplate('x\n{assistant}: y')).toBe(false);
  });

  it('shows the separator without the template newline', () => {
    expect(ASSISTANT_SEPARATOR_DISPLAY).toBe('{assistant}:');
  });
});
