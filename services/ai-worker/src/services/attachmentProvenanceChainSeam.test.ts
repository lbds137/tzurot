/**
 * Seam test: the attachment-provenance chain, every attachment kind × every path.
 *
 * One table, run through the real ai-worker chain: `planPreprocessing` decides
 * which attachments get a child job (as api-gateway does), simulated child-job
 * results land in Redis for exactly those, then the real `DependencyStep` →
 * `buildConversationContext` → `ConversationInputProcessor` (with the real
 * `ReferencedMessageFormatter` and `PromptBuilder`) → the real renderers. Only
 * the external boundaries are mocked: Redis, the vision model call, the STT call,
 * the attachment byte fetch, and the persona-lookup database.
 *
 * What is NOT real here, so a green cell does not vouch for it:
 * - `DownloadAttachmentsStep` is skipped: originals are hand-shaped (`downloaded`)
 *   as that step leaves them, not produced by it.
 * - `referenceEnricher` is skipped: `isDeduplicated` is set by hand on the quote.
 * - Enrichment and input processing run in guest mode with an empty `visionAuth`,
 *   so the BYOK path is not exercised.
 * - The sticker row depends on the stickers gate at its registry default; the
 *   gate setting is not pinned.
 *
 * Each cell asserts about the assembled prompt text:
 * - visible: the attachment is named under the label its kind should carry, and
 *   the sibling photo's own marker rendered (so an empty render cannot pass);
 * - vocabulary: every bracket header label and every `source=` value in the text
 *   is one `OUTPUT_CONSTRAINTS` explains to the model;
 * - enrichment: the child-job / inline result text reached the prompt for kinds
 *   that have a processor on that path, and is absent where none ran.
 *
 * A cell that is red on today's code is listed in KNOWN_RED with the task that
 * owns the defect, and runs as an explicit pin: it asserts the sibling rendered
 * and the expected output is absent. When the owning fix lands the pin goes red
 * and the entry moves out of KNOWN_RED.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JOB_PREFIXES,
  JobStatus,
  JobType,
  REDIS_KEY_PREFIXES,
} from '@tzurot/common-types/constants/queue';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { filterStickersBySetting } from '@tzurot/common-types/services/stickerVisionGate';
import {
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
  type JobDependency,
  type LLMGenerationJobData,
} from '@tzurot/common-types/types/jobs';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import {
  messageMetadataSchema,
  type ReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { planPreprocessing } from '@tzurot/common-types/utils/attachmentPreprocessingPlan';
import { DependencyStep } from '../jobs/handlers/pipeline/steps/DependencyStep.js';
import { buildConversationContext } from '../jobs/handlers/pipeline/steps/conversationContextBuilder.js';
import type { GenerationContext, PreparedContext } from '../jobs/handlers/pipeline/types.js';
import { formatConversationHistoryAsXml } from '../jobs/utils/conversationUtils.js';
import type { StructuredHistoryEntry } from '../jobs/utils/conversationTypes.js';
import {
  CHROMIUM_AUDIO_WEBM_PREFIX_HEX,
  hexToArrayBuffer,
} from '../test/mocks/fixtures/webmHeaders.js';
import { ConversationInputProcessor } from './ConversationInputProcessor.js';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { PromptBuilder } from './PromptBuilder.js';
import { enrichRagHistory } from './multimodal/ragVisionAuth.js';
import { OUTPUT_CONSTRAINTS } from './prompt/HardcodedConstraints.js';

const mocks = vi.hoisted(() => ({
  getJobResult: vi.fn(),
  describeImage: vi.fn(),
  transcribeAudio: vi.fn(),
  fetchAudioBuffer: vi.fn(),
}));

// EXTERNAL BOUNDARY: Redis — the child-job result store and the vision caches.
// DependencyStep imports this module dynamically; the mock covers that import too.
vi.mock('../redis.js', () => ({
  redisService: { getJobResult: (...args: unknown[]) => mocks.getJobResult(...args) },
  visionDescriptionCache: {
    get: vi.fn().mockResolvedValue(null),
    getCanonical: vi.fn().mockResolvedValue(null),
    getFailure: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
    storeFailure: vi.fn().mockResolvedValue(undefined),
    tryAcquireInflight: vi.fn().mockResolvedValue(true),
    isInflight: vi.fn().mockResolvedValue(false),
    releaseInflight: vi.fn().mockResolvedValue(undefined),
  },
  visionFallbackQuota: { tryConsume: () => Promise.resolve(true) },
}));

// EXTERNAL BOUNDARY: the vision model call. Everything else in the module is real.
vi.mock('./multimodal/VisionProcessor.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./multimodal/VisionProcessor.js')>()),
  describeImage: (...args: unknown[]) => mocks.describeImage(...args),
}));

// EXTERNAL BOUNDARY: the STT call and the attachment byte fetch (the plain-WebM
// sniff fetches through `fetchAudioBuffer`, then inspects the bytes for real).
vi.mock('./multimodal/AudioProcessor.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./multimodal/AudioProcessor.js')>()),
  transcribeAudio: (...args: unknown[]) => mocks.transcribeAudio(...args),
  fetchAudioBuffer: (...args: unknown[]) => mocks.fetchAudioBuffer(...args),
}));

// EXTERNAL BOUNDARY: the persona-hydration database lookup.
vi.mock('./reference/BatchResolvers.js', () => ({
  batchResolveByDiscordIds: vi.fn().mockResolvedValue(new Map()),
}));

const PERSONALITY: LoadedPersonality = {
  id: 'personality-1',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
  systemPrompt: 'x',
  model: 'test-model',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 131072,
  characterInfo: 'x',
  personalityTraits: 'x',
  voiceEnabled: false,
};

const USER_ID = 'user-1';
const QUOTED_MESSAGE_ID = 'quoted-msg-1';
const prisma = {} as unknown as PrismaClient;

/** A signed Discord CDN URL, the shape every real attachment URL has. */
function cdn(file: string): string {
  return `https://cdn.discordapp.com/attachments/111/222/${file}?ex=6a1b2c3d&is=6a1a0000&hm=0f1e2d3c`;
}

