/**
 * Multimodal Content Processor (Orchestrator)
 *
 * Coordinates processing of images and audio to extract text descriptions/transcriptions.
 * Delegates to specialized processors:
 * - VisionProcessor: Image descriptions using vision models
 * - AudioProcessor: Audio transcriptions via ElevenLabs STT or voice-engine
 *
 * This allows multimodal content to be:
 * 1. Stored as text in conversation history (for long-term context)
 * 2. Embedded and retrieved in RAG/LTM systems
 * 3. Used with personality's system prompt (including jailbreaks)
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { withParallelRetry } from '../utils/parallelRetry.js';
import { shouldRetryError, parseApiError } from '../utils/apiErrorParser.js';
import { describeImage, type VisionLoggingContext } from './multimodal/VisionProcessor.js';
import { describeImageWithFallback } from './multimodal/describeImageWithFallback.js';
import type { ResolveVisionConfigOptions } from './multimodal/visionAuthResolver.js';
import { transcribeAudio } from './multimodal/AudioProcessor.js';

const logger = createLogger('MultimodalProcessor');

// Re-export public functions for backwards compatibility
export { describeImage, deriveApiKeySource } from './multimodal/VisionProcessor.js';
export { transcribeAudio } from './multimodal/AudioProcessor.js';

export interface ProcessedAttachment {
  type: AttachmentType;
  description: string; // Text description/transcription for history
  originalUrl: string; // For current turn (send raw media)
  metadata: AttachmentMetadata;
}

/**
 * Auth + diagnostic options for vision/audio processing — bundled to keep param count
 * within max-params and mirror the per-call-site context plumbing.
 */
export interface ProcessAttachmentOptions {
  /** Whether user is in guest mode (uses free models) */
  isGuestMode: boolean;
  /**
   * User's BYOK API key, resolved for the **vision provider** (not the main-model
   * provider). Cross-provider personalities (e.g., main=z.ai-coding, vision=OpenRouter)
   * require the caller to re-resolve the key for the vision provider before invoking
   * `processAttachments` — passing the main-model key here will result in a 401 from
   * the vision provider's API.
   */
  userApiKey?: string;
  /**
   * Resolved STT dispatch (provider + matching BYOK key when applicable).
   * Computed once at the pipeline-step level via SttResolver so per-user
   * preferences are honored on in-band attachment transcription, not just
   * on the dedicated AudioTranscriptionJob path.
   */
  sttDispatch?: SttDispatch;
  /** Diagnostic context for vision-failure logging + source-aware fallback strings */
  loggingContext?: VisionLoggingContext;
  /**
   * Explicit provider for vision calls, derived from the personality's vision model
   * name by the caller (typically via `detectVisionProvider` in `ProviderRouter`).
   * Threaded down to `createChatModel` so cross-provider personalities route correctly.
   */
  visionProvider?: AIProvider;
  /**
   * Pre-resolved vision model name from `resolveVisionConfig`. Forwarded to
   * `describeImage` so the unified resolver's chosen model (which may be a
   * forced free-tier downgrade for a downgraded authenticated user) flows
   * through instead of being re-selected by `selectVisionModel`. Optional; when
   * omitted, `describeImage` self-selects (legacy behavior).
   */
  model?: string;
  /**
   * Phase-4 vision fallback: the auth INPUTS (not a pre-resolved config). When present,
   * image attachments route through `describeImageWithFallback`, which resolves auth
   * per fallback tier and retries down the chain on a retryable failure. When absent
   * (legacy / no-`apiKeyResolver` paths), images use the single-model `describeImage`
   * with the pre-resolved `model`/`visionProvider`/`userApiKey` fields above.
   */
  visionAuth?: ResolveVisionConfigOptions;
}

/**
 * Re-shape vision auth so the call is funded and configured by the INSTANCE
 * rather than by the user who happened to trigger it.
 *
 * A sticker description is keyed by the sticker's immutable snowflake, so it is
 * written once and then read by every user and every character forever. Two
 * consequences follow, and the second is the one that actually decides it:
 *
 * - Billing a BYOK user for a permanent shared artifact is surprising ("why was
 *   I charged for a sticker I sent once?").
 * - More importantly, under first-sighter-pays the artifact's QUALITY becomes a
 *   lottery: whoever sights a sticker first decides, via their key's model, how
 *   well it is described for everyone thereafter. Instance-funded means
 *   instance-CONFIGURED — the operator's vision settings write the permanent
 *   record.
 *
 * Expressed by clearing the user-attributed inputs, which routes the existing
 * resolver down its system-key path. Deliberately NOT a new auth branch: the
 * fallback chain, quota handling, and failure rendering all stay shared.
 */
