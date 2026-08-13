/**
 * fast-check arbitraries for the bot→gateway→worker job-context wire shapes.
 *
 * Hand-rolled rather than schema-derived: the maintained Zod-4 bridge is
 * pre-1.0 and churny, and these few shapes are the whole contract surface.
 * Bounded small (short strings, ≤3 references, ≤2 attachments each) so
 * property runs stay fast and shrunk counterexamples stay readable.
 *
 * Used by the job-payload contract suite (deterministic-test-quality theme):
 * properties over these arbitraries pin the dropped-wire-shape invariant —
 * every valid context shape must produce a coherent job chain and survive
 * the worker pipeline's gates (the seam class where a new thin payload
 * shape once shipped broken under green fat-shape coverage).
 */

import fc from 'fast-check';

/**
 * Structural mirror of the wire shapes (same posture as seed.ts): this
 * package deliberately stays off `@tzurot/common-types` as a dependency, so
 * the arbitraries return structurally-compatible objects and the consuming
 * property tests (which DO import the real schemas) assert acceptance there.
 */
export interface ArbAttachment {
  url: string;
  contentType: string;
  name: string;
  size: number;
  /**
   * Always present on real producer output: bot-client stamps this on every
   * attachment it emits. True only for genuine Discord voice messages, which
   * the producer detects as `audio/*` carrying a duration.
   */
  isVoiceMessage: boolean;
}

export interface ArbReferencedMessage {
  referenceNumber: number;
  discordMessageId: string;
  discordUserId: string;
  authorUsername: string;
  authorDisplayName: string;
  content: string;
  embeds: string;
  timestamp: string;
  locationContext: string;
  attachments?: ArbAttachment[];
}

export interface ArbJobContext {
  userId: string;
  channelId: string;
  guildId?: string;
  kind?: 'envelope';
  attachments?: ArbAttachment[];
  rawAssemblyInputs?: {
    rawMessageContent: string;
    rawReferencedMessages?: ArbReferencedMessage[];
    rawExtendedContextImageAttachments?: ArbAttachment[];
  };
}

/** Discord-snowflake-ish id: digits only, stable shape for cache-key rules. */
const snowflakeArb = fc
  .integer({ min: 100_000, max: 999_999 })
  .map(n => `10000000000${n.toString()}`);

/** Short human-ish text — long enough to be realistic, short enough to shrink well. */
const shortTextArb = fc.string({ minLength: 1, maxLength: 40 });

/** Attachment content types the producer categorizes into preprocessing jobs. */
const DESCRIBABLE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'audio/ogg', 'audio/mpeg'] as const;
/** Content types the producer deliberately ignores (no child job). */
const IGNORED_CONTENT_TYPES = ['application/pdf', 'text/plain', 'video/mp4'] as const;

export interface AttachmentArbOptions {
  /** Restrict to describable (image/audio) types; default mixes in ignored types. */
  describableOnly?: boolean;
}

/** Attachment metadata as carried on referenced messages / direct attachments. */
export function attachmentArb(options: AttachmentArbOptions = {}): fc.Arbitrary<ArbAttachment> {
  const contentTypes =
    options.describableOnly === true
      ? DESCRIBABLE_CONTENT_TYPES
      : [...DESCRIBABLE_CONTENT_TYPES, ...IGNORED_CONTENT_TYPES];
  return fc
    .record({
      url: snowflakeArb.map(id => `https://cdn.example/${id}/file`),
      contentType: fc.constantFrom(...contentTypes),
      name: fc.constantFrom('file.png', 'file.jpg', 'voice.ogg', 'clip.mp3', 'doc.pdf'),
      size: fc.integer({ min: 1, max: 5_000_000 }),
      voiceFlag: fc.boolean(),
    })
    .map(({ voiceFlag, ...rest }) => ({
      ...rest,
      // Correlated with contentType rather than free: the producer derives this
      // from `audio/*` plus a duration, so a non-audio attachment flagged as a
      // voice message is a combination bot-client cannot emit. Both values stay
      // reachable on audio types, which is where the STT gate discriminates.
      isVoiceMessage: rest.contentType.startsWith('audio/') && voiceFlag,
    }));
}