const visionOf = (a: AttachmentMetadata): string => `vision of ${a.name}`;
const transcriptOf = (a: AttachmentMetadata): string => `transcript of ${a.name}`;

type RowKey =
  | 'voice'
  | 'vencord-webm-voice'
  | 'mp3'
  | 'audio-only-webm'
  | 'spoiler-image'
  | 'sticker'
  | 'link-preview'
  | 'pdf';

interface Row {
  key: RowKey;
  attachment: AttachmentMetadata;
  /** The bracket header the trigger turn must name it under. */
  triggerHeader: string;
  /** The element opening the quote paths must name it with. */
  referenceElement: string;
  /** Which processor's text the prompt should carry for it: STT, vision, or none (no processor exists). */
  enrichment: 'transcript' | 'vision' | 'none';
  /**
   * Whether that processor's text reaches the prompt on the quote paths. False
   * where the reference plan's voice-only gate means no STT job for a quote
   * (and for `none` rows, which have no processor at all).
   */
  enrichmentOnQuote: boolean;
}

const ROWS: Row[] = [
  {
    key: 'voice',
    attachment: {
      url: cdn('voice-message.ogg'),
      name: 'voice-message.ogg',
      contentType: 'audio/ogg',
      size: 2048,
      isVoiceMessage: true,
      duration: 5.2,
    },
    triggerHeader: '[Voice message: 5.2s]',
    referenceElement: '<voice filename="voice-message.ogg" type="audio/ogg" duration="5.2s"',
    enrichment: 'transcript',
    enrichmentOnQuote: true,
  },
  {
    key: 'vencord-webm-voice',
    attachment: {
      url: cdn('voice-message.webm'),
      name: 'voice-message.webm',
      contentType: 'video/webm',
      size: 2048,
      isVoiceMessage: true,
      duration: 3.5,
    },
    triggerHeader: '[Voice message: 3.5s]',
    referenceElement: '<voice filename="voice-message.webm" type="video/webm" duration="3.5s"',
    enrichment: 'transcript',
    enrichmentOnQuote: true,
  },
  {
    key: 'mp3',
    attachment: { url: cdn('song.mp3'), name: 'song.mp3', contentType: 'audio/mpeg', size: 4096 },
    triggerHeader: '[Audio: song.mp3]',
    // A quote keys voice on the voice flag alone, so a shared music file is a file there.
    referenceElement: '<file filename="song.mp3" type="audio/mpeg"/>',
    enrichment: 'transcript',
    enrichmentOnQuote: false,
  },
  {
    key: 'audio-only-webm',
    attachment: {
      url: cdn('recording.webm'),
      name: 'recording.webm',
      contentType: 'video/webm',
      size: 4096,
    },
    triggerHeader: '[Audio: recording.webm]',
    referenceElement: '<voice filename="recording.webm" type="video/webm" source="shared-file"',
    enrichment: 'transcript',
    enrichmentOnQuote: true,
  },
  {
    key: 'spoiler-image',
    attachment: {
      url: cdn('SPOILER_cat.png'),
      name: 'SPOILER_cat.png',
      contentType: 'image/png',
      size: 1000,
      isSpoiler: true,
    },
    triggerHeader: '[Spoiler image: SPOILER_cat.png]',
    referenceElement: '<image filename="SPOILER_cat.png" type="image/png" spoiler="true"',
    enrichment: 'vision',
    enrichmentOnQuote: true,
  },
  {
    key: 'sticker',
    attachment: {
      url: 'https://media.discordapp.net/stickers/987654321.png',
      name: 'wave',
      contentType: 'image/png',
      size: 1000,
      isSticker: true,
    },
    triggerHeader: '[Sticker: wave]',
    referenceElement: '<image filename="wave" type="image/png" source="sticker"',
    enrichment: 'vision',
    enrichmentOnQuote: true,
  },
  {
    key: 'link-preview',
    attachment: {
      url: 'https://media.discordapp.net/external/abc123/preview.png',
      name: 'embed-1-image.png',
      contentType: 'image/png',
      size: 1000,
      isEmbedPreview: true,
    },
    triggerHeader: '[Link preview: embed-1-image.png]',
    referenceElement: '<image filename="embed-1-image.png" type="image/png" source="link-preview"',
    enrichment: 'vision',
    enrichmentOnQuote: true,
  },
  {
    key: 'pdf',
    attachment: {
      url: cdn('report.pdf'),
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 9000,
    },
    triggerHeader: '[File: report.pdf]',
    referenceElement: '<file filename="report.pdf" type="application/pdf"/>',
    enrichment: 'none',
    enrichmentOnQuote: false,
  },
];

