/**
 * Tests for the same-channel history render mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import {
  applySameChannelRenderMode,
  collectOlderExchangeTriggerIds,
  renderSameChannelHistory,
} from './sameChannelRender.js';

const { mockWarn, mockInfo } = vi.hoisted(() => ({ mockWarn: vi.fn(), mockInfo: vi.fn() }));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: mockInfo, warn: mockWarn, error: vi.fn() }),
  };
});

const RESPONDER = 'personality-resp';
const SIBLING = 'personality-sibling';

function userEntry(
  discordMessageId: string,
  opts: Partial<StructuredHistoryEntry> = {}
): StructuredHistoryEntry {
  return {
    role: MessageRole.User,
    content: `user content ${discordMessageId}`,
    discordMessageId: [discordMessageId],
    ...opts,
  };
}

function assistantEntry(
  personalityId: string,
  content: string,
  opts: Partial<StructuredHistoryEntry> = {}
): StructuredHistoryEntry {
  return {
    role: MessageRole.Assistant,
    content,
    personalityId,
    ...opts,
  };
}

/** Five exchanges: u1/a1 .. u5/a5, oldest-first. */
function fiveExchanges(): StructuredHistoryEntry[] {
  const entries: StructuredHistoryEntry[] = [];
  for (let i = 1; i <= 5; i++) {
    entries.push(userEntry(`u${i}`));
    entries.push(assistantEntry(RESPONDER, `original reply ${i}`));
  }
  return entries;
}

/** `entries` plus a trailing user turn the responder has not replied to yet. */
function withDanglingUser(
  entries: StructuredHistoryEntry[],
  discordMessageId: string
): StructuredHistoryEntry[] {
  return [...entries, userEntry(discordMessageId)];
}

/** Two completed exchanges (u1/a1, u2/a2) followed by a dangling user turn u3. */
function twoExchangesPlusDanglingUser(): StructuredHistoryEntry[] {
  return withDanglingUser(
    [
      userEntry('u1'),
      assistantEntry(RESPONDER, 'original reply 1'),
      userEntry('u2'),
      assistantEntry(RESPONDER, 'original reply 2'),
    ],
    'u3'
  );
}

