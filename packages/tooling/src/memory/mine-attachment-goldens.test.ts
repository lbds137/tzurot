import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryRaw = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn(async () => ({
    prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
    disconnect: mockDisconnect,
  })),
}));

const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readFileSync: vi.fn(),
}));

import {
  splitEnrichedContent,
  classifyAttachmentKind,
  sampleByKind,
  mineAttachmentGoldens,
  type AttachmentKind,
} from './mine-attachment-goldens.js';

describe('splitEnrichedContent', () => {
  it('splits message + image description at the header boundary', () => {
    const content = 'look at this gym\n\n[Image: gym.png]\nA large room with rubber flooring.';
    const split = splitEnrichedContent(content);
    expect(split).toEqual({
      messageBare: 'look at this gym',
      attachmentText: '[Image: gym.png]\nA large room with rubber flooring.',
    });
  });

  it('handles description-only content (no user text)', () => {
    const content = '[Image: cat.jpg]\nA tabby cat on a windowsill.';
    const split = splitEnrichedContent(content);
    expect(split).toEqual({
      messageBare: '',
      attachmentText: '[Image: cat.jpg]\nA tabby cat on a windowsill.',
    });
  });

  it('splits voice-transcript content at the voice header', () => {
    const content =
      'hey\n\n[Voice message: 5.2s]\n<voice_transcripts><transcript>hello there</transcript></voice_transcripts>';
    const split = splitEnrichedContent(content);
    expect(split?.messageBare).toBe('hey');
    expect(split?.attachmentText).toContain('<voice_transcripts>');
    expect(split?.attachmentText.startsWith('[Voice message: 5.2s]')).toBe(true);
  });

  it('splits at the FIRST header when several attachments follow', () => {
    const content =
      'two things\n\n[Image: a.png]\nFirst description.\n\n[Image: b.png]\nSecond description.';
    const split = splitEnrichedContent(content);
    expect(split?.messageBare).toBe('two things');
    expect(split?.attachmentText).toContain('[Image: a.png]');
    expect(split?.attachmentText).toContain('[Image: b.png]');
  });

  it('returns null for content with no attachment header', () => {
    expect(splitEnrichedContent('just a plain message')).toBeNull();
  });

  it('does not split on a bracket header that is not at a paragraph boundary', () => {
    // Inline mention mid-line is not the enrichment shape (writer joins with \n\n).
    expect(splitEnrichedContent('I typed [Image: fake] inline here')).toBeNull();
  });

  it('treats a sticker header as an attachment boundary', () => {
    const split = splitEnrichedContent('nice\n\n[Sticker: wave]\nA cartoon hand waving.');
    expect(split?.messageBare).toBe('nice');
    expect(split?.attachmentText.startsWith('[Sticker: wave]')).toBe(true);
  });

  it('treats a link-preview header as an attachment boundary', () => {
    // An embed preview renders under its own header; without it in the
    // enumeration the whole row falls out of the candidate pool unsplit.
    const split = splitEnrichedContent(
      'look at this\n\n[Link preview: embed-1-image.png]\nA still from the video.'
    );
    expect(split?.messageBare).toBe('look at this');
    expect(split?.attachmentText.startsWith('[Link preview: embed-1-image.png]')).toBe(true);
  });
});

describe('classifyAttachmentKind', () => {
  it('classifies image blocks', () => {
    expect(classifyAttachmentKind('[Image: a.png]\nA description.')).toBe('image');
  });

  it('classifies sticker blocks as image', () => {
    expect(classifyAttachmentKind('[Sticker: wave]\nA hand.')).toBe('image');
  });

  it('classifies link-preview blocks as image', () => {
    // A link preview is a vision description of an image; it differs from an
    // upload only in how the image got there.
    expect(classifyAttachmentKind('[Link preview: embed-1-image.png]\nA still.')).toBe('image');
  });

  it('classifies a link preview beside a voice block as mixed', () => {
    // The half that a header-vocabulary miss actually corrupts: without
    // 'Link preview' in the image test this returns 'voice', losing the
    // description that dominates the block.
    expect(
      classifyAttachmentKind(
        '[Link preview: embed-1-image.png]\nA still.\n\n[Voice message: 3.0s]\n<voice_transcripts><transcript>hi</transcript></voice_transcripts>'
      )
    ).toBe('mixed');
  });

  it('classifies voice blocks', () => {
    expect(
      classifyAttachmentKind(
        '[Voice message: 3.0s]\n<voice_transcripts><transcript>hi</transcript></voice_transcripts>'
      )
    ).toBe('voice');
  });

  it('classifies blocks with both as mixed', () => {
    expect(
      classifyAttachmentKind(
        '[Image: a.png]\nA description.\n\n[Voice message: 3.0s]\n<voice_transcripts><transcript>hi</transcript></voice_transcripts>'
      )
    ).toBe('mixed');
  });
});

