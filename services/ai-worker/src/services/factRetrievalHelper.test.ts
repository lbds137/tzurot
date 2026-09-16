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

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

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

beforeEach(() => {
  mockLogger.info.mockClear();
  mockConfig.NODE_ENV = 'test';
  mockConfig.LOG_CONTENT_PREVIEWS = false;
});

function mockRetriever(): FactRetriever {
  const facts: SimilarFact[] = [
    {
      id: '1',
      statement: 'user likes tea',
      entityTags: [],
      similarity: 0.9,
      isLocked: false,
      tier: 'observed',
      personalityId: 'pers',
      personalityName: 'TestBot',
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

  it('logs the reserved-fact count carried on the retrieved facts', async () => {
    const facts: SimilarFact[] = [
      {
        id: '1',
        statement: 'a reserved fact',
        entityTags: [],
        similarity: 0,
        isLocked: true,
        tier: 'observed',
        reserved: true,
        personalityId: 'pers',
        personalityName: 'TestBot',
      },
      {
        id: '2',
        statement: 'a similarity-only fact',
        entityTags: [],
        similarity: 0.8,
        isLocked: false,
        tier: 'observed',
        personalityId: 'pers',
        personalityName: 'TestBot',
      },
    ];
    const retriever = {
      retrieveFacts: vi.fn().mockResolvedValue(facts),
    } as unknown as FactRetriever;

    await retrieveFactsForPrompt(retriever, 'pers', 'persona', 'q', false);

    const call = mockLogger.info.mock.calls.find(
      call => call[1] === 'Facts retrieved for prompt injection'
    );
    expect(call).toBeDefined();
    expect((call?.[0] as Record<string, unknown>).reservedFactCount).toBe(1);
    expect((call?.[0] as Record<string, unknown>).factCount).toBe(2);
  });

  it('MEM-ARCH-032: returns only the FactForPrompt fields, dropping the store-layer fields', async () => {
    const facts: SimilarFact[] = [
      {
        id: '1',
        statement: 'user likes tea',
        entityTags: ['x'],
        similarity: 0.9,
        isLocked: true,
        tier: 'corrected',
        reserved: true,
        personalityId: 'pers',
        personalityName: 'TestBot',
      },
    ];
    const retriever = {
      retrieveFacts: vi.fn().mockResolvedValue(facts),
    } as unknown as FactRetriever;

    const result = await retrieveFactsForPrompt(retriever, 'pers', 'persona', 'q', false);

    expect(result).toEqual([
      { id: '1', statement: 'user likes tea', personalityId: 'pers', personalityName: 'TestBot' },
    ]);
    const call = mockLogger.info.mock.calls.find(
      call => call[1] === 'Facts retrieved for prompt injection'
    );
    expect((call?.[0] as Record<string, unknown>).reservedFactCount).toBe(1);
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

  describe('Memory search query logging', () => {
    const searchQuery = 'a distinctive search query for the log-preview pin';

    function memoryRetrievedFields(): Record<string, unknown> {
      const call = mockLogger.info.mock.calls.find(call => call[1] === 'Memory search query');
      expect(call).toBeDefined();
      return call?.[0] as Record<string, unknown>;
    }

    beforeEach(() => {
      setFlag(true);
    });

    it('omits the query preview by default, keeping the always-on length', async () => {
      const memoryRetriever = {
        retrieveRelevantMemories: vi.fn().mockResolvedValue({
          memories: [],
          freshModeEnabled: false,
        }),
      } as unknown as MemoryRetriever;

      await retrieveMemoriesAndFacts({
        memoryRetriever,
        factRetriever: { retrieveFacts: vi.fn() } as never,
        personality: { id: 'personality-1' } as never,
        searchQuery,
        context: {} as never,
        configOverrides: undefined,
      });

      const fields = memoryRetrievedFields();
      expect(fields.queryPreview).toBeUndefined();
      expect(fields.queryLength).toBe(searchQuery.length);
      expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain(searchQuery);
    });

    it('includes the query preview when content previews are enabled', async () => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.LOG_CONTENT_PREVIEWS = true;
      const memoryRetriever = {
        retrieveRelevantMemories: vi.fn().mockResolvedValue({
          memories: [],
          freshModeEnabled: false,
        }),
      } as unknown as MemoryRetriever;

      await retrieveMemoriesAndFacts({
        memoryRetriever,
        factRetriever: { retrieveFacts: vi.fn() } as never,
        personality: { id: 'personality-1' } as never,
        searchQuery,
        context: {} as never,
        configOverrides: undefined,
      });

      const fields = memoryRetrievedFields();
      expect(fields.queryPreview).toBe(searchQuery);
    });
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

describe('retrieveMemoriesAndFacts — archive summary render + lazy enqueue (B2)', () => {
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

  function noopFactRetriever() {
    return {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi.fn().mockResolvedValue([]),
    };
  }

  it('MEM-ARCH-021: carries a stored summary into archiveRender and renders no linked facts for that note', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', assistantSummary: 'A neutral summary.' } },
    ]);
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi
        .fn()
        .mockResolvedValue([
          { id: 'f-1', statement: 'likes tea', salience: 0.9, sourceMemoryIds: ['mem-1'] },
        ]),
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
      linkedFacts: [],
      assistantSummary: 'A neutral summary.',
    });
  });

  it('MEM-ARCH-026: a fact linked to a summarized memory is not attributed to it and flows to the next unsummarized memory that links it', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', assistantSummary: 'A neutral summary.' } },
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
      linkedFacts: [],
      assistantSummary: 'A neutral summary.',
    });
    expect(result.memories[1]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      linkedFacts: [{ id: 'f-1', statement: 'likes tea', salience: 0.9 }],
    });
  });

  it('MEM-ARCH-026: a fact linked ONLY to a summarized memory is attributed to no note', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', assistantSummary: 'A neutral summary.' } },
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

    expect(result.memories[0]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      linkedFacts: [],
      assistantSummary: 'A neutral summary.',
    });
    expect(result.memories[1]?.metadata?.archiveRender).toEqual({ mode: 'split', linkedFacts: [] });
  });

  it("MEM-ARCH-022: enqueues every refresh-eligible doc with reason 'retrieval'", async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', summaryRefreshEligible: true } },
      { pageContent: 'm2', metadata: { id: 'mem-2', summaryRefreshEligible: true } },
    ]);
    const factRetriever = noopFactRetriever();
    const trigger = { enqueue: vi.fn().mockResolvedValue(undefined) };

    await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
      archiveSummaryTrigger: trigger as never,
    });

    expect(trigger.enqueue).toHaveBeenCalledWith({
      memoryId: 'mem-1',
      personalityId: 'personality-1',
      reason: 'retrieval',
    });
    expect(trigger.enqueue).toHaveBeenCalledWith({
      memoryId: 'mem-2',
      personalityId: 'personality-1',
      reason: 'retrieval',
    });
    expect(trigger.enqueue).toHaveBeenCalledTimes(2);
  });

  it('MEM-ARCH-022: enqueues nothing for docs without the eligibility flag', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([{ pageContent: 'm1', metadata: { id: 'mem-1' } }]);
    const factRetriever = noopFactRetriever();
    const trigger = { enqueue: vi.fn().mockResolvedValue(undefined) };

    await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
      archiveSummaryTrigger: trigger as never,
    });

    expect(trigger.enqueue).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-022: enqueues nothing in verbatim mode', async () => {
    setFlag(true, ['other-slug']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', summaryRefreshEligible: true } },
    ]);
    const factRetriever = noopFactRetriever();
    const trigger = { enqueue: vi.fn().mockResolvedValue(undefined) };

    await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
      archiveSummaryTrigger: trigger as never,
    });

    expect(trigger.enqueue).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-022: does not await the enqueue', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', summaryRefreshEligible: true } },
    ]);
    const factRetriever = noopFactRetriever();
    // A never-resolving promise: if the call were awaited, this test would hang.
    const trigger = { enqueue: vi.fn(() => new Promise(() => {})) };

    await expect(
      retrieveMemoriesAndFacts({
        memoryRetriever,
        factRetriever: factRetriever as never,
        personality: { id: 'personality-1', slug: 'nova' } as never,
        searchQuery: 'q',
        context: {} as never,
        configOverrides: undefined,
        archiveSummaryTrigger: trigger as never,
      })
    ).resolves.toBeDefined();
    expect(trigger.enqueue).toHaveBeenCalledTimes(1);
  });

  it('MEM-ARCH-022: an enqueue rejection never propagates', async () => {
    setFlag(true, ['nova']);
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', summaryRefreshEligible: true } },
    ]);
    const factRetriever = noopFactRetriever();
    const trigger = { enqueue: vi.fn().mockRejectedValue(new Error('boom')) };

    await expect(
      retrieveMemoriesAndFacts({
        memoryRetriever,
        factRetriever: factRetriever as never,
        personality: { id: 'personality-1', slug: 'nova' } as never,
        searchQuery: 'q',
        context: {} as never,
        configOverrides: undefined,
        archiveSummaryTrigger: trigger as never,
      })
    ).resolves.toBeDefined();
  });
});

