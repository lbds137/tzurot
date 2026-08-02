import { describe, it, expect } from 'vitest';
import { parseAttachmentSegments, leadSentence, buildAllocationQueries } from './allocationArms.js';
import { ATTACHMENT_SEARCH_BUDGET_CHARS } from '../prompt/searchQueryBudget.js';

const IMAGE_BLOCK = '[Image: gym.png]\nA large room with rubber flooring. Mirrors line the wall.';
const VOICE_BLOCK =
  '[Voice message: 5.2s]\n<voice_transcripts><transcript>hey are you around later</transcript></voice_transcripts>';

describe('parseAttachmentSegments', () => {
  it('strips the header from an image block and keeps the description', () => {
    expect(parseAttachmentSegments(IMAGE_BLOCK)).toEqual([
      { isTranscript: false, text: 'A large room with rubber flooring. Mirrors line the wall.' },
    ]);
  });

  it('unwraps a voice block down to the spoken text', () => {
    expect(parseAttachmentSegments(VOICE_BLOCK)).toEqual([
      { isTranscript: true, text: 'hey are you around later' },
    ]);
  });

  it('splits a mixed block into one segment per attachment, in order', () => {
    const segments = parseAttachmentSegments(`${IMAGE_BLOCK}\n\n${VOICE_BLOCK}`);
    expect(segments).toHaveLength(2);
    expect(segments[0].isTranscript).toBe(false);
    expect(segments[1]).toEqual({ isTranscript: true, text: 'hey are you around later' });
  });

  it('joins multiple transcripts inside one wrapper', () => {
    const block =
      '[Voice message: 9.0s]\n<voice_transcripts><transcript>first part</transcript><transcript>second part</transcript></voice_transcripts>';
    expect(parseAttachmentSegments(block)).toEqual([
      { isTranscript: true, text: 'first part\nsecond part' },
    ]);
  });

  it('drops a header-only entry (bare placeholder, no description)', () => {
    expect(parseAttachmentSegments(`[Sticker: wave]\n\n${IMAGE_BLOCK}`)).toEqual([
      { isTranscript: false, text: 'A large room with rubber flooring. Mirrors line the wall.' },
    ]);
  });

  it('handles Audio and File headers', () => {
    expect(parseAttachmentSegments('[Audio: song.mp3]\nA slow piano piece.')).toEqual([
      { isTranscript: false, text: 'A slow piano piece.' },
    ]);
    expect(parseAttachmentSegments('[File: notes.txt]\nMeeting notes about the launch.')).toEqual([
      { isTranscript: false, text: 'Meeting notes about the launch.' },
    ]);
  });

  it('returns nothing for text without an attachment header', () => {
    expect(parseAttachmentSegments('just a plain message')).toEqual([]);
  });

  it('keeps a multi-paragraph description as one segment', () => {
    const block = '[Image: a.png]\nFirst paragraph.\n\nSecond paragraph continues.';
    expect(parseAttachmentSegments(block)).toEqual([
      { isTranscript: false, text: 'First paragraph.\n\nSecond paragraph continues.' },
    ]);
  });
});

describe('leadSentence', () => {
  it('takes the first sentence up to a terminator', () => {
    expect(leadSentence('A tabby cat sleeps. The window is open behind it.')).toBe(
      'A tabby cat sleeps.'
    );
  });

  it('spans a wrapped line to reach the first terminator', () => {
    expect(leadSentence('A tabby cat\nsleeps on a sill. More detail.')).toBe(
      'A tabby cat\nsleeps on a sill.'
    );
  });

  it('falls back to the first line when no terminator exists', () => {
    expect(leadSentence('no punctuation here\nsecond line')).toBe('no punctuation here');
  });

  it('returns the whole text for a single unterminated line', () => {
    expect(leadSentence('just words')).toBe('just words');
  });
});

describe('buildAllocationQueries', () => {
  const golden = {
    messageBare: 'look at this gym',
    attachmentText: `${IMAGE_BLOCK}\n\n${VOICE_BLOCK}`,
  };

  it('builds current as bare + full stripped descriptions (no headers, no wrappers)', () => {
    const queries = buildAllocationQueries(golden);
    expect(queries['current-dense']).toBe(
      'look at this gym\n\nA large room with rubber flooring. Mirrors line the wall.\n\nhey are you around later'
    );
    expect(queries['current-dense']).not.toContain('[Image:');
    expect(queries['current-dense']).not.toContain('<voice_transcripts>');
  });

  it('builds bare as the user text only', () => {
    expect(buildAllocationQueries(golden)['bare-dense']).toBe('look at this gym');
  });

  it('lead-truncates image descriptions but keeps transcripts whole', () => {
    expect(buildAllocationQueries(golden)['lead-dense']).toBe(
      'look at this gym\n\nA large room with rubber flooring.\n\nhey are you around later'
    );
  });

  it('caps the budget arm attachment part at the production budget', () => {
    const longDescription = `${'word '.repeat(400)}end.`;
    const queries = buildAllocationQueries({
      messageBare: 'context',
      attachmentText: `[Image: big.png]\n${longDescription}`,
    });
    const attachmentPart = queries['budget-dense'].slice('context\n\n'.length);
    expect(attachmentPart.length).toBeLessThanOrEqual(ATTACHMENT_SEARCH_BUDGET_CHARS);
    expect(attachmentPart.length).toBeGreaterThan(ATTACHMENT_SEARCH_BUDGET_CHARS - 20);
    expect(queries['current-dense'].length).toBeGreaterThan(queries['budget-dense'].length);
  });

  it('leaves a within-budget attachment untouched in the budget arm', () => {
    const queries = buildAllocationQueries(golden);
    expect(queries['budget-dense']).toBe(queries['current-dense']);
  });

  it('yields an empty bare arm for an image-only turn (the arm earns its miss)', () => {
    const queries = buildAllocationQueries({ messageBare: '', attachmentText: IMAGE_BLOCK });
    expect(queries['bare-dense']).toBe('');
    expect(queries['current-dense']).toBe(
      'A large room with rubber flooring. Mirrors line the wall.'
    );
  });
});