describe('sampleByKind', () => {
  const candidate = (id: string, kind: AttachmentKind, minute: number) =>
    ({
      id,
      channelId: 'c',
      personalityId: 'p',
      content: '',
      messageMetadata: null,
      createdAt: new Date(2026, 0, 1, 0, minute),
      kind,
      messageBare: '',
      attachmentText: '',
    }) as Parameters<typeof sampleByKind>[0][number];

  it('fills the 2/3 image and 1/3 voice quotas when both pools are deep', () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, i) => candidate(`img-${i}`, 'image', i)),
      ...Array.from({ length: 30 }, (_, i) => candidate(`vox-${i}`, 'voice', i)),
    ];
    const picked = sampleByKind(pool, 12);
    expect(picked.filter(c => c.kind === 'image')).toHaveLength(8);
    expect(picked.filter(c => c.kind === 'voice')).toHaveLength(4);
  });

  it('counts mixed candidates under the image quota', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => candidate(`mix-${i}`, 'mixed', i)),
      ...Array.from({ length: 10 }, (_, i) => candidate(`vox-${i}`, 'voice', i)),
    ];
    const picked = sampleByKind(pool, 6);
    expect(picked.filter(c => c.kind === 'mixed')).toHaveLength(4);
    expect(picked.filter(c => c.kind === 'voice')).toHaveLength(2);
  });

  it('is deterministic: the same pool yields the same sample', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      candidate(`img-${i}`, i % 3 === 0 ? 'voice' : 'image', i)
    );
    const first = sampleByKind(pool, 8).map(c => c.id);
    const second = sampleByKind(pool.slice().reverse(), 8).map(c => c.id);
    expect(second).toEqual(first);
  });

  it('does not overdraw a shallow pool', () => {
    const pool = [candidate('img-0', 'image', 0), candidate('vox-0', 'voice', 1)];
    const picked = sampleByKind(pool, 12);
    expect(picked).toHaveLength(2);
  });
});

describe('mineAttachmentGoldens (the Prisma + fs seams)', () => {
  const imageRow = (id: string, minute: number) => ({
    id,
    channel_id: 'chan-1',
    personality_id: 'char-1',
    content: `about this one\n\n[Image: ${id}.png]\nA long description of ${id}.`,
    message_metadata: { note: id },
    created_at: new Date(2026, 0, 10, 0, minute),
  });
  const voiceRow = (id: string, minute: number) => ({
    id,
    channel_id: 'chan-1',
    personality_id: 'char-1',
    content: `hey\n\n[Voice message: 3.0s]\n<voice_transcripts><transcript>spoken ${id}</transcript></voice_transcripts>`,
    message_metadata: { note: id },
    created_at: new Date(2026, 0, 10, 0, minute),
  });
  // 3 turns ≥ the miner's minimum, so a finalist with this history becomes a golden.
  const priorTurns = [
    { role: 'user', content: 'earlier one', created_at: new Date('2026-01-09T00:00:00Z') },
    { role: 'assistant', content: 'earlier reply', created_at: new Date('2026-01-09T00:01:00Z') },
    { role: 'user', content: 'earlier two', created_at: new Date('2026-01-09T00:02:00Z') },
  ];

  const writtenGoldens = () => {
    const write = mockWriteFileSync.mock.calls.find(call =>
      String(call[0]).endsWith('attachment-goldens.json')
    );
    expect(write).toBeDefined();
    return (
      JSON.parse(String(write![1])) as {
        goldens: {
          id: string;
          attachmentKind: AttachmentKind;
          messageBare: string;
          attachmentText: string;
          message: string;
          priorHistory: unknown[];
        }[];
      }
    ).goldens;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
  });

  it('keeps per-kind quotas when history-drops force image backfills (the first-live-run bug)', async () => {
    // sampleSize 6 → caps 4 image / 2 voice. Pools sized to the 2x over-sample
    // quotas (8 image, 4 voice) so finalist order is img-0..7 then vox-0..3.
    mockQueryRaw
      .mockResolvedValueOnce([
        ...Array.from({ length: 8 }, (_, i) => imageRow(`img-${i}`, i)),
        ...Array.from({ length: 4 }, (_, i) => voiceRow(`vox-${i}`, 30 + i)),
      ])
      // img-0 and img-1: too little prior history → dropped, backfilled by img-2..5.
      .mockResolvedValueOnce([priorTurns[0]])
      .mockResolvedValueOnce([priorTurns[0]])
      .mockResolvedValue(priorTurns);
    await mineAttachmentGoldens({ env: 'dev', personaId: 'persona-xyz', sampleSize: 6 });

    const goldens = writtenGoldens();
    // The regression this PR fixed: image backfills must consume IMAGE's share
    // only — voice keeps its 1/3 despite 6 more image finalists in the queue.
    expect(goldens.filter(g => g.attachmentKind === 'image').map(g => g.id)).toEqual([
      'img-2',
      'img-3',
      'img-4',
      'img-5',
    ]);
    expect(goldens.filter(g => g.attachmentKind === 'voice').map(g => g.id)).toEqual([
      'vox-0',
      'vox-1',
    ]);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('skips over-cap candidates BEFORE fetching their history (no wasted round-trips)', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        ...Array.from({ length: 8 }, (_, i) => imageRow(`img-${i}`, i)),
        ...Array.from({ length: 4 }, (_, i) => voiceRow(`vox-${i}`, 30 + i)),
      ])
      .mockResolvedValue(priorTurns);
    await mineAttachmentGoldens({ env: 'dev', personaId: 'persona-xyz', sampleSize: 6 });
    // Call 0 = candidates; history calls = 4 images that fit the cap + 2 voice.
    // img-4..7 hit the image cap and must not cost a query each.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1 + 4 + 2);
  });

  it('writes goldens carrying the split fields alongside the full enriched message', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([imageRow('img-0', 0), voiceRow('vox-0', 1)])
      .mockResolvedValue(priorTurns);
    await mineAttachmentGoldens({ env: 'dev', personaId: 'persona-xyz', sampleSize: 3 });
    expect(mockMkdirSync).toHaveBeenCalledWith('reports/goldens-mining', { recursive: true });
    const goldens = writtenGoldens();
    expect(goldens).toHaveLength(2);
    const image = goldens.find(g => g.attachmentKind === 'image');
    expect(image?.messageBare).toBe('about this one');
    expect(image?.attachmentText).toContain('[Image: img-0.png]');
    // `message` deliberately holds the FULL enriched content (see the type's doc).
    expect(image?.message).toBe(`${image?.messageBare}\n\n${image?.attachmentText}`);
    expect(image?.priorHistory).toHaveLength(3);
  });
});
