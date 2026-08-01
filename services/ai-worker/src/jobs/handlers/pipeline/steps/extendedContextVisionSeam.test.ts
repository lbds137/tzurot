/**
 * Seam test: ExtendedContextResolutionStep → DownloadAttachmentsStep → DependencyStep.
 *
 * These steps run back-to-back in the real pipeline and together decide whether
 * extended-context images get described at all. The original bug: the field's
 * ABSENCE was an unnamed instruction ("derive the list from the raw envelope"),
 * and a `?? []` normalization in the middle step erased it — switching the
 * feature off service-wide, silently, because an empty list and a
 * filtered-to-empty list are indistinguishable downstream.
 *
 * That shipped. Both steps had thorough unit tests and neither could catch it:
 * DependencyStep's fixtures construct the absent-field shape directly (what the
 * BOT sends), and DownloadAttachmentsStep's helper defaults the field to `[]`
 * (so it never fed the undefined that production sends). Only running them in
 * order exercises the handoff — per `02-code-standards.md` § "Assert what
 * crosses a mocked seam", this is the one wiring test that mocks only the
 * external boundary (vision) and lets the chain run for real.
 *
 * The convention itself is now gone: the front-door step resolves the field
 * once, so absence carries no meaning for a later step to erase. What this test
 * guards has shifted accordingly — from "do not erase the sentinel" to "the
 * outcome holds across the whole chain, and an explicitly empty list is still
 * honoured rather than re-derived." The outcome cases are unchanged; only the
 * case that pinned the old mechanism was replaced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { DownloadAttachmentsStep } from './DownloadAttachmentsStep.js';
import { ExtendedContextResolutionStep } from './ExtendedContextResolutionStep.js';
import { DependencyStep } from './DependencyStep.js';
import type { GenerationContext } from '../types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

// Sticker vision on (registry default) — the switch has its own tests.
vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  getSystemSetting: () => true,
}));

vi.mock('../../../../redis.js', () => ({
  redisService: { getJobResult: vi.fn() },
  visionDescriptionCache: {
    tryAcquireInflight: vi.fn().mockResolvedValue(true),
    isInflight: vi.fn().mockResolvedValue(false),
    releaseInflight: vi.fn().mockResolvedValue(undefined),
    storeFailure: vi.fn(),
  },
  visionFallbackQuota: { tryConsume: () => Promise.resolve(true) },
}));

// THE external boundary — the only thing mocked. Everything between the two
// steps runs for real.
const mockProcessAttachments = vi.fn();
vi.mock('../../../../services/MultimodalProcessor.js', () => ({
  processAttachments: (...args: unknown[]) => mockProcessAttachments(...args),
  deriveApiKeySource: (): 'system' => 'system',
}));

// The download seam `downloadOne` actually calls. Per-test controllable so the
// all-downloads-fail arm can reject without touching the network.
const mockDownloadImageToDataUrl = vi.fn();
vi.mock('../../../../utils/imageToDataUrl.js', () => ({
  downloadImageToDataUrl: (...args: unknown[]) => mockDownloadImageToDataUrl(...args),
}));

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'p-1',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
  systemPrompt: 'x',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'x',
  personalityTraits: 'x',
  voiceEnabled: false,
};

const RAW_IMAGE = {
  url: 'https://cdn.discordapp.com/attachments/1/2/forwarded.png',
  contentType: 'image/png',
  id: 'raw-img-1',
};

/**
 * A job in the shape production actually sends: the thin envelope carries the
 * raw image list and NO resolved `extendedContextAttachments` field.
 */
function thinEnvelopeJob(
  overrides: { attachments?: LLMGenerationJobData['context']['attachments'] } = {}
): Job<LLMGenerationJobData> {
  return {
    id: 'job-seam-1',
    timestamp: Date.now(),
    data: {
      requestId: 'req-seam',
      jobType: JobType.LLMGeneration,
      personality: TEST_PERSONALITY,
      message: 'what was in that image',
      context: {
        kind: 'envelope',
        userId: 'u-1',
        userName: 'U',
        channelId: 'c-1',
        // Deliberately absent — this is the whole point.
        ...(overrides.attachments !== undefined ? { attachments: overrides.attachments } : {}),
        rawAssemblyInputs: {
          rawMessageContent: 'what was in that image',
          rawExtendedContextImageAttachments: [RAW_IMAGE],
        },
      },
      responseDestination: { type: 'discord', channelId: 'c-1' },
    } as unknown as LLMGenerationJobData,
  } as unknown as Job<LLMGenerationJobData>;
}

function contextFor(job: Job<LLMGenerationJobData>): GenerationContext {
  return {
    job,
    startTime: Date.now(),
    configOverrides: { maxImages: 10 },
  } as unknown as GenerationContext;
}

/**
 * Run the real pipeline prefix that decides extended-context vision, in order.
 *
 * This grew a step: `ExtendedContextResolutionStep` now resolves the list at the
 * front door, and the two steps below consume the result. Adding it here is
 * modelling the pipeline as it is — the assertions in every case are unchanged.
 * Omitting it would leave the harness testing a chain that no longer exists,
 * which is how a seam test starts passing for the wrong reason.
 */
