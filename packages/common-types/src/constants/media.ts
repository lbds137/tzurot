/**
 * Media Constants
 *
 * Media processing limits, content types, and attachment types.
 */

/**
 * Media processing limits and quality settings
 */
export const MEDIA_LIMITS = {
  /** Maximum image size before resizing (10MB) */
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,
  /** Target size for resized images (8MB) */
  IMAGE_TARGET_SIZE: 8 * 1024 * 1024,
  /** JPEG quality for resized images (0-100) */
  IMAGE_QUALITY: 85,
} as const;

/**
 * Common content type strings
 */
export const CONTENT_TYPES = {
  /** Image content type prefix */
  IMAGE_PREFIX: 'image/',
  /** Audio content type prefix */
  AUDIO_PREFIX: 'audio/',
  /** Default PNG image type */
  IMAGE_PNG: 'image/png',
  /** JSON content type */
  JSON: 'application/json',
  /** Binary octet stream (generic binary) */
  BINARY: 'application/octet-stream',
} as const;

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
