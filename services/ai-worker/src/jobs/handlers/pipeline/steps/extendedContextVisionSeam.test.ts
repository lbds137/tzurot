/**
 * Seam test: DownloadAttachmentsStep → DependencyStep.
 *
 * These two steps run back-to-back in the real pipeline, and the second reads a
 * distinction the first can erase. `DependencyStep` treats an ABSENT
 * `extendedContextAttachments` as "derive the image list from the raw envelope"
 * — the only path there is, since bot-client stopped shipping that field with
 * the thin envelope. `DownloadAttachmentsStep` writes the field back on every
 * job. If it writes `[]` where the field was absent, extended-context vision is
 * switched off for the whole service, silently.
 *
 * That shipped. Both steps had thorough unit tests and neither could catch it:
 * DependencyStep's fixtures construct the absent-field shape directly (what the
 * BOT sends), and DownloadAttachmentsStep's helper defaults the field to `[]`
 * (so it never fed the undefined that production sends). Only running them in
 * order exercises the handoff — per `02-code-standards.md` § "Assert what
 * crosses a mocked seam", this is the one wiring test that mocks only the
 * external boundary (vision) and lets the chain run for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { DownloadAttachmentsStep } from './DownloadAttachmentsStep.js';
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

async function runBothSteps(job: Job<LLMGenerationJobData>): Promise<GenerationContext> {
  const afterDownload = await new DownloadAttachmentsStep(0).process(contextFor(job));
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
    const result = await runBothSteps(thinEnvelopeJob());

    expect(mockProcessAttachments).toHaveBeenCalled();
    expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    expect(result.preprocessing?.extendedContextAttachments?.[0].description).toBe(
      'a whiteboard covered in equations'
    );
  });

  it('describes envelope-derived images when the job ALSO carries a trigger attachment', async () => {
    // Separate arm: a job with trigger attachments skips the early return, so
    // it reaches the post-download write-back — a second place that can erase
    // the absent-field sentinel.
    const result = await runBothSteps(
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

  it('leaves the field absent after download so the derive path stays reachable', async () => {
    // The mechanism itself, pinned directly: whatever else DownloadAttachmentsStep
    // does, it must not invent `[]` for a field that arrived absent.
    const job = thinEnvelopeJob();
    await new DownloadAttachmentsStep(0).process(contextFor(job));

    expect(job.data.context.extendedContextAttachments).toBeUndefined();
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

    const result = await runBothSteps(job);

    expect(job.data.context.extendedContextAttachments).toEqual([]);
    // …and the envelope's raw list is NOT resurrected in its place.
    expect(mockProcessAttachments).not.toHaveBeenCalled();
    expect(result.preprocessing?.extendedContextAttachments ?? []).toHaveLength(0);
  });
});