async function runChain(job: Job<LLMGenerationJobData>): Promise<GenerationContext> {
  const afterResolve = await new ExtendedContextResolutionStep().process(contextFor(job));
  const afterDownload = await new DownloadAttachmentsStep(0).process(afterResolve);
  return new DependencyStep().process(afterDownload);
}

describe('extended-context vision survives the DownloadAttachments → Dependency handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadImageToDataUrl.mockResolvedValue({
      dataUrl: 'data:image/png;base64,eA==',
      bytes: 1,
    });
    mockProcessAttachments.mockResolvedValue([
      {
        type: AttachmentType.Image,
        description: 'a whiteboard covered in equations',
        originalUrl: RAW_IMAGE.url,
        metadata: { url: RAW_IMAGE.url, contentType: 'image/png' },
      },
    ]);
  });

  it('describes envelope-derived images on a text-only job', async () => {
    const result = await runChain(thinEnvelopeJob());

    expect(mockProcessAttachments).toHaveBeenCalled();
    expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    expect(result.preprocessing?.extendedContextAttachments?.[0].description).toBe(
      'a whiteboard covered in equations'
    );
  });

  it('puts envelope-derived images through the download gate, not straight to vision', async () => {
    // Asserted directly rather than inferred. Before front-door resolution the
    // field was absent when DownloadAttachmentsStep ran, so extended-context
    // images never entered its grouping and reached vision as raw CDN URLs —
    // no fetch, no queue-age check. The other cases would still pass if that
    // regressed (a skipped download yields no successes, so the vision mock
    // never fires and they fail for a DIFFERENT reason); this one names the
    // behaviour, so a regression says what actually broke.
    await runChain(thinEnvelopeJob());

    expect(mockDownloadImageToDataUrl).toHaveBeenCalledWith(
      RAW_IMAGE.url,
      expect.objectContaining({ contentType: RAW_IMAGE.contentType })
    );
  });

  it('describes envelope-derived images when the job ALSO carries a trigger attachment', async () => {
    // Separate arm: a job with trigger attachments skips the early return, so
    // it reaches the post-download write-back — a second place that can erase
    // the absent-field sentinel.
    const result = await runChain(
      thinEnvelopeJob({
        attachments: [
          {
            url: 'https://cdn.discordapp.com/attachments/9/9/trigger.png',
            contentType: 'image/png',
          },
        ],
      })
    );

    expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
  });

  it('resolves the field at the front door, so nothing downstream reads absence', async () => {
    // Replaces the old "leaves the field absent after download" case, which
    // pinned the CONVENTION rather than the outcome: it asserted the field was
    // still `undefined` after download, because DependencyStep needed that
    // absence as its instruction to derive. The convention is gone, so the
    // invariant inverts — the field is real before any consumer sees it, which
    // is what makes a stray `?? []` harmless instead of catastrophic.
    const job = thinEnvelopeJob();
    const afterResolve = await new ExtendedContextResolutionStep().process(contextFor(job));

    expect(job.data.context.extendedContextAttachments).toEqual([RAW_IMAGE]);

    // And it survives download as a real list, never decaying back to absent.
    await new DownloadAttachmentsStep(0).process(afterResolve);
    expect(job.data.context.extendedContextAttachments).not.toBeUndefined();
  });

  it('honours an explicitly EMPTY payload list instead of re-deriving from the envelope', async () => {
    // The one thing worth keeping from the old absent-vs-empty distinction. An
    // empty list that the payload shipped ON PURPOSE is a decision ("no
    // extended-context images for this job"), and the envelope's raw list must
    // not override it. `??` could not express this once the field was always
    // present; the resolver's explicit `!== undefined` check does.
    const job = thinEnvelopeJob();
    job.data.context.extendedContextAttachments = [];

    const result = await runChain(job);

    expect(mockProcessAttachments).not.toHaveBeenCalled();
    expect(result.preprocessing?.extendedContextAttachments ?? []).toHaveLength(0);
  });

  it('keeps a REALLY-empty list empty when every extended download fails', async () => {
    // The other side of the distinction. A list that arrived present and then
    // lost every member to failed downloads must stay `[]`, not decay to
    // `undefined` — re-deriving from the envelope would only re-attempt the
    // same dead URLs. Absence-preserving must not become absence-inventing.
    mockDownloadImageToDataUrl.mockRejectedValue(new Error('404 from the CDN'));

    const job = thinEnvelopeJob();
    job.data.context.extendedContextAttachments = [
      { url: 'https://cdn.discordapp.com/attachments/3/3/gone.png', contentType: 'image/png' },
    ];

    const result = await runChain(job);

    expect(job.data.context.extendedContextAttachments).toEqual([]);
    // …and the envelope's raw list is NOT resurrected in its place.
    expect(mockProcessAttachments).not.toHaveBeenCalled();
    expect(result.preprocessing?.extendedContextAttachments ?? []).toHaveLength(0);
  });
});
