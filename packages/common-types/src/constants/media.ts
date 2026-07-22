/**
 * Media Constants
 *
 * Media processing limits, content types, and attachment types.
 */

/**
 * Media processing limits and quality settings
 */
export const MEDIA_LIMITS = {
  /**
   * Maximum image size before resizing (5 MiB). Images at or below this size
   * pass through unchanged; anything larger is resized down toward
   * IMAGE_TARGET_SIZE. Sized so up to 20 attachments per message (Discord
   * trigger + extended context, ~5 MiB each) fit under
   * MAX_AGGREGATE_PAYLOAD_BYTES (100 MiB).
   */
  MAX_IMAGE_SIZE: 5 * 1024 * 1024,
  /**
   * Target size for resized images (4 MiB). Deliberately set BELOW
   * MAX_IMAGE_SIZE to leave a 20% safety margin for JPEG re-encoding
   * variability — `resizeImageIfNeeded` uses sqrt(target/original) for the
   * scale factor, but the actual byte size of the output JPEG depends on
   * content entropy and quality settings, not just dimensions. Without
   * this margin, an image just barely over MAX_IMAGE_SIZE could resize
   * to something STILL over MAX_IMAGE_SIZE (output would pass the
   * aggregate cap but technically violate the per-image invariant).
   */
  IMAGE_TARGET_SIZE: 4 * 1024 * 1024,
  /** JPEG quality for resized images (0-100) */
  IMAGE_QUALITY: 85,
} as const;

/**
 * Avatar processing limits
 */
export const AVATAR_LIMITS = {
  /** Target size for avatar images after optimization (200KB) */
  TARGET_SIZE_KB: 200,
  /** Maximum avatar dimension (512px) */
  MAX_DIMENSION: 512,
} as const;

/**
 * Common content type strings
 */
export const CONTENT_TYPES = {
  /** Image content type prefix */
  IMAGE_PREFIX: 'image/',
  /** Audio content type prefix */
  AUDIO_PREFIX: 'audio/',
  /** PNG image type */
  IMAGE_PNG: 'image/png',
  /** JPEG image type */
  IMAGE_JPG: 'image/jpeg',
  /** WebP image type */
  IMAGE_WEBP: 'image/webp',
  /** WAV audio type */
  AUDIO_WAV: 'audio/wav',
  /** FLAC audio type */
  AUDIO_FLAC: 'audio/flac',
  /** OGG audio type (voice messages) */
  AUDIO_OGG: 'audio/ogg',
  /** MP3 audio type */
  AUDIO_MP3: 'audio/mpeg',
  /** JSON content type */
  JSON: 'application/json',
  /** Binary octet stream (generic binary) */
  BINARY: 'application/octet-stream',
} as const;

/**
 * Voice reference audio limits and allowed MIME types
 */
export const VOICE_REFERENCE_LIMITS = {
  /** Maximum voice reference file size (10MB) */
  MAX_SIZE: 10 * 1024 * 1024,
  /** Allowed MIME types for voice reference audio (includes browser aliases for WAV) */
  ALLOWED_TYPES: [
    'audio/wav',
    'audio/mpeg',
    'audio/ogg',
    'audio/flac',
    'audio/x-wav',
    'audio/wave',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
  ] as readonly string[],
} as const;

/**
 * Nonstandard audio MIME aliases some clients emit, mapped to their canonical
 * type. Normalized at the intake boundary (`voiceReferenceProcessor`) so
 * stored and forwarded types are always canonical members of `ALLOWED_TYPES`.
 * The MP3 family is the repeat offender: `audio/mpeg` is the registered type,
 * but `audio/mp3`, `audio/mpeg3`, and `audio/x-mpeg-3` all appear in the wild
 * (Discord attachments carry whatever the uploading client claimed).
 */
export const AUDIO_MIME_ALIASES: Record<string, string> = {
  'audio/mp3': CONTENT_TYPES.AUDIO_MP3,
  'audio/mpeg3': CONTENT_TYPES.AUDIO_MP3,
  'audio/x-mpeg-3': CONTENT_TYPES.AUDIO_MP3,
};

/**
 * Attachment types for multimodal processing
 */
export enum AttachmentType {
  Image = 'image',
  Audio = 'audio',
}

/**
 * Embed attachment naming patterns
 * Used when converting Discord embeds to attachment metadata
 */
export const EMBED_NAMING = {
  /** Prefix for embed image attachments */
  IMAGE_PREFIX: 'embed-image-',
  /** Prefix for embed thumbnail attachments */
  THUMBNAIL_PREFIX: 'embed-thumbnail-',
  /** Default file extension for embed images */
  DEFAULT_EXTENSION: '.png',
} as const;