/**
 * Every message also carries an ordinary photo. It is what makes the trigger
 * job path real: with no job-bearing sibling, a lone pdf or plain WebM is
 * expected to produce no child job and leave the turn on the inline path
 * (not verified here: no cell sends a lone pdf or plain WebM). Its own marker
 * doubles as the control that the harness rendered something.
 */
const SIBLING: AttachmentMetadata = {
  url: cdn('photo.png'),
  name: 'photo.png',
  contentType: 'image/png',
  size: 1000,
};

const COLUMNS = [
  'trigger-job',
  'trigger-inline',
  'live-reference',
  'deduped-reference',
  'stored-replay',
] as const;
type Column = (typeof COLUMNS)[number];
type Assertion = 'visible' | 'vocabulary' | 'enrichment';

/**
 * Cells red on today's code, keyed `row|column|assertion`, valued by owning task.
 * Only `visible` and `enrichment` can be pinned red; a vocabulary pin gets added
 * with its first entry.
 */
const KNOWN_RED: Partial<
  Record<`${RowKey}|${Column}|${Exclude<Assertion, 'vocabulary'>}`, string>
> = {
  // The deduped stub names a plain audio-only WebM as a <file> where the live quote renders shared-file voice.
  'audio-only-webm|deduped-reference|visible': 'TASK-1401',
  // The same defect drops the transcript along with the attachment.
  'audio-only-webm|deduped-reference|enrichment': 'TASK-1401',
};

