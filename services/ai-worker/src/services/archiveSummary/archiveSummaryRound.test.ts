import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { SystemModelInvoker, SystemModelResult } from '../systemModel/systemModelCall.js';
import type { SummarizerMessageInput } from './archiveSummaryPrompt.js';
import { CallTally } from './archiveSummaryFeedback.js';
import { ARCHIVE_SUMMARY_PROMPT_VERSION } from './constants.js';
import {
  callAndParse,
  checkReferent,
  runRegeneration,
  type SummaryRowRef,
} from './archiveSummaryRound.js';

vi.mock('./archiveSummaryStore.js', () => ({
  writeArchiveSummaryFailure: vi.fn().mockResolvedValue(1),
}));
vi.mock('./archiveSummaryUsageLog.js', () => ({
  writeArchiveSummaryUsageLog: vi.fn().mockResolvedValue(undefined),
}));

import { writeArchiveSummaryFailure } from './archiveSummaryStore.js';

const ROW: SummaryRowRef = {
  id: '4f9b0f66-9999-4000-8000-00000000000a',
  content: '{user}: hi there\n{assistant}: hello!',
  personalityId: 'personality-1',
  ownerId: 'owner-1',
};

const INPUT: SummarizerMessageInput = {
  displayName: 'Nova',
  subjectName: 'Jules',
  userText: 'hi there',
  assistantText: 'hello!',
  referenced: null,
};

function makePrisma(): PrismaClient {
  return {} as unknown as PrismaClient;
}

function makeUsage(content: string): SystemModelResult {
  return {
    content,
    tokensIn: 10,
    tokensOut: 10,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
  };
}

function makeInvoker(content: string): SystemModelInvoker {
  return vi.fn().mockResolvedValue(makeUsage(content));
}

describe('callAndParse', () => {
  it('returns the parsed summary on a clean response', async () => {
    const prisma = makePrisma();
    const invoke = makeInvoker('{"summary": "Jules greeted Nova."}');
    const tally = new CallTally();

    const result = await callAndParse({
      prisma,
      invoke,
      prompt: 'prompt',
      row: ROW,
      hash: 'hash',
      tally,
    });

    expect(result).toEqual({ summary: 'Jules greeted Nova.', usage: expect.any(Object) });
    expect(tally.calls).toBe(1);
  });

  it('writes a billed failure and returns null when the response is not JSON', async () => {
    const prisma = makePrisma();
    const invoke = makeInvoker('not json at all');
    const tally = new CallTally();

    const result = await callAndParse({
      prisma,
      invoke,
      prompt: 'prompt',
      row: ROW,
      hash: 'hash',
      tally,
    });

    expect(result).toBeNull();
    expect(writeArchiveSummaryFailure).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        memoryId: ROW.id,
        expectedContent: ROW.content,
        errorClass: 'parse_failure',
        promptVersion: ARCHIVE_SUMMARY_PROMPT_VERSION,
      })
    );
  });

  it('writes a billed failure and returns null when the schema rejects the payload', async () => {
    const prisma = makePrisma();
    const invoke = makeInvoker('{"notSummary": "x"}');
    const tally = new CallTally();

    const result = await callAndParse({
      prisma,
      invoke,
      prompt: 'prompt',
      row: ROW,
      hash: 'hash',
      tally,
    });

    expect(result).toBeNull();
  });

  it('returns superseded when the guarded failure write matched no row', async () => {
    vi.mocked(writeArchiveSummaryFailure).mockResolvedValueOnce(0);
    const prisma = makePrisma();
    const invoke = makeInvoker('not json');
    const tally = new CallTally();

    const result = await callAndParse({
      prisma,
      invoke,
      prompt: 'prompt',
      row: ROW,
      hash: 'hash',
      tally,
    });

    expect(result).toBe('superseded');
  });
});

describe('checkReferent', () => {
  it('returns the dangling list on a clean response', async () => {
    const prisma = makePrisma();
    const invoke = makeInvoker('{"dangling": ["the plan"]}');
    const tally = new CallTally();

    const result = await checkReferent({
      prisma,
      invoke,
      input: INPUT,
      summary: 'a summary',
      row: ROW,
      tally,
    });

    expect(result).toEqual(['the plan']);
  });

  it('degrades to an empty list when the invoker throws', async () => {
    const prisma = makePrisma();
    const invoke = vi.fn().mockRejectedValue(new Error('timeout'));
    const tally = new CallTally();

    const result = await checkReferent({
      prisma,
      invoke,
      input: INPUT,
      summary: 'a summary',
      row: ROW,
      tally,
    });

    expect(result).toEqual([]);
  });

  it('degrades to an empty list when the response fails to parse', async () => {
    const prisma = makePrisma();
    const invoke = makeInvoker('not json');
    const tally = new CallTally();

    const result = await checkReferent({
      prisma,
      invoke,
      input: INPUT,
      summary: 'a summary',
      row: ROW,
      tally,
    });

    expect(result).toEqual([]);
  });
});

describe('runRegeneration', () => {
  it('returns the regenerated summary, running a post-regen referent check for a referenced row', async () => {
    const prisma = makePrisma();
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(makeUsage('{"summary": "Jules confirmed the plan with Nova."}'))
      .mockResolvedValueOnce(makeUsage('{"dangling": []}'));
    const tally = new CallTally();

    const result = await runRegeneration({
      prisma,
      invoke,
      input: { ...INPUT, referenced: 'a prior plan to hike' },
      row: ROW,
      hash: 'hash',
      firstSummary: 'a long first summary',
      firstTokens: 90,
      firstPersonFirstPass: false,
      danglingFirstPass: ['the plan'],
      tally,
    });

    expect(result).not.toBeNull();
    expect(result).not.toBe('superseded');
    if (result !== null && result !== 'superseded') {
      expect(result.finalSummary).toBe('Jules confirmed the plan with Nova.');
      expect(result.danglingAfterRegen).toEqual([]);
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('returns null when the regenerate call fails to parse', async () => {
    const prisma = makePrisma();
    const invoke = makeInvoker('not json');
    const tally = new CallTally();

    const result = await runRegeneration({
      prisma,
      invoke,
      input: INPUT,
      row: ROW,
      hash: 'hash',
      firstSummary: 'a long first summary',
      firstTokens: 90,
      firstPersonFirstPass: false,
      danglingFirstPass: [],
      tally,
    });

    expect(result).toBeNull();
  });

  it('returns superseded when the regenerate call is superseded', async () => {
    vi.mocked(writeArchiveSummaryFailure).mockResolvedValueOnce(0);
    const prisma = makePrisma();
    const invoke = makeInvoker('not json');
    const tally = new CallTally();

    const result = await runRegeneration({
      prisma,
      invoke,
      input: INPUT,
      row: ROW,
      hash: 'hash',
      firstSummary: 'a long first summary',
      firstTokens: 90,
      firstPersonFirstPass: false,
      danglingFirstPass: [],
      tally,
    });

    expect(result).toBe('superseded');
  });
});