describe('applySameChannelRenderMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('C1: the last N exchanges are verbatim', () => {
    const entries = fiveExchanges();
    // u3 carries a usable summary on purpose: exchange 3 sits just inside the
    // verbatim window, so the assertion below proves the window protects a turn
    // that COULD have been summarized. Without it, widening the window by one
    // would leave exchange 3 falling back to verbatim for want of a summary —
    // identical output — and this test would pass with the boundary broken.
    const summaries = new Map([
      ['u1', 'summary one'],
      ['u2', 'summary two'],
      ['u3', 'summary three'],
    ]);

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries,
    });

    const [, a1, , a2, , a3, , a4, , a5] = rendered;
    expect(a1.content).toBe('summary one');
    expect(a1.renderedAs).toBe('summary');
    expect(a2.content).toBe('summary two');
    expect(a2.renderedAs).toBe('summary');

    expect(a3).toBe(entries[5]);
    expect(a3.renderedAs).toBeUndefined();
    expect(a4).toBe(entries[7]);
    expect(a4.renderedAs).toBeUndefined();
    expect(a5).toBe(entries[9]);
    expect(a5.renderedAs).toBeUndefined();

    expect(counts.verbatimExchanges).toBe(3);
    expect(counts.summarized).toBe(2);
  });

  it('C2: verbatim fallback when no usable summary', () => {
    const entries = fiveExchanges();
    const summaries = new Map([['u1', 'summary one']]); // u2 missing

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries,
    });

    const a2 = rendered[3];
    expect(a2).toBe(entries[3]);
    expect(a2.content).toBe('original reply 2');
    expect(a2.renderedAs).toBeUndefined();
    expect(counts.fallbackVerbatim).toBe(1);
  });

  it("C3: 'both' is inert", () => {
    const entries = fiveExchanges();

    const { entries: rendered } = applySameChannelRenderMode(entries, {
      mode: 'both',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries: new Map([['u1', 'summary one']]),
    });

    expect(rendered).toBe(entries);
    expect(rendered.every(e => e.renderedAs === undefined)).toBe(true);
  });

  it('C5: user turns are never touched in any mode', () => {
    const richUser = userEntry('u1', {
      messageMetadata: { referencedMessages: [{ id: 'ref-1' } as never] },
    });
    const entries: StructuredHistoryEntry[] = [
      richUser,
      assistantEntry(RESPONDER, 'reply 1'),
      userEntry('u2'),
      assistantEntry(RESPONDER, 'reply 2'),
    ];

    const summarizedResult = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 0,
      responderPersonalityId: RESPONDER,
      summaries: new Map([['u1', 'a summary']]),
    });
    const userOnlyResult = applySameChannelRenderMode(entries, {
      mode: 'user-only',
      verbatimExchanges: 0,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });

    expect(summarizedResult.entries[0]).toBe(richUser);
    expect(summarizedResult.entries[0].content).toBe(richUser.content);
    expect(summarizedResult.entries[0].messageMetadata).toBe(richUser.messageMetadata);
    expect(userOnlyResult.entries[0]).toBe(richUser);
    expect(userOnlyResult.entries[0].content).toBe(richUser.content);
    expect(userOnlyResult.entries[0].messageMetadata).toBe(richUser.messageMetadata);
  });

  it("C6: 'user-only' drops older non-user turns and keeps the last N", () => {
    const entries = fiveExchanges();

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'user-only',
      verbatimExchanges: 2,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });

    // Exchanges 1-3 (older): only the user entries survive.
    expect(rendered.slice(0, 3)).toEqual([entries[0], entries[2], entries[4]]);
    expect(rendered[0]).toBe(entries[0]);
    expect(rendered[1]).toBe(entries[2]);
    expect(rendered[2]).toBe(entries[4]);
    // Exchanges 4-5 (tail): every entry survives by reference.
    expect(rendered.slice(3)).toEqual([entries[6], entries[7], entries[8], entries[9]]);
    expect(rendered[3]).toBe(entries[6]);
    expect(rendered[4]).toBe(entries[7]);
    expect(rendered[5]).toBe(entries[8]);
    expect(rendered[6]).toBe(entries[9]);

    expect(counts.omitted).toBe(3);
  });

  it("a sibling personality's assistant entry in an older exchange stays verbatim under 'summarized' and is dropped under 'user-only'", () => {
    const sibling = assistantEntry(SIBLING, 'sibling reply');
    const entries: StructuredHistoryEntry[] = [
      userEntry('u1'),
      sibling,
      assistantEntry(RESPONDER, 'responder reply 1'),
      userEntry('u2'),
      assistantEntry(RESPONDER, 'responder reply 2'),
    ];

    const summarizedResult = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });
    const userOnlyResult = applySameChannelRenderMode(entries, {
      mode: 'user-only',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });

    expect(summarizedResult.entries).toContain(sibling);
    expect(userOnlyResult.entries).not.toContain(sibling);
  });

  it('a responder turn with no preceding user row in its exchange falls back to verbatim', () => {
    const respA = assistantEntry(RESPONDER, 'reply A');
    const respB = assistantEntry(RESPONDER, 'reply B');
    const entries: StructuredHistoryEntry[] = [respA, respB];

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map([['some-other-id', 'irrelevant summary']]),
    });

    expect(rendered[0]).toBe(respA);
    expect(rendered[0].content).toBe('reply A');
    expect(rendered[0].renderedAs).toBeUndefined();
    expect(counts.fallbackVerbatim).toBe(1);
  });

  it('responderPersonalityId undefined returns the input array unchanged in every mode', () => {
    const entries = fiveExchanges();

    for (const mode of ['both', 'summarized', 'user-only'] as const) {
      const { entries: rendered } = applySameChannelRenderMode(entries, {
        mode,
        verbatimExchanges: 1,
        responderPersonalityId: undefined,
        summaries: new Map(),
      });
      expect(rendered).toBe(entries);
    }
  });

  it('a summarized responder turn keeps only its reactions — image descriptions and embeds go with the replaced content', () => {
    const reactions = [{ emoji: '👍', reactors: [{ personaId: 'discord:1', displayName: 'Ann' }] }];
    const entries = fiveExchanges();
    entries[1] = assistantEntry(RESPONDER, 'original reply 1', {
      messageMetadata: {
        imageDescriptions: [{ filename: 'a.png', description: 'a cat' }],
        embedsXml: ['<embed title="t" />'],
        reactions,
      },
    });
    const summaries = new Map([['u1', 'summary one']]);

    const { entries: rendered } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries,
    });

    expect(rendered[1].content).toBe('summary one');
    expect(rendered[1].renderedAs).toBe('summary');
    expect(rendered[1].messageMetadata).toEqual({ reactions });
  });

  it('a summarized responder turn with no reactions drops its metadata entirely', () => {
    const entries = fiveExchanges();
    entries[1] = assistantEntry(RESPONDER, 'original reply 1', {
      messageMetadata: {
        imageDescriptions: [{ filename: 'a.png', description: 'a cat' }],
        embedsXml: ['<embed title="t" />'],
      },
    });
    const summaries = new Map([['u1', 'summary one']]);

    const { entries: rendered } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries,
    });

    expect(rendered[1].content).toBe('summary one');
    expect(rendered[1].renderedAs).toBe('summary');
    expect(rendered[1].messageMetadata).toBeUndefined();
  });

  it('a summarized responder turn is no longer a forwarded snapshot — isForwarded and forward attribution go with the content', () => {
    const entries = fiveExchanges();
    entries[1] = assistantEntry(RESPONDER, 'original reply 1', {
      isForwarded: true,
      messageMetadata: { forwardedFrom: { authorName: 'x' } },
    });
    const summaries = new Map([['u1', 'summary one']]);

    const { entries: rendered } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries,
    });

    expect(rendered[1].content).toBe('summary one');
    expect(rendered[1].renderedAs).toBe('summary');
    expect(rendered[1].isForwarded).toBeUndefined();
    expect(rendered[1].messageMetadata).toBeUndefined();
  });

  it('a fallback-verbatim responder turn keeps its full metadata by reference', () => {
    const metadata = {
      imageDescriptions: [{ filename: 'b.png', description: 'a dog' }],
      embedsXml: ['<embed title="t2" />'],
    };
    const entries = fiveExchanges();
    entries[3] = assistantEntry(RESPONDER, 'original reply 2', {
      isForwarded: true,
      messageMetadata: metadata,
    });
    const summaries = new Map([['u1', 'summary one']]); // u2 misses, so exchange 2 falls back

    const { entries: rendered } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      summaries,
    });

    expect(rendered[3]).toBe(entries[3]);
    expect(rendered[3].messageMetadata).toBe(metadata);
  });

  it('clamps the older-exchange count when verbatimExchanges exceeds the exchange count', () => {
    // Five exchanges with a window of seven: the cutoff must clamp at zero
    // rather than going negative, which would slice the window from the END
    // and render the OLDEST exchanges as if they fell outside it.
    const entries = fiveExchanges();

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'user-only',
      verbatimExchanges: 7,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });

    expect(rendered).toBe(entries);
    expect(counts.omitted).toBe(0);
    expect(counts.verbatimExchanges).toBe(5);
  });

  it('a trailing user turn with no reply never counts against the verbatim window', () => {
    // One completed exchange plus a user turn still awaiting a reply. Counting
    // the dangling run as an exchange would make verbatimExchanges: 1 protect
    // only IT, summarizing the single real exchange the window is meant to keep.
    const entries = withDanglingUser(
      [userEntry('u1'), assistantEntry(RESPONDER, 'first reply')],
      'u2'
    );

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map([['u1', 'summary one']]),
    });

    expect(rendered).toBe(entries);
    expect(counts.verbatimExchanges).toBe(1);
    expect(counts.summarized).toBe(0);
  });

  it('a dangling user turn rides in the tail while the window still protects N completed exchanges', () => {
    const entries = twoExchangesPlusDanglingUser();

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'summarized',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map([
        ['u1', 'summary one'],
        ['u2', 'summary two'],
      ]),
    });

    // Exchange 1 is older and summarized; exchange 2 is the protected one and
    // stays verbatim even though u2 carries a usable summary; u3 rides along.
    expect(rendered[1].content).toBe('summary one');
    expect(rendered[1].renderedAs).toBe('summary');
    expect(rendered[3]).toBe(entries[3]);
    expect(rendered[3].content).toBe('original reply 2');
    expect(rendered[4]).toBe(entries[4]);
    expect(counts.summarized).toBe(1);
    expect(counts.verbatimExchanges).toBe(1);
  });

  it("'user-only' drops the older responder turn and keeps the dangling user turn", () => {
    const entries = twoExchangesPlusDanglingUser();

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'user-only',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });

    expect(rendered).toEqual([entries[0], entries[2], entries[3], entries[4]]);
    expect(rendered).not.toContain(entries[1]);
    expect(counts.omitted).toBe(1);
  });

  it("'both' reports the COMPLETED exchange count, excluding the dangling user turn", () => {
    const entries = twoExchangesPlusDanglingUser();

    const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
      mode: 'both',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      summaries: new Map(),
    });

    expect(rendered).toBe(entries);
    expect(counts.verbatimExchanges).toBe(2);
  });
});

