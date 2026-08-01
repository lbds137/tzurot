/**
 * Tests for ExtendedContextResolutionStep.
 *
 * The derivation cases here moved from `DependencyStep.test.ts` when the logic
 * moved. Their EXPECTATIONS changed with the contract, deliberately: the old
 * helper returned `undefined` for the off/empty cases because absence was the
 * signal DependencyStep read. This one returns `[]`, because the whole point of
 * resolving at the front door is that no downstream reader ever sees an absent
 * field again. Same rule (bot-parity cap), different return for "nothing".
 */

import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import type { GenerationContext } from '../types.js';
import {
  ExtendedContextResolutionStep,
  deriveExtendedContextImages,
  resolveExtendedContextImages,
} from './ExtendedContextResolutionStep.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

const img = (id: string): { url: string; contentType: string; id: string } => ({
  url: `https://cdn/${id}.png`,
  contentType: 'image/png',
  id,
});

function contextWith(jobContext: unknown, maxImages: number | undefined = 10): GenerationContext {
  return {
    job: { id: 'job-1', data: { context: jobContext } } as unknown as Job<LLMGenerationJobData>,
    startTime: Date.now(),
    configOverrides: { maxImages },
  } as unknown as GenerationContext;
}

describe('deriveExtendedContextImages', () => {
  it('returns an empty list when the envelope carries no raw image list', () => {
    expect(deriveExtendedContextImages(undefined, 10)).toEqual([]);
  });

  it('returns an empty list when maxImages disables the feature (bot parity)', () => {
    expect(deriveExtendedContextImages([img('a')], 0)).toEqual([]);
    expect(deriveExtendedContextImages([img('a')], undefined)).toEqual([]);
  });

  it('caps to the most recent maxImages via slice(-cap), matching the bot rule', () => {
    expect(deriveExtendedContextImages([img('a'), img('b'), img('c')], 2).map(i => i.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('passes the full list through when under the cap', () => {
    expect(deriveExtendedContextImages([img('a')], 10).map(i => i.id)).toEqual(['a']);
  });
});

describe('resolveExtendedContextImages', () => {
  it('prefers a list the payload shipped', () => {
    const resolved = resolveExtendedContextImages(
      {
        extendedContextAttachments: [img('payload')],
        rawAssemblyInputs: { rawExtendedContextImageAttachments: [img('envelope')] },
      } as never,
      10
    );
    expect(resolved.map(i => i.id)).toEqual(['payload']);
  });

  it('honours an explicitly EMPTY payload list rather than re-deriving', () => {
    // The one meaningful part of the old absent-vs-empty distinction: an empty
    // list the payload shipped on purpose is a decision, and the envelope must
    // not override it. `??` could not express this; `!== undefined` does.
    const resolved = resolveExtendedContextImages(
      {
        extendedContextAttachments: [],
        rawAssemblyInputs: { rawExtendedContextImageAttachments: [img('envelope')] },
      } as never,
      10
    );
    expect(resolved).toEqual([]);
  });

  it('derives from the envelope when the payload omits the field (thin envelope)', () => {
    const resolved = resolveExtendedContextImages(
      { rawAssemblyInputs: { rawExtendedContextImageAttachments: [img('envelope')] } } as never,
      10
    );
    expect(resolved.map(i => i.id)).toEqual(['envelope']);
  });

  it('returns an empty list when neither source has anything', () => {
    expect(resolveExtendedContextImages(undefined, 10)).toEqual([]);
  });
});

describe('ExtendedContextResolutionStep', () => {
  it('writes a real array onto the job context, killing the absent state', async () => {
    const jobContext = {
      kind: 'envelope',
      rawAssemblyInputs: { rawExtendedContextImageAttachments: [img('a')] },
    };
    const context = contextWith(jobContext);

    await new ExtendedContextResolutionStep().process(context);

    expect(
      (jobContext as { extendedContextAttachments?: unknown }).extendedContextAttachments
    ).toEqual([img('a')]);
  });

  it('writes an empty array rather than leaving the field absent when there is nothing', async () => {
    // The invariant the whole task exists for: after this step there is no
    // absent state left for a later `?? []` to erase meaningfully.
    const jobContext = { kind: 'envelope' };
    const context = contextWith(jobContext);

    await new ExtendedContextResolutionStep().process(context);

    expect(
      (jobContext as { extendedContextAttachments?: unknown }).extendedContextAttachments
    ).toEqual([]);
  });

  it('applies the config cap at resolution time', async () => {
    const jobContext = {
      kind: 'envelope',
      rawAssemblyInputs: { rawExtendedContextImageAttachments: [img('a'), img('b'), img('c')] },
    };

    await new ExtendedContextResolutionStep().process(contextWith(jobContext, 2));

    const written = (jobContext as { extendedContextAttachments?: { id: string }[] })
      .extendedContextAttachments;
    expect(written?.map(i => i.id)).toEqual(['b', 'c']);
  });

  it('is a no-op when the job carries no context at all', async () => {
    const context = contextWith(undefined);
    await expect(new ExtendedContextResolutionStep().process(context)).resolves.toBe(context);
  });
});
