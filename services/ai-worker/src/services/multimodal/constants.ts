/**
 * Maximum number of vision walks that one call starts at once. "One call" is one
 * message on one path: `processAttachments` (the trigger message), `processAttachmentsParallel`
 * (referenced messages) and `processImageDescriptionJob`. Each call gets its own bound, so
 * concurrency across concurrent jobs on a worker is not limited by this value.
 *
 * Bounds the burst so a message with many images does not trip the provider's
 * concurrency rate limit. Attachments beyond the bound wait their turn; none are dropped.
 * On the `processAttachments` path the bound also covers audio and document processing,
 * not only vision, because that path fans out one mixed list. Audio and documents there share
 * the slots with image walks, so a voice note behind four image walks waits for a slot
 * (head-of-line waiting, accepted).
 */
export const VISION_ATTACHMENT_CONCURRENCY = 4;
