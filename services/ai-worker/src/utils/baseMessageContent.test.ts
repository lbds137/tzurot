import { describe, it, expect } from 'vitest';
import { contentToText } from './baseMessageContent.js';

describe('contentToText', () => {
  it('passes string content through unchanged', () => {
    expect(contentToText('hello world')).toBe('hello world');
    expect(contentToText('')).toBe('');
  });

  it('extracts text parts from array-form content', () => {
    expect(
      contentToText([
        { type: 'text', text: 'first part' },
        { type: 'text', text: 'second part' },
      ])
    ).toBe('first part\nsecond part');
  });

  it('handles mixed string and object elements in array content', () => {
    // The current LangChain type doesn't admit bare strings as array elements,
    // but older serializations produce them at runtime — the helper's string
    // branch is deliberately defensive, so this test must cast past the type.
    const mixed = [
      'plain string part',
      { type: 'text', text: 'object part' },
    ] as unknown as Parameters<typeof contentToText>[0];
    expect(contentToText(mixed)).toBe('plain string part\nobject part');
  });

  it('skips non-text parts (image blocks contribute no countable text)', () => {
    expect(
      contentToText([
        { type: 'text', text: 'describe this image' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ])
    ).toBe('describe this image');
  });

  it('excludes thinking blocks (no text property) — the rawContent contract', () => {
    const parts = [
      { type: 'thinking', thinking: 'internal reasoning' },
      { type: 'text', text: 'final answer' },
    ] as unknown as Parameters<typeof contentToText>[0];
    const result = contentToText(parts);
    expect(result).toBe('final answer');
    expect(result).not.toContain('internal reasoning');
  });

  it('returns empty string for content with no text parts', () => {
    expect(contentToText([{ type: 'image_url', image_url: { url: 'https://x/y.png' } }])).toBe('');
    expect(contentToText([])).toBe('');
  });

  it('never produces [object Object] (the silent-cast failure mode)', () => {
    const result = contentToText([{ type: 'text', text: 'real text' }]);
    expect(result).not.toContain('[object Object]');
    expect(result).toBe('real text');
  });
});