/** The attachment as `DownloadAttachmentsStep` leaves it: bytes inline, CDN URL kept. */
function downloaded(attachment: AttachmentMetadata): AttachmentMetadata {
  return {
    ...attachment,
    url: `data:${attachment.contentType};base64,AAAA`,
    originalUrl: attachment.url,
  };
}

/**
 * What api-gateway queues for one message, with each child job's result stored
 * where the real job would put it. Returns the parent job's dependency list.
 */
function simulateChildJobs(
  attachments: AttachmentMetadata[],
  results: Map<string, unknown>,
  referenceNumber?: number
): JobDependency[] {
  const plan = planPreprocessing(filterStickersBySetting(attachments), { referenceNumber });
  const suffix = referenceNumber === undefined ? '' : `-ref${referenceNumber}`;
  const ref = referenceNumber === undefined ? {} : { sourceReferenceNumber: referenceNumber };
  const dependencies: JobDependency[] = [];
  const add = (jobId: string, type: JobType, result: unknown): void => {
    const key = `${USER_ID}:${jobId}`;
    results.set(key, result);
    dependencies.push({
      jobId,
      type,
      status: JobStatus.Queued,
      resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}${key}`,
    });
  };

  plan.audio.forEach((attachment, i) => {
    const requestId = `req${suffix}-audio-${i}`;
    add(`${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${requestId}`, JobType.AudioTranscription, {
      requestId,
      success: true,
      content: transcriptOf(attachment),
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      ...ref,
    } satisfies AudioTranscriptionResult);
  });
  if (plan.images.length > 0) {
    const requestId = `req${suffix}-image`;
    add(`${JOB_PREFIXES.IMAGE_DESCRIPTION}${requestId}`, JobType.ImageDescription, {
      requestId,
      success: true,
      descriptions: plan.images.map(a => ({ url: a.url, description: visionOf(a) })),
      ...ref,
    } satisfies ImageDescriptionResult);
  }
  return dependencies;
}

function referenceTo(attachments: AttachmentMetadata[], deduplicated: boolean): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: QUOTED_MESSAGE_ID,
    discordUserId: 'user-2',
    authorUsername: 'otheruser',
    authorDisplayName: 'Other User',
    content: 'look at this',
    embeds: '',
    timestamp: '2026-01-01T00:00:00Z',
    locationContext: '',
    attachments,
    ...(deduplicated && { isDeduplicated: true }),
  };
}

/** The quoted message's own history row, present only when the quote is a duplicate of it. */
const QUOTED_HISTORY_ROW: StructuredHistoryEntry = {
  id: 'db-row-1',
  discordMessageId: [QUOTED_MESSAGE_ID],
  role: 'user',
  content: 'look at this',
  createdAt: '2026-01-01T00:00:00Z',
};

interface TurnInputs {
  triggerAttachments: AttachmentMetadata[];
  referencedMessages?: ReferencedMessage[];
  dependencies: JobDependency[];
  history: StructuredHistoryEntry[];
}

/** One generation turn through DependencyStep → context builder → input processing. */
async function runTurn(turn: TurnInputs): Promise<{
  context: ReturnType<typeof buildConversationContext>;
  inputs: Awaited<ReturnType<ConversationInputProcessor['processInputs']>>;
}> {
  const jobContext = {
    userId: USER_ID,
    userName: 'TestUser',
    channelId: 'channel-1',
    attachments: turn.triggerAttachments,
    referencedMessages: turn.referencedMessages,
  } as LLMGenerationJobData['context'];
  const job = {
    id: 'job-1',
    data: {
      requestId: 'req',
      jobType: JobType.LLMGeneration,
      personality: PERSONALITY,
      message: 'what is this?',
      context: jobContext,
      dependencies: turn.dependencies,
      responseDestination: { type: 'discord', channelId: 'channel-1' },
    },
  } as unknown as Job<LLMGenerationJobData>;
  const generation: GenerationContext = { job, startTime: 0 };
  const { preprocessing } = await new DependencyStep().process(generation);

  const prepared = {
    conversationHistory: [],
    rawConversationHistory: turn.history,
    participants: [],
  } as unknown as PreparedContext;
  const context = buildConversationContext(jobContext, prepared, preprocessing, 'req');

  // Mirrors the order read from the pipeline code (history enrichment before the
  // references render); not verified here — no cell varies the order.
  await enrichRagHistory({
    prisma,
    context,
    personality: PERSONALITY,
    visionAuth: {},
    isGuestMode: true,
  });
  const processor = new ConversationInputProcessor(
    new PromptBuilder(),
    new ReferencedMessageFormatter(prisma)
  );
  const inputs = await processor.processInputs(PERSONALITY, 'what is this?', context, {
    isGuestMode: true,
    realMessagesEnabled: false,
  });
  return { context, inputs };
}

function renderTrigger(
  inputs: Awaited<ReturnType<ConversationInputProcessor['processInputs']>>
): string {
  const { message } = new PromptBuilder().buildHumanMessage(
    inputs.userMessage,
    inputs.processedAttachments
  );
  return String(message.content);
}

/** Drive one column for one row; returns the prompt text that column contributes. */
async function renderCell(row: Row, column: Column): Promise<string> {
  const results = new Map<string, unknown>();
  mocks.getJobResult.mockImplementation((key: string) => Promise.resolve(results.get(key) ?? null));
  const message = [row.attachment, SIBLING];

  switch (column) {
    case 'trigger-job': {
      const dependencies = simulateChildJobs(message, results);
      const { inputs } = await runTurn({
        triggerAttachments: message.map(downloaded),
        dependencies,
        history: [],
      });
      return renderTrigger(inputs);
    }
    case 'trigger-inline': {
      const { inputs } = await runTurn({
        triggerAttachments: message.map(downloaded),
        dependencies: [],
        history: [],
      });
      return renderTrigger(inputs);
    }
    case 'live-reference':
    case 'deduped-reference': {
      const deduped = column === 'deduped-reference';
      const { inputs } = await runTurn({
        triggerAttachments: [],
        referencedMessages: [referenceTo(message, deduped)],
        dependencies: simulateChildJobs(message, results, 1),
        history: deduped ? [{ ...QUOTED_HISTORY_ROW }] : [],
      });
      return inputs.referencedMessagesDescriptions ?? '';
    }
    case 'stored-replay': {
      // The live turn's durable references, replayed on a later turn as the
      // trigger row's stored metadata (the quoted message itself is not in
      // that later history, so replay renders the full quote).
      const { inputs } = await runTurn({
        triggerAttachments: [],
        referencedMessages: [referenceTo(message, false)],
        dependencies: simulateChildJobs(message, results, 1),
        history: [],
      });
      // Through the JSONB column and the schema the history read runs over
      // every stored row, which strips any key the schema does not declare.
      const messageMetadata = messageMetadataSchema.parse(
        JSON.parse(JSON.stringify({ referencedMessages: inputs.durableReferences }))
      );
      const storedRow: StructuredHistoryEntry = {
        id: 'db-row-2',
        discordMessageId: ['later-msg-1'],
        role: 'user',
        content: 'what is this?',
        createdAt: '2026-01-01T00:05:00Z',
        messageMetadata,
      };
      const replayContext = { userId: USER_ID, rawConversationHistory: [storedRow] };
      await enrichRagHistory({
        prisma,
        context: replayContext,
        personality: PERSONALITY,
        visionAuth: {},
        isGuestMode: true,
      });
      return formatConversationHistoryAsXml(replayContext.rawConversationHistory, PERSONALITY.name);
    }
  }
}

/**
 * Every `[Label: …]` / `[Label]` header label and every `source="…"` value in the
 * text that `OUTPUT_CONSTRAINTS` does not name — empty when the model is told
 * how to read everything the text emits.
 */
// A dedup stub opens with a bracketed notice that states its own meaning; the
// vocabulary check is for labels the model must interpret from OUTPUT_CONSTRAINTS.
// Every `[Referenced message — …]` variant in RenderableReference.ts shares this prefix.
const SELF_DESCRIBING_NOTICES = ['Referenced message — '];

function unexplainedVocabulary(text: string): string[] {
  // Every capture is reported, whatever it starts with: a label counts as
  // explained only when OUTPUT_CONSTRAINTS quotes it whole, as `"[Label:` or `"[Label]`.
  const labels = [...text.matchAll(/\[([^\]:\n]+)(?=[:\]])/g)]
    .map(m => m[1])
    .filter(label => !SELF_DESCRIBING_NOTICES.some(prefix => label.startsWith(prefix)))
    .filter(
      label =>
        !OUTPUT_CONSTRAINTS.includes(`"[${label}:`) && !OUTPUT_CONSTRAINTS.includes(`"[${label}]`)
    )
    .map(label => `header label "${label}"`);
  const sources = [...text.matchAll(/source="([^"]+)"/g)]
    .map(m => m[1])
    .filter(source => !OUTPUT_CONSTRAINTS.includes(`source="${source}"`))
    .map(source => `source "${source}"`);
  return [...labels, ...sources];
}

function expectedMarker(row: Row, column: Column): string {
  return column === 'trigger-job' || column === 'trigger-inline'
    ? row.triggerHeader
    : row.referenceElement;
}

/** The sibling photo's own marker: proof the harness rendered the message at all. */
function siblingMarker(column: Column): string {
  return column === 'trigger-job' || column === 'trigger-inline'
    ? '[Image: photo.png]'
    : '<image filename="photo.png"';
}

/** The processor-result text a row's attachment should carry into the prompt. */
function enrichmentText(row: Row): string {
  return row.enrichment === 'vision' ? visionOf(row.attachment) : transcriptOf(row.attachment);
}

/**
 * Whether the processor's text reaches the prompt on this path. A pdf has no
 * processor; a non-voice audio file on a quote gets no STT job (the reference
 * plan gate), so its quote renders a bare `<file/>`.
 */
function enrichmentExpected(row: Row, column: Column): boolean {
  if (row.enrichment === 'none') return false;
  const onQuote = column !== 'trigger-job' && column !== 'trigger-inline';
  return !onQuote || row.enrichmentOnQuote;
}

describe('unexplainedVocabulary', () => {
  it('reports a label OUTPUT_CONSTRAINTS never names', () => {
    expect(unexplainedVocabulary('[Hologram: x]')).toEqual(['header label "Hologram"']);
  });

  it('reports a prefix of an explained label', () => {
    expect(unexplainedVocabulary('[Voice]')).toEqual(['header label "Voice"']);
  });

  it('reports a label that starts lowercase or carries punctuation', () => {
    expect(unexplainedVocabulary('[voice message (5.2s)]')).toEqual([
      'header label "voice message (5.2s)"',
    ]);
  });

  it('does not report an explained label', () => {
    expect(unexplainedVocabulary('[Sticker: x]')).toEqual([]);
  });

  it('does not report a self-describing stub notice', () => {
    expect(
      unexplainedVocabulary(
        '[Referenced message — full text in the chat log; its media is described here]'
      )
    ).toEqual([]);
  });
});

describe('attachment-provenance chain seam', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mocks.describeImage.mockImplementation((a: AttachmentMetadata) => Promise.resolve(visionOf(a)));
    mocks.transcribeAudio.mockImplementation((a: AttachmentMetadata) =>
      Promise.resolve({ text: transcriptOf(a) })
    );
    // Only the plain-WebM sniff fetches; these bytes are an audio-only WebM.
    mocks.fetchAudioBuffer.mockResolvedValue(hexToArrayBuffer(CHROMIUM_AUDIO_WEBM_PREFIX_HEX));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('failed child job', () => {
    it('names a voice message whose STT job failed, beside its succeeded sibling', async () => {
      const voice = ROWS.find(row => row.key === 'voice')!.attachment;
      const message = [voice, SIBLING];
      const results = new Map<string, unknown>();
      mocks.getJobResult.mockImplementation((key: string) =>
        Promise.resolve(results.get(key) ?? null)
      );
      const dependencies = simulateChildJobs(message, results);
      const audioJob = dependencies.find(d => d.type === JobType.AudioTranscription)!;
      results.set(`${USER_ID}:${audioJob.jobId}`, {
        requestId: 'req-audio-0',
        success: false,
        failureReason: 'too_long',
        attachmentUrl: voice.url,
        attachmentName: voice.name,
      } satisfies AudioTranscriptionResult);

      const { inputs } = await runTurn({
        triggerAttachments: message.map(downloaded),
        dependencies,
        history: [],
      });
      const text = renderTrigger(inputs);

      expect(text).toContain(siblingMarker('trigger-job'));
      expect(text).toContain(visionOf(SIBLING));
      expect(text).toContain('[Voice message: 5.2s]');
      expect(text).toContain('Audio transcription failed (too_long)');
      expect(unexplainedVocabulary(text)).toEqual([]);
    });
  });

  describe.each(ROWS)('$key', row => {
    describe.each(COLUMNS)('%s', column => {
      // Each cell is written out as a plain `it` (green or known-red pin) so the
      // test linter sees its assertions inside a test block.
      const visibleOwner = KNOWN_RED[`${row.key}|${column}|visible`];
      if (visibleOwner === undefined) {
        it('visible', async () => {
          const text = await renderCell(row, column);
          expect(text).toContain(siblingMarker(column));
          expect(text).toContain(expectedMarker(row, column));
        });
      } else {
        // Pin of today's defect: when the owning fix lands this goes red and the
        // entry moves out of KNOWN_RED.
        it(`visible — known red, owned by ${visibleOwner}`, async () => {
          const text = await renderCell(row, column);
          expect(text).toContain(siblingMarker(column));
          expect(text).not.toContain(expectedMarker(row, column));
        });
      }

      it('vocabulary', async () => {
        const text = await renderCell(row, column);
        expect(text).toContain(siblingMarker(column));
        expect(unexplainedVocabulary(text)).toEqual([]);
      });

      const enrichmentOwner = KNOWN_RED[`${row.key}|${column}|enrichment`];
      if (enrichmentOwner === undefined) {
        it('enrichment', async () => {
          const text = await renderCell(row, column);
          expect(text).toContain(siblingMarker(column));
          expect(text).toContain(visionOf(SIBLING));
          if (enrichmentExpected(row, column)) {
            expect(text).toContain(enrichmentText(row));
          } else {
            expect(text).not.toContain(visionOf(row.attachment));
            expect(text).not.toContain(transcriptOf(row.attachment));
          }
        });
      } else {
        // Pin of today's defect: when the owning fix lands this goes red and the
        // entry moves out of KNOWN_RED.
        it(`enrichment — known red, owned by ${enrichmentOwner}`, async () => {
          const text = await renderCell(row, column);
          expect(text).toContain(siblingMarker(column));
          expect(text).toContain(visionOf(SIBLING));
          expect(text).not.toContain(enrichmentText(row));
        });
      }
    });
  });
});