describe('collectOlderExchangeTriggerIds', () => {
  it('returns [] when there are no older exchanges', () => {
    const entries = fiveExchanges();
    const ids = collectOlderExchangeTriggerIds(entries, {
      verbatimExchanges: 10,
      responderPersonalityId: RESPONDER,
    });
    expect(ids).toEqual([]);
  });

  it('deduplicates, preserving first-seen order', () => {
    const entries: StructuredHistoryEntry[] = [
      userEntry('u1'),
      userEntry('u1'), // a duplicate id within the same exchange
      assistantEntry(RESPONDER, 'reply'),
      userEntry('u2'),
      assistantEntry(RESPONDER, 'reply 2'),
    ];

    const ids = collectOlderExchangeTriggerIds(entries, {
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
    });

    expect(ids).toEqual(['u1']);
  });

  it('never collects a trailing user turn that has no reply yet', () => {
    // u3 sits in the unterminated run, which is always inside the window — so
    // it is never a summary-lookup trigger id.
    const entries = twoExchangesPlusDanglingUser();

    const ids = collectOlderExchangeTriggerIds(entries, {
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
    });

    expect(ids).toEqual(['u1']);
  });
});

describe('renderSameChannelHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWarn.mockClear();
    mockInfo.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode 'both' never calls fetchSummaries", async () => {
    const entries = fiveExchanges();
    const fetchSummaries = vi.fn();

    const result = await renderSameChannelHistory(entries, {
      mode: 'both',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(fetchSummaries).not.toHaveBeenCalled();
    expect(result).toBe(entries);
  });

  it("mode 'user-only' never calls fetchSummaries", async () => {
    const entries = fiveExchanges();
    const fetchSummaries = vi.fn();

    await renderSameChannelHistory(entries, {
      mode: 'user-only',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(fetchSummaries).not.toHaveBeenCalled();
  });

  it("R1a: 'user-only' drops older exchanges that carry NO user rows at all (no trigger ids)", async () => {
    // Three consecutive responder-only exchanges (no user turn between them),
    // followed by two ordinary user/responder exchanges. verbatimExchanges: 2
    // keeps only the last two, so the three responder-only exchanges are
    // older and must be dropped under 'user-only' — even though they carry
    // zero trigger ids between them.
    const entries: StructuredHistoryEntry[] = [
      assistantEntry(RESPONDER, 'reply A1'),
      assistantEntry(RESPONDER, 'reply A2'),
      assistantEntry(RESPONDER, 'reply A3'),
      userEntry('u4'),
      assistantEntry(RESPONDER, 'reply A4'),
      userEntry('u5'),
      assistantEntry(RESPONDER, 'reply A5'),
    ];
    const fetchSummaries = vi.fn();

    const result = await renderSameChannelHistory(entries, {
      mode: 'user-only',
      verbatimExchanges: 2,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(result).toHaveLength(4);
    expect(result).not.toContain(entries[0]);
    expect(result).not.toContain(entries[1]);
    expect(result).not.toContain(entries[2]);
    expect(result).toEqual([entries[3], entries[4], entries[5], entries[6]]);
    expect(fetchSummaries).not.toHaveBeenCalled();
  });

  it("mode 'summarized' with no older exchanges never calls fetchSummaries", async () => {
    const entries = fiveExchanges();
    const fetchSummaries = vi.fn();

    const result = await renderSameChannelHistory(entries, {
      mode: 'summarized',
      verbatimExchanges: 10,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(fetchSummaries).not.toHaveBeenCalled();
    expect(result).toBe(entries);
  });

  it('returns the input array unchanged when fetchSummaries rejects (fail-soft)', async () => {
    const entries = fiveExchanges();
    const fetchSummaries = vi.fn().mockRejectedValue(new Error('db down'));

    const result = await renderSameChannelHistory(entries, {
      mode: 'summarized',
      verbatimExchanges: 1,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(result).toBe(entries);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('passes exactly the collected trigger ids to fetchSummaries', async () => {
    const entries = fiveExchanges();
    const fetchSummaries = vi.fn().mockResolvedValue(new Map());

    await renderSameChannelHistory(entries, {
      mode: 'summarized',
      verbatimExchanges: 3,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(fetchSummaries).toHaveBeenCalledWith(['u1', 'u2']);
  });

  it("mode 'summarized' skips the fetch but still renders and logs when older exchanges carry no trigger ids", async () => {
    // Three consecutive responder-only exchanges (no user turn between them),
    // then two ordinary exchanges. verbatimExchanges: 2 leaves the three
    // responder-only exchanges older, and between them they carry zero trigger
    // ids — so the query is skipped while the render and its log still run.
    const entries: StructuredHistoryEntry[] = [
      assistantEntry(RESPONDER, 'reply A1'),
      assistantEntry(RESPONDER, 'reply A2'),
      assistantEntry(RESPONDER, 'reply A3'),
      userEntry('u4'),
      assistantEntry(RESPONDER, 'reply A4'),
      userEntry('u5'),
      assistantEntry(RESPONDER, 'reply A5'),
    ];
    const fetchSummaries = vi.fn();

    const result = await renderSameChannelHistory(entries, {
      mode: 'summarized',
      verbatimExchanges: 2,
      responderPersonalityId: RESPONDER,
      fetchSummaries,
    });

    expect(fetchSummaries).not.toHaveBeenCalled();
    expect(result).toEqual(entries);
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'summarized', fallbackVerbatim: 3, inputEntries: 7 }),
      'Same-channel history rendered'
    );
  });
});