function asInstanceFundedAuth(base: ResolveVisionConfigOptions): ResolveVisionConfigOptions {
  return {
    ...base,
    isGuestMode: true,
    userId: undefined,
    mainApiKey: undefined,
    mainProvider: undefined,
  };
}

/**
 * The model that writes a permanent shared-asset description.
 *
 * MUST be paired with {@link asInstanceFundedAuth} and passed as an explicit
 * model override, because `isGuestMode` is not only an auth signal in this
 * codebase — `selectVisionModel` reads it as a TIER selector and free-forces
 * the model at every priority level, and `composeVisionTiers` uses it to pick
 * the chain's floor. Setting it for auth purposes alone would therefore
 * collapse every sticker onto the free vision floor, which is the exact
 * opposite of "the operator's settings write the permanent record" — and
 * permanently so, since the description is cached under an immutable snowflake
 * and the canonical cache's tier-promotion can never fire for an asset whose
 * every describe is pinned to the lowest tier.
 *
 * Uses the operator's configured paid floor rather than the personality's own
 * vision model on purpose: the artifact is shared, so ONE operator-chosen model
 * should write it regardless of which character happened to see the sticker
 * first. That also keeps the record reproducible — the same sticker gets the
 * same treatment everywhere.
 *
 * ACCEPTED LIMIT: that guarantee covers the PRIMARY attempt only. If the pinned
 * model fails on a retryable category, the fallback chain's lower tiers still
 * degrade to the free floor (`composeVisionTiers` picks the floor from
 * `isGuestMode`, and the resolver force-downgrades every non-primary tier for a
 * guest). So a sticker whose paid describe fails can still end up with a
 * free-tier description. Deliberate: "free but described" beats "undescribed",
 * and it matches the degradation every other guest-path call already gets.
 */
function sharedAssetVisionModel(): string {
  return getSystemSetting('fallbackVisionModel');
}

/**
 * Process a single attachment (helper function for retry logic)
 */
async function processSingleAttachment(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  options: ProcessAttachmentOptions
): Promise<ProcessedAttachment | null> {
  const {
    isGuestMode,
    userApiKey,
    sttDispatch,
    loggingContext = {},
    visionProvider,
    model,
    visionAuth,
  } = options;
  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    // A shared asset is instance-funded on EVERY path, not just the one the
    // primary caller uses. Deciding it here — rather than at each
    // `processAttachments` call site — is deliberate: several callers omit the
    // `visionAuth` bundle entirely (DependencyStep's legacy branch,
    // ConversationInputProcessor's defensive branch), and a rule enforced at N
    // call sites is a rule that silently stops holding at the N+1th.
    const isSharedAsset = attachment.isSticker === true;

    // EVERY caller-supplied dispatch input is replaced for a shared asset, in
    // one literal rather than field-by-field at the call. The caller resolved
    // all four for the TRIGGERING USER and the PERSONALITY's vision model; a
    // shared asset uses none of that, and overriding only some of them produces
    // mismatched pairs — a personality's provider against the operator's model
    // misroutes to a 401, and a stale key or tier silently un-does the
    // instance-funding rule. Keeping them adjacent is what makes a future
    // addition visibly belong here too.
    const dispatch = isSharedAsset
      ? {
          isGuestMode: true,
          userApiKey: undefined,
          // Let describeImage derive it from the model below via
          // detectVisionProvider — the Phase-4 path resolves it the same way.
          provider: undefined,
          // Not optional polish — see sharedAssetVisionModel: the auth re-shape
          // sets `isGuestMode`, which doubles as a tier selector, so without an
          // explicit model the description lands on the free floor forever.
          model: sharedAssetVisionModel(),
        }
      : { isGuestMode, userApiKey, provider: visionProvider, model };

    // Phase-4 path: when the caller supplied auth inputs, retry down the fallback chain
    // (the wrapper resolves per-tier auth + never throws). Otherwise fall back to the
    // single-model describeImage with the pre-resolved config (legacy / no-resolver path).
    const effectiveAuth =
      visionAuth !== undefined && isSharedAsset ? asInstanceFundedAuth(visionAuth) : visionAuth;
    const description =
      effectiveAuth !== undefined
        ? await describeImageWithFallback(attachment, personality, effectiveAuth, {
            loggingContext,
            model: dispatch.model,
          })
        : await describeImage(attachment, personality, dispatch.isGuestMode, dispatch.userApiKey, {
            skipNegativeCache: true,
            loggingContext,
            provider: dispatch.provider,
            model: dispatch.model,
          });
    logger.info({ name: attachment.name }, 'Processed image attachment');
    return {
      type: AttachmentType.Image,
      description,
      originalUrl: attachment.url,
      metadata: attachment,
    };
  } else if (
    attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ||
    attachment.isVoiceMessage === true
  ) {
    // In-band attachment STT honors the user's resolved STT preference (or
    // the voice-engine fallback when no caller computed one).
    const transcribed = await transcribeAudio(
      attachment,
      sttDispatch ?? { provider: 'voice-engine' }
    );
    logger.info(
      {
        name: attachment.name,
        requestedSttProvider: sttDispatch?.provider ?? 'voice-engine',
        actualSttProvider: transcribed.actualProvider,
      },
      'Processed audio attachment'
    );
    return {
      type: AttachmentType.Audio,
      description: transcribed.text,
      originalUrl: attachment.url,
      metadata: attachment,
    };
  }
  // No processor exists for this content-type (video, documents, archives…).
  // Return an honest stub rather than null: a null here used to fall into the
  // failure-mapping in processAttachments, which fabricated an "Audio
  // transcription failed" description — a soundless video then read to the
  // model (and the user) as a broken voice message.
  logger.info(
    { name: attachment.name, contentType: attachment.contentType },
    'Attachment type unsupported — passing through as file stub'
  );
  return {
    type: AttachmentType.File,
    description: `Attachment type ${attachment.contentType} is not supported — content not analyzed`,
    originalUrl: attachment.url,
    metadata: attachment,
  };
}

