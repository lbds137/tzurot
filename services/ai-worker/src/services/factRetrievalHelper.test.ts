import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import type { MemoryRetriever } from './MemoryRetriever.js';
import type { DiagnosticCollector } from './DiagnosticCollector.js';
import { retrieveMemoriesAndFacts } from './factRetrievalHelper.js';
import { retrieveFactsForPrompt } from './factRetrievalHelper.js';
import type { FactRetriever } from './FactRetriever.js';
import type { SimilarFact, LinkedFact } from './extraction/FactStore.js';

function setFlag(value: boolean, splitRenderSlugs: string[] = []): void {
  registerSystemSettings({
    get: (key: string) => {
      if (key === 'factsInPromptEnabled') {
        return value;
      }
      if (key === 'archiveSplitRenderPersonalities') {
        return splitRenderSlugs;
      }
      return undefined;
    },
  } as unknown as SystemSettingsService);
}

afterEach(() => resetSystemSettingsRegistration());

function mockRetriever(): FactRetriever {
  const facts: SimilarFact[] = [
    {
      id: '1',
      statement: 'user likes tea',
      entityTags: [],
      similarity: 0.9,
      isLocked: false,
      tier: 'observed',
    },
  ];
  return { retrieveFacts: vi.fn().mockResolvedValue(facts) } as unknown as FactRetriever;
}

describe('retrieveFactsForPrompt (flag/scope gate)', () => {
  beforeEach(() => setFlag(true));

  it('returns [] and never queries when the flag is off (registry default)', async () => {
    setFlag(false);
    const retriever = mockRetriever();
    expect(await retrieveFactsForPrompt(retriever, 'pers', 'persona', 'q', false)).toEqual([]);
    expect(retriever.retrieveFacts).not.toHaveBeenCalled();
  });

  it('returns [] when no retriever is wired (no memory manager)', async () => {
    expect(await retrieveFactsForPrompt(undefined, 'pers', 'persona', 'q', false)).toEqual([]);
  });

  it('returns [] and never queries when personaId is undefined (LTM skipped this turn)', async () => {
    const retriever = mockRetriever();
    expect(await retrieveFactsForPrompt(retriever, 'pers', undefined, 'q', false)).toEqual([]);
    expect(retriever.retrieveFacts).not.toHaveBeenCalled();
  });

  it('queries scoped to persona×personality when flag on + retriever + personaId present', async () => {
    const retriever = mockRetriever();
    const facts = await retrieveFactsForPrompt(
      retriever,
      'pers',
      'persona',
      'what do i like?',
      false
    );
    expect(retriever.retrieveFacts).toHaveBeenCalledWith('what do i like?', 'pers', 'persona');
    expect(facts.map(f => f.statement)).toEqual(['user likes tea']);
  });

  it('shareLtmAcrossPersonalities drops the personality filter — parity with episode retrieval', async () => {
    const retriever = mockRetriever();
    await retrieveFactsForPrompt(retriever, 'pers', 'persona', 'q', true);
    // null personality = all of the persona's characters, matching
    // MemoryRetriever's widening under the same flag.
    expect(retriever.retrieveFacts).toHaveBeenCalledWith('q', null, 'persona');
  });
});

describe('retrieveMemoriesAndFacts (Step-3 wiring)', () => {
  // Runs the REAL combined function — the RAG service suite mocks it with a
  // delegating stand-in, so this is where the actual wiring is pinned.
  it('threads the retriever result personaId into the fact gate and merges facts', async () => {
    setFlag(true);
    const memoryRetriever = {
      retrieveRelevantMemories: vi.fn().mockResolvedValue({
        memories: [{ pageContent: 'm1', metadata: {} }],
        freshModeEnabled: true,
        personaId: 'persona-7',
      }),
    } as unknown as MemoryRetriever;
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([{ statement: 'likes tea' }]),
    };
    const diagnosticCollector = {
      markMemoryRetrievalStart: vi.fn(),
    } as unknown as DiagnosticCollector;

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1' } as never,
      searchQuery: 'tea preferences',
      context: { userId: 'u1' } as never,
      configOverrides: { shareLtmAcrossPersonalities: true } as never,
      diagnosticCollector,
    });

    expect(diagnosticCollector.markMemoryRetrievalStart).toHaveBeenCalledTimes(1);
    expect(memoryRetriever.retrieveRelevantMemories).toHaveBeenCalledWith(
      { id: 'personality-1' },
      'tea preferences',
      { userId: 'u1' },
      { shareLtmAcrossPersonalities: true }
    );
    // shared scope → personality filter drops (null), personaId from retrieval
    expect(factRetriever.retrieveFacts).toHaveBeenCalledWith('tea preferences', null, 'persona-7');
    expect(result.memories).toHaveLength(1);
    expect(result.freshModeEnabled).toBe(true);
    expect(result.facts).toEqual([{ statement: 'likes tea' }]);
  });

  it('returns empty facts when the retrieval resolved no personaId (LTM skipped)', async () => {
    setFlag(true);
    const memoryRetriever = {
      retrieveRelevantMemories: vi.fn().mockResolvedValue({
        memories: [],
        freshModeEnabled: false,
        // personaId undefined — incognito/focus/no-persona turn
      }),
    } as unknown as MemoryRetriever;
    const factRetriever = { retrieveFacts: vi.fn() };

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
    });

    expect(factRetriever.retrieveFacts).not.toHaveBeenCalled();
    expect(result.facts).toEqual([]);
  });
});

