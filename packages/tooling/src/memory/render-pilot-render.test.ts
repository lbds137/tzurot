import { describe, it, expect } from 'vitest';
import {
  formatRenderTimestamp,
  stripQuoteLines,
  renderNoteV,
  renderNoteF,
  renderNoteS,
  wrapMemoryArchive,
  renderPersonaBlock,
  renderVoiceAnchor,
  V_INSTRUCTION,
  FS_INSTRUCTION,
  type RenderInput,
} from './render-pilot-render.js';

const BASE_INPUT: RenderInput = {
  createdAt: new Date('2026-03-15T14:30:00.000Z'),
  subjectName: 'Alice',
  displayName: 'Nova',
  userText: 'hello there',
  assistantText: 'hi, how are you?',
  referenced: null,
  facts: [],
  summary: null,
};

describe('formatRenderTimestamp', () => {
  it('formats as YYYY-MM-DD HH:MM', () => {
    expect(formatRenderTimestamp(new Date('2026-03-15T14:30:00.000Z'))).toBe('2026-03-15 14:30');
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

describe('renderNoteV — includes the referenced block', () => {
  // Canary: mutate renderNoteV to drop the referenced block → this test reddens.
  it('includes the referenced block when present', () => {
    const xml = renderNoteV({ ...BASE_INPUT, referenced: 'someone posted a photo' });
    expect(xml).toContain('[Referenced content: someone posted a photo]');
  });

  it('omits the referenced block when absent', () => {
    const xml = renderNoteV(BASE_INPUT);
    expect(xml).not.toContain('Referenced content');
  });

  it('keeps quote lines on the user side (V does not strip)', () => {
    const xml = renderNoteV({ ...BASE_INPUT, userText: '> quoted\nreal text' });
    expect(xml).toContain('> quoted');
  });
});

describe('renderNoteF — never renders the referenced block', () => {
  // Canary: mutate renderNoteF to include the referenced block → this test reddens.
  it('never includes the referenced block even when present', () => {
    const { xml } = renderNoteF({ ...BASE_INPUT, referenced: 'someone posted a photo' });
    expect(xml).not.toContain('Referenced content');
  });

  it('omits the "Recorded about this exchange" block with zero facts', () => {
    const { xml } = renderNoteF(BASE_INPUT);
    expect(xml).not.toContain('Recorded about this exchange');
  });

  it('lists facts ordered by salience desc', () => {
    const { xml } = renderNoteF({
      ...BASE_INPUT,
      facts: [
        { id: 'f1', statement: 'low prio', salience: 0.1, tier: 'observed' },
        { id: 'f2', statement: 'high prio', salience: 0.9, tier: 'observed' },
      ],
    });
    expect(xml.indexOf('high prio')).toBeLessThan(xml.indexOf('low prio'));
  });

  it('strips quote lines from the user side and counts them', () => {
    const { strippedCount } = renderNoteF({ ...BASE_INPUT, userText: '> quoted\nreal text' });
    expect(strippedCount).toBe(1);
  });
});

describe('renderNoteS — never renders the referenced block', () => {
  // Canary: mutate renderNoteS to include the referenced block → this test reddens.
  it('never includes the referenced block even when present', () => {
    const { xml } = renderNoteS({
      ...BASE_INPUT,
      referenced: 'someone posted a photo',
      summary: 'a summary',
    });
    expect(xml).not.toContain('Referenced content');
  });

  it('renders the summary text as the assistant line', () => {
    const { xml } = renderNoteS({ ...BASE_INPUT, summary: 'Alice asked about the vet.' });
    expect(xml).toContain('Alice asked about the vet.');
  });
});

describe('wrapMemoryArchive', () => {
  it('uses the pinned V instruction for arm V', () => {
    const xml = wrapMemoryArchive('V', '');
    expect(xml).toContain(V_INSTRUCTION);
  });

  it('uses the D8 F/S instruction for arms F and S', () => {
    expect(wrapMemoryArchive('F', '')).toContain(FS_INSTRUCTION);
    expect(wrapMemoryArchive('S', '')).toContain(FS_INSTRUCTION);
  });

  it('omits the notes block entirely when empty', () => {
    const xml = wrapMemoryArchive('V', '');
    expect(xml).toBe(
      `<memory_archive usage="context_only_do_not_repeat">\n<instruction>${V_INSTRUCTION}</instruction>\n</memory_archive>`
    );
  });
});

describe('renderPersonaBlock', () => {
  it('omits empty optional fields', () => {
    const xml = renderPersonaBlock({
      displayName: 'Nova',
      personalityTraits: 'warm',
      personalityTone: null,
      conversationalExamples: null,
    });
    expect(xml).not.toContain('personality_tone');
    expect(xml).not.toContain('conversational_examples');
    expect(xml).toContain('<display_name>Nova</display_name>');
  });
});

describe('renderVoiceAnchor', () => {
  it('returns empty string when all three fields are empty', () => {
    expect(
      renderVoiceAnchor({
        displayName: 'Nova',
        personalityTraits: '',
        personalityTone: null,
        conversationalExamples: null,
      })
    ).toBe('');
  });

  it('renders the lead-in and drift note naming the character', () => {
    const xml = renderVoiceAnchor({
      displayName: 'Nova',
      personalityTraits: 'warm',
      personalityTone: null,
      conversationalExamples: null,
    });
    expect(xml).toContain(
      'This is who Nova is right now. It outranks every earlier turn above it.'
    );
    expect(xml).toContain('Pet names, running metaphors, sign-offs');
  });
});
