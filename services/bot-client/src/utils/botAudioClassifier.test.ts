import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildBotAudioFilename, classifyBotAudio } from './botAudioClassifier.js';

const MY_CLIENT_ID = '867653249611005983';
const OTHER_CLIENT_ID = '111111111111111111';

describe('buildBotAudioFilename', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T17:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the canonical {clientId}-{slug}-{timestamp}.{ext} shape', () => {
    const filename = buildBotAudioFilename({
      clientId: MY_CLIENT_ID,
      personalitySlug: 'lila-zot-lilit',
      extension: 'mp3',
    });
    // Timestamp is base36 of Date.now() at the fixed clock above. Computing
    // it here rather than hand-precomputing keeps the assertion robust to
    // fixture clock changes.
    const expectedTimestamp = Date.now().toString(36);
    expect(filename).toBe(`${MY_CLIENT_ID}-lila-zot-lilit-${expectedTimestamp}.mp3`);
  });

  it('produces filenames that round-trip through classifyBotAudio', () => {
    const filename = buildBotAudioFilename({
      clientId: MY_CLIENT_ID,
      personalitySlug: 'astra',
      extension: 'ogg',
    });
    const result = classifyBotAudio(filename, MY_CLIENT_ID);
    expect(result.isOwnBotAudio).toBe(true);
    expect(result.personalitySlug).toBe('astra');
  });

  it('supports each audio extension we synthesize', () => {
    const extensions = ['mp3', 'ogg', 'wav'] as const;
    for (const ext of extensions) {
      const filename = buildBotAudioFilename({
        clientId: MY_CLIENT_ID,
        personalitySlug: 'astra',
        extension: ext,
      });
      expect(classifyBotAudio(filename, MY_CLIENT_ID).isOwnBotAudio).toBe(true);
    }
  });
});

describe('classifyBotAudio', () => {
  it('matches a well-formed bot-authored filename and extracts the slug', () => {
    const filename = `${MY_CLIENT_ID}-lila-zot-lilit-lq1x2b.mp3`;
    const result = classifyBotAudio(filename, MY_CLIENT_ID);
    expect(result.isOwnBotAudio).toBe(true);
    expect(result.personalitySlug).toBe('lila-zot-lilit');
  });

  it('does NOT match a filename from a different bot identity', () => {
    // The filename is well-formed but the clientId belongs to a different
    // tzurot instance (dev vs prod, fork, sibling bot). This bot should
    // treat it as a regular forwarded audio message.
    const filename = `${OTHER_CLIENT_ID}-lila-zot-lilit-lq1x2b.mp3`;
    expect(classifyBotAudio(filename, MY_CLIENT_ID).isOwnBotAudio).toBe(false);
  });

  it('does NOT match the legacy voice.mp3 / voice.ogg shape', () => {
    expect(classifyBotAudio('voice.mp3', MY_CLIENT_ID).isOwnBotAudio).toBe(false);
    expect(classifyBotAudio('voice.ogg', MY_CLIENT_ID).isOwnBotAudio).toBe(false);
    expect(classifyBotAudio('voice.wav', MY_CLIENT_ID).isOwnBotAudio).toBe(false);
  });

  it('does NOT match user-uploaded audio with arbitrary names', () => {
    const cases = [
      'my-vacation.mp3',
      'recording_2026-05-01.ogg',
      'audio.wav',
      'song.mp3',
      // Looks like a slug, but no clientId prefix:
      'lila-zot-lilit.mp3',
    ];
    for (const name of cases) {
      expect(classifyBotAudio(name, MY_CLIENT_ID).isOwnBotAudio).toBe(false);
    }
  });

  it('rejects filenames with a non-audio extension', () => {
    const cases = [
      `${MY_CLIENT_ID}-astra-lq1x2b.txt`,
      `${MY_CLIENT_ID}-astra-lq1x2b.json`,
      `${MY_CLIENT_ID}-astra-lq1x2b.jpg`,
    ];
    for (const name of cases) {
      expect(classifyBotAudio(name, MY_CLIENT_ID).isOwnBotAudio).toBe(false);
    }
  });

  it('rejects filenames with an uppercase or non-kebab slug', () => {
    // The personality schema enforces lowercase kebab-case slugs; an
    // uppercase letter in the slug position means the file did not come
    // from our send-side helper.
    expect(classifyBotAudio(`${MY_CLIENT_ID}-Lila-lq1x2b.mp3`, MY_CLIENT_ID).isOwnBotAudio).toBe(
      false
    );
    expect(
      classifyBotAudio(`${MY_CLIENT_ID}-lila_zot-lq1x2b.mp3`, MY_CLIENT_ID).isOwnBotAudio
    ).toBe(false);
  });

  it('rejects filenames missing the timestamp segment', () => {
    expect(classifyBotAudio(`${MY_CLIENT_ID}-astra.mp3`, MY_CLIENT_ID).isOwnBotAudio).toBe(false);
  });

  it('rejects filenames with a `(1)` Discord-duplicate suffix', () => {
    // Discord appends `(1)`, `(2)`, ... to filenames when an identical
    // filename is uploaded twice in the same payload. The timestamp segment
    // we add prevents this from happening for our own audio in practice,
    // but the regex defensively rejects the suffix shape too — a duplicate-
    // suffixed file is structurally distinct from our send-side output.
    expect(
      classifyBotAudio(`${MY_CLIENT_ID}-astra-lq1x2b (1).mp3`, MY_CLIENT_ID).isOwnBotAudio
    ).toBe(false);
  });
});