describe('retrieveMemoriesAndFacts — cross-personality shared-LTM notes (MEM-ARCH-031)', () => {
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

  it('MEM-ARCH-031: stamps a foreign doc split with foreign: true even when the slug is NOT listed', async () => {
    setFlag(true, ['other-slug']); // 'nova' is NOT listed
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'own', metadata: { id: 'mem-own', personalityId: 'personality-1' } },
      {
        pageContent: 'foreign',
        metadata: { id: 'mem-foreign', personalityId: 'personality-2', personalityName: 'Emily' },
      },
    ]);
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

    expect(result.memories[0]?.metadata?.archiveRender).toBeUndefined();
    expect(result.memories[1]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      foreign: true,
      linkedFacts: [],
    });
  });

  it('MEM-ARCH-031: links no facts to a foreign doc and never queries linked facts for it', async () => {
    setFlag(true, ['nova']); // listed
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'own', metadata: { id: 'mem-own', personalityId: 'personality-1' } },
      { pageContent: 'foreign', metadata: { id: 'mem-foreign', personalityId: 'personality-2' } },
    ]);
    const linked: LinkedFact[] = [
      {
        id: 'f-1',
        statement: 'a fact about the foreign note',
        salience: 0.9,
        sourceMemoryIds: ['mem-foreign'],
      },
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

    expect(factRetriever.retrieveLinkedFacts).toHaveBeenCalledWith(['mem-own'], 'personality-1');
    expect(result.memories[1]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      foreign: true,
      linkedFacts: [],
    });
  });

  it('MEM-ARCH-031: never enqueues a summary refresh for a foreign doc', async () => {
    setFlag(true, ['nova']); // listed
    const memoryRetriever = memoryRetrieverWith([
      {
        pageContent: 'own',
        metadata: { id: 'mem-own', personalityId: 'personality-1', summaryRefreshEligible: true },
      },
      {
        pageContent: 'foreign',
        metadata: {
          id: 'mem-foreign',
          personalityId: 'personality-2',
          summaryRefreshEligible: true,
        },
      },
    ]);
    const factRetriever = {
      retrieveFacts: vi.fn().mockResolvedValue([]),
      retrieveLinkedFacts: vi.fn().mockResolvedValue([]),
    };
    const trigger = { enqueue: vi.fn().mockResolvedValue(undefined) };

    await retrieveMemoriesAndFacts({
      memoryRetriever,
      factRetriever: factRetriever as never,
      personality: { id: 'personality-1', slug: 'nova' } as never,
      searchQuery: 'q',
      context: {} as never,
      configOverrides: undefined,
      archiveSummaryTrigger: trigger as never,
    });

    expect(trigger.enqueue).toHaveBeenCalledTimes(1);
    expect(trigger.enqueue).toHaveBeenCalledWith({
      memoryId: 'mem-own',
      personalityId: 'personality-1',
      reason: 'retrieval',
    });
  });

  it("MEM-ARCH-031: carries a foreign doc's stored summary into archiveRender", async () => {
    setFlag(true, ['other-slug']); // unlisted — foreign stamping is independent of the allowlist
    const memoryRetriever = memoryRetrieverWith([
      {
        pageContent: 'foreign',
        metadata: {
          id: 'mem-foreign',
          personalityId: 'personality-2',
          assistantSummary: 'A neutral summary.',
        },
      },
    ]);
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

    expect(result.memories[0]?.metadata?.archiveRender).toEqual({
      mode: 'split',
      foreign: true,
      linkedFacts: [],
      assistantSummary: 'A neutral summary.',
    });
  });

  it('MEM-ARCH-031: treats a doc with no personalityId as own', async () => {
    setFlag(true, ['other-slug']); // unlisted
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

    expect(result.memories[0]?.metadata?.archiveRender).toBeUndefined();
    expect(factRetriever.retrieveLinkedFacts).not.toHaveBeenCalled();
  });

  // @spec MEM-ARCH-001 — the guarantee still holds when the doc is own AND the slug is unlisted
  it('MEM-ARCH-031: stamps nothing when the slug is unlisted and no doc is foreign', async () => {
    setFlag(true, ['other-slug']); // unlisted
    const memoryRetriever = memoryRetrieverWith([
      { pageContent: 'm1', metadata: { id: 'mem-1', personalityId: 'personality-1' } },
    ]);
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

    expect(result.memories[0]?.metadata?.archiveRender).toBeUndefined();
    expect(factRetriever.retrieveLinkedFacts).not.toHaveBeenCalled();
  });
});