/**
 * A raw referenced-message snapshot (the thin envelope's reference carrier).
 * `referenceNumber` is provided by the caller so a list can guarantee
 * crawl-order uniqueness — the producer keys preprocessing children on it.
 */
export function rawReferencedMessageArb(
  referenceNumber: number
): fc.Arbitrary<ArbReferencedMessage> {
  return fc.record(
    {
      referenceNumber: fc.constant(referenceNumber),
      discordMessageId: snowflakeArb,
      discordUserId: snowflakeArb,
      authorUsername: shortTextArb,
      authorDisplayName: shortTextArb,
      content: shortTextArb,
      embeds: fc.constant(''),
      timestamp: fc.constant('2026-01-01T00:00:00.000Z'),
      locationContext: fc.constant('Server > #channel'),
      attachments: fc.array(attachmentArb(), { minLength: 0, maxLength: 2 }),
    },
    {
      requiredKeys: [
        'referenceNumber',
        'discordMessageId',
        'discordUserId',
        'authorUsername',
        'authorDisplayName',
        'content',
        'embeds',
        'timestamp',
        'locationContext',
      ],
    }
  );
}

/**
 * A valid thin-envelope JobContext — the ONLY shape bot-client ships
 * post-cutover: `kind: 'envelope'` with rawAssemblyInputs carrying the
 * re-derivable inputs (references, extended-context images) instead of the
 * fat legacy fields.
 */
export function envelopeContextArb(): fc.Arbitrary<ArbJobContext> {
  return fc
    .record({
      userId: snowflakeArb,
      channelId: snowflakeArb,
      guildId: fc.option(snowflakeArb, { nil: undefined }),
      rawMessageContent: shortTextArb,
      referenceCount: fc.integer({ min: 0, max: 3 }),
      // The trigger message's OWN attachments — the most common attachment
      // path, distinct from referenced-message attachments, and carried
      // top-level even under the thin envelope.
      directAttachments: fc.array(attachmentArb(), { minLength: 0, maxLength: 2 }),
      extendedContextImages: fc.array(attachmentArb({ describableOnly: true }), {
        minLength: 0,
        maxLength: 2,
      }),
    })
    .chain(
      ({
        userId,
        channelId,
        guildId,
        rawMessageContent,
        referenceCount,
        directAttachments,
        extendedContextImages,
      }) =>
        fc
          .tuple(
            ...Array.from({ length: referenceCount }, (_, i) => rawReferencedMessageArb(i + 1))
          )
          .map(references => {
            const context: ArbJobContext = {
              userId,
              channelId,
              ...(guildId !== undefined ? { guildId } : {}),
              kind: 'envelope',
              ...(directAttachments.length > 0 ? { attachments: directAttachments } : {}),
              rawAssemblyInputs: {
                rawMessageContent,
                ...(references.length > 0 ? { rawReferencedMessages: references } : {}),
                ...(extendedContextImages.length > 0
                  ? { rawExtendedContextImageAttachments: extendedContextImages }
                  : {}),
              },
            };
            return context;
          })
    );
}

/** Whether the trigger message's own attachments include a describable one. */
// The 'image/'/'audio/' literals here and below deliberately mirror
// CONTENT_TYPES.IMAGE_PREFIX / AUDIO_PREFIX without importing common-types
// (greppability aid; keeps this package dependency-light).
export function hasDescribableDirectAttachment(context: ArbJobContext): boolean {
  return (context.attachments ?? []).some(
    att => att.contentType.startsWith('image/') || att.contentType.startsWith('audio/')
  );
}

/**
 * The set of reference numbers a coherent producer MUST emit preprocessing
 * children for: references carrying at least one image attachment, or an audio
 * attachment that is a voice message. The oracle half of the no-drop property.
 */
export function describableReferenceNumbers(context: ArbJobContext): number[] {
  const references = context.rawAssemblyInputs?.rawReferencedMessages ?? [];
  return references
    .filter(ref =>
      (ref.attachments ?? []).some(att =>
        att.contentType.startsWith('audio/')
          ? // Reference-path audio dispatches STT only for a genuine voice
            // message: an ordinary audio upload on a referenced message renders
            // as a bare file, so its transcript would be billed and discarded.
            att.isVoiceMessage === true
          : att.contentType.startsWith('image/')
      )
    )
    .map(ref => ref.referenceNumber);
}
