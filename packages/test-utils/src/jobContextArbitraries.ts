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
  kind?: 'legacy' | 'envelope';
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
  return fc.record({
    url: snowflakeArb.map(id => `https://cdn.example/${id}/file`),
    contentType: fc.constantFrom(...contentTypes),
    name: fc.constantFrom('file.png', 'file.jpg', 'voice.ogg', 'clip.mp3', 'doc.pdf'),
    size: fc.integer({ min: 1, max: 5_000_000 }),
  });
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

/**
 * The schema-TOLERATED legacy shape (kind absent or 'legacy', fat fields
 * inline). Bot-client no longer ships this; the BullMQ schema still accepts
 * it (`.default('legacy')` for old queued jobs), and the worker's ContextStep
 * rejects it at runtime. The suite pins that narrowing explicitly.
 */
export function legacyContextArb(): fc.Arbitrary<ArbJobContext> {
  return fc
    .record({
      userId: snowflakeArb,
      channelId: snowflakeArb,
      explicitKind: fc.boolean(),
      attachments: fc.array(attachmentArb(), { minLength: 0, maxLength: 2 }),
    })
    .map(({ userId, channelId, explicitKind, attachments }) => {
      const context: ArbJobContext = {
        userId,
        channelId,
        ...(explicitKind ? { kind: 'legacy' as const } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      return context;
    });
}

/** Whether the trigger message's own attachments include a describable one. */
export function hasDescribableDirectAttachment(context: ArbJobContext): boolean {
  return (context.attachments ?? []).some(
    att => att.contentType.startsWith('image/') || att.contentType.startsWith('audio/')
  );
}

/**
 * The set of reference numbers a coherent producer MUST emit preprocessing
 * children for: references carrying at least one describable (image/audio)
 * attachment. The oracle half of the no-drop property.
 */
export function describableReferenceNumbers(context: ArbJobContext): number[] {
  const references = context.rawAssemblyInputs?.rawReferencedMessages ?? [];
  return references
    .filter(ref =>
      (ref.attachments ?? []).some(
        att => att.contentType.startsWith('image/') || att.contentType.startsWith('audio/')
      )
    )
    .map(ref => ref.referenceNumber);
}