/**
 * Process all attachments to extract text descriptions.
 * Uses retryService for consistent parallel retry behavior (RETRY_CONFIG.MAX_ATTEMPTS = 3).
 */
export async function processAttachments(
  attachments: AttachmentMetadata[],
  personality: LoadedPersonality,
  options: ProcessAttachmentOptions
): Promise<ProcessedAttachment[]> {
  const {
    isGuestMode,
    userApiKey,
    sttDispatch,
    loggingContext = {},
    visionProvider,
    model,
    visionAuth,
  } = options;
  logger.info(
    {
      attachmentCount: attachments.length,
      personalityModel: personality.model,
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      isGuestMode,
      hasUserApiKey: userApiKey !== undefined,
      userId: loggingContext.userId,
      apiKeySource: loggingContext.apiKeySource,
      visionProvider,
      visionModel: model,
    },
    'Processing attachments in parallel'
  );

  // Use retryService for consistent retry behavior
  const results = await withParallelRetry(
    attachments,
    attachment =>
      processSingleAttachment(attachment, personality, {
        isGuestMode,
        userApiKey,
        sttDispatch,
        loggingContext,
        visionProvider,
        model,
        visionAuth,
      }),
    {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: 'Attachment processing',
      shouldRetry: shouldRetryError,
    }
  );

  // Separate successes from failures and add fallback descriptions for failures
  const processed: ProcessedAttachment[] = results.map((result, index) => {
    const attachment = attachments[index];

    if (result.status === 'success' && result.value) {
      return result.value;
    }

    // Failed after all retries - provide fallback description with error category
    const isImage = attachment?.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX) ?? false;
    const errorCategory =
      result.error !== undefined ? parseApiError(result.error).category : 'unknown';
    const fallbackDescription = isImage
      ? `Image processing failed after ${result.attempts} attempts (${errorCategory})`
      : `Audio transcription failed after ${result.attempts} attempts (${errorCategory})`;

    logger.warn(
      {
        attachment: attachment?.name ?? 'unknown',
        attempts: result.attempts,
        error: result.error,
      },
      '[MultimodalProcessor] Using fallback description after all retries failed'
    );

    return {
      type: isImage ? AttachmentType.Image : AttachmentType.Audio,
      description: fallbackDescription,
      originalUrl: attachment?.url ?? '',
      metadata: attachment,
    };
  });

  const successCount = results.filter(r => r.status === 'success').length;
  logger.info(
    {
      total: attachments.length,
      succeeded: successCount,
      failed: attachments.length - successCount,
    },
    'Parallel processing complete'
  );

  return processed;
}
