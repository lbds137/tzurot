import { describe, it, expect } from 'vitest';
import { splitMemoryContent, stripQuoteLines } from './memoryContentSplit.js';

describe('splitMemoryContent', () => {
  it('splits the stored template into user/assistant/referenced=null', () => {
    const content = '{user}: hello there\n{assistant}: hi, how are you?';
    expect(splitMemoryContent(content)).toEqual({
      user: 'hello there',
      assistant: 'hi, how are you?',
      referenced: null,
    });
  });

  it('captures a trailing referenced-content block', () => {
    const content =
      '{user}: did you see that?\n{assistant}: yes I did\n\n[Referenced content: someone posted a photo]';
    expect(splitMemoryContent(content)).toEqual({
      user: 'did you see that?',
      assistant: 'yes I did',
      referenced: 'someone posted a photo',
    });
  });

  it('handles a multi-line referenced block', () => {
    const content = '{user}: hm\n{assistant}: yeah\n\n[Referenced content: line one\nline two]';
    const result = splitMemoryContent(content);
    expect(result?.referenced).toBe('line one\nline two');
  });

  // Canary: mutating the `\n{assistant}: ` separator in splitMemoryContent must redden this test.
  it('returns null when the assistant separator is absent (template mismatch)', () => {
    expect(splitMemoryContent('{user}: hello there, no assistant turn here')).toBeNull();
  });

  it('returns null when the content does not start with the user prefix', () => {
    expect(splitMemoryContent('assistant: hi\n{assistant}: hi again')).toBeNull();
  });

  // Canary: removing the second-separator ambiguity guard must redden this test.
  it('returns null when the assistant separator occurs more than once (ambiguous split)', () => {
    expect(splitMemoryContent('{user}: hello\n{assistant}: hi\n{assistant}: hi again')).toBeNull();
  });

  it('captures a referenced-content block embedded at the end of the user part', () => {
    const content =
      '{user}: check this out\n\n[Referenced content: a fake screenshot of a chart]\n{assistant}: neat find';
    expect(splitMemoryContent(content)).toEqual({
      user: 'check this out',
      assistant: 'neat find',
      referenced: 'a fake screenshot of a chart',
    });
  });

  it('captures a user-part referenced-content block ending in an emoji', () => {
    const content =
      '{user}: look at this\n\n[Referenced content: a fake sunset selfie 🌅]\n{assistant}: gorgeous';
    expect(splitMemoryContent(content)).toEqual({
      user: 'look at this',
      assistant: 'gorgeous',
      referenced: 'a fake sunset selfie 🌅',
    });
  });

  // A content string with a marker at the end of the user part AND a second
  // marker at the very end of the whole content cannot be cleanly split: the
  // whole-content regex is anchored to the string's single true end and is
  // not aware of the earlier occurrence, so it greedily matches from the
  // FIRST (user-part) marker through to the last `]`, swallowing the
  // `\n{assistant}: ` separator in between. This was verified directly
  // (node -e against the exact regex) rather than assumed: the row correctly
  // comes back null (excluded as unparseable) rather than silently
  // mis-assigning `referenced` to either block.
  it('treats a content string with both a user-part and a trailing block as unparseable', () => {
    const content =
      '{user}: first\n\n[Referenced content: inner block]\n{assistant}: second\n\n[Referenced content: outer block]';
    expect(splitMemoryContent(content)).toBeNull();
  });
});

describe('stripQuoteLines', () => {
  it('drops lines starting with "> " and counts them', () => {
    const result = stripQuoteLines('line one\n> quoted line\nline two');
    expect(result.text).toBe('line one\nline two');
    expect(result.strippedCount).toBe(1);
  });

  it('leaves text with no quote lines unchanged', () => {
    expect(stripQuoteLines('plain text').strippedCount).toBe(0);
  });
});
