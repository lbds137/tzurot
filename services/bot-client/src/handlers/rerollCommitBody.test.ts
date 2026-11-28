import { describe, it, expect } from 'vitest';
import { REROLL_MAX_THINKING_LENGTH } from '@tzurot/common-types/constants/discord';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { RerollPreflight } from '../services/character/rerollTurn.js';
import type { RerollJobContext } from '../services/JobTracker.js';
import type { BegunEdit } from '../utils/editResponse/discordEdit.js';
import { buildCommitBody, reportedMemory } from './rerollCommitBody.js';

const result = (metadata: Record<string, unknown> = {}): LLMGenerationResult =>
  ({
    requestId: 'req-1',
    success: true,
    content: 'new',
    metadata,
  }) as unknown as LLMGenerationResult;

const ctx = { rowId: 'row-1', attemptId: 'attempt-1' } as unknown as RerollJobContext;
const applied = { ok: true, messageIds: ['m1', 'm2'] } as unknown as BegunEdit;
const preflight = (over: Partial<RerollPreflight> = {}): RerollPreflight =>
  ({ incognito: false, ...over }) as unknown as RerollPreflight;

describe('reportedMemory', () => {
  it('reads the ids the worker reported', () => {
    expect(
      reportedMemory(result({ rerollMemory: { memoryIds: ['a'], pendingIds: ['p'] } }))
    ).toEqual({ newMemoryIds: ['a'], newPendingIds: ['p'] });
  });

  it('is empty when the worker reported none', () => {
    expect(reportedMemory(result())).toEqual({ newMemoryIds: [], newPendingIds: [] });
  });
});

describe('buildCommitBody', () => {
  const build = (r: LLMGenerationResult, current: RerollPreflight = preflight()) =>
    buildCommitBody({ jobId: 'job-1', ctx, result: r, current, content: 'new', applied });

  it('carries the attempt, the applied message ids, the content and the reported memory ids', () => {
    expect(build(result({ rerollMemory: { memoryIds: ['a'], pendingIds: ['p'] } }))).toEqual({
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      content: 'new',
      discordMessageIds: ['m1', 'm2'],
      thinkingContent: null,
      incognito: false,
      newMemoryIds: ['a'],
      newPendingIds: ['p'],
    });
  });

  it('keeps a reasoning trace within the bound and drops one over it', () => {
    expect(build(result({ thinkingContent: 'hmm' })).thinkingContent).toBe('hmm');
    expect(
      build(result({ thinkingContent: 'x'.repeat(REROLL_MAX_THINKING_LENGTH + 1) })).thinkingContent
    ).toBeNull();
  });

  it('takes the incognito state from the new generation, else from the preflight, with a kind only when incognito', () => {
    const fromResult = build(result({ incognitoModeActive: true, incognitoKind: 'session' }));
    expect(fromResult).toMatchObject({ incognito: true, incognitoKind: 'session' });

    const fromPreflight = build(
      result(),
      preflight({ incognito: true, incognitoKind: 'summon' } as Partial<RerollPreflight>)
    );
    expect(fromPreflight).toMatchObject({ incognito: true, incognitoKind: 'summon' });

    const notIncognito = build(
      result({ incognitoModeActive: false }),
      preflight({ incognitoKind: 'summon' } as Partial<RerollPreflight>)
    );
    expect(notIncognito.incognito).toBe(false);
    expect(notIncognito).not.toHaveProperty('incognitoKind');
  });
});