describe('retrieveMemoriesAndFacts — archive split-render stamping (A3)', () => {
  function memoryRetrieverWith(
    memories: { pageContent: string; metadata: Record<string, unknown> }[]
  ) {
    return {
      retrieveRelevantMemories: vi.fn().mockResolvedValue({
        memories,
        freshModeEnabled: false,
        personaId: 'persona-1',
      }),
    } as unknown as MemoryRetriever;
  }

  // @spec MEM-ARCH-010 — kill-switch read: per turn, by personality slug
  it('MEM-ARCH-010: stamps every retrieved doc with archiveRender when the personality slug is listed', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1' } },
      { pageContent: 'm2', metadata: { id: 'mem-2' } },
    ]);
    const linked: LinkedFact[] = [
      { id: 'f-1', statement: 'likes tea', salience: 0.9, sourceMemoryIds: ['mem-1'] },
    ];
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi.fn().mockResolvedValue(linked),
    };

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
    });

    expect(factRetriever.retrieveLinkedFacts).toHaveBeenCalledWith(
      ['mem-1', 'mem-2'],
      'personality-1'
    );
    expect(result.memories[0]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      linkedFacts: [{ id: 'f-1', statement: 'likes tea', salience: 0.9 }],
    });
    expect(result.memories[1]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      linkedFacts: [],
    });
  });

  // @spec MEM-ARCH-007 — a fact linked to several retrieved memories renders in at most one note
  it('MEM-ARCH-007: a fact linked to two retrieved memories is attributed to the more relevant one only', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1' } },
      { pageContent: 'm2', metadata: { id: 'mem-2' } },
    ]);
    const linked: LinkedFact[] = [
      { id: 'f-1', statement: 'likes tea', salience: 0.9, sourceMemoryIds: ['mem-1', 'mem-2'] },
    ];
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi.fn().mockResolvedValue(linked),
    };

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
    });

    expect(result.memories[0]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      linkedFacts: [{ id: 'f-1', statement: 'likes tea', salience: 0.9 }],
    });
    expect(result.memories[1]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      linkedFacts: [],
    });
  });

  // @spec MEM-ARCH-001 — verbatim mode is byte-identical when the slug is not listed
  it('MEM-ARCH-001: stamps nothing when the personality slug is not listed (verbatim mode)', async () => {
    setFlag(true, ['other-slug']);
    const memoryRetriever = memoryRetrieverWith([{ pageContent: 'm1', metadata: { id: 'mem-1' } }]);
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi.fn(),
    };

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
    });

    expect(factRetriever.retrieveLinkedFacts).not.toHaveBeenCalled();
    expect(result.memories[0]?.metadata).toEqual({ id: 'mem-1' });
    expect('archiveRender' in (result.memories[0]?.metadata ?? {})).toBe(false);
  });

  it('splits with linkedFacts: [] when no factRetriever is wired', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([{ pageContent: 'm1', metadata: { id: 'mem-1' } }]);

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: undefined,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
    });

    expect(result.memories[0]?.metadata?.archiveRender).toEqual({ mode: 'split', linkedFacts: [] });
  });

  // @spec MEM-ARCH-011 — a linked-facts fetch failure degrades to no facts, never to verbatim
  it('MEM-ARCH-011: stays in split mode with linkedFacts: [] when the retriever already degraded the fetch failure (see FactRetriever.test.ts for the fail-soft boundary itself)', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([{ pageContent: 'm1', metadata: { id: 'mem-1' } }]);
    // FactRetriever.retrieveLinkedFacts is itself the fail-soft boundary
    // (pinned in FactRetriever.test.ts): a query failure there resolves to
    // [] rather than rejecting. Mirroring that contract here confirms the
    // caller stays in split mode — never verbatim — on the degraded result.
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi.fn().mockResolvedValue([]),
    };

    const result = await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
    });

    expect(result.memories[0]?.metadata?.archiveRender).toEqual({ mode: 'split', linkedFacts: [] });
  });
});
