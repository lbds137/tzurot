/**
 * Discord Environment Schemas
 *
 * Zod schemas for Discord environment context and attachment metadata.
 */

import { z } from 'zod';
import { MESSAGE_LIMITS } from '../../constants/message.js';

/**
 * Discord environment context schema
 * Describes where a conversation is taking place
 */
export const discordEnvironmentSchema = z.object({
  type: z.enum(['dm', 'guild']),
  guild: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  category: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  channel: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    topic: z.string().optional(),
  }),
  thread: z
    .object({
      id: z.string(),
      name: z.string(),
      parentChannel: z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      }),
    })
    .optional(),
});

/**
 * Attachment metadata schema
 */
export const attachmentMetadataSchema = z.object({
  /** Discord attachment ID (stable snowflake for caching - preferred over URL hash) */
  id: z.string().optional(),
  url: z.string(),
  originalUrl: z.string().optional(), // Discord CDN URL (preserved for caching)
  contentType: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  isVoiceMessage: z.boolean().optional(),
  duration: z.number().optional(),
  waveform: z.string().optional(),
  /**
   * True when this entry is a Discord STICKER rendered as a synthetic
   * attachment rather than a real message attachment.
   *
   * Load-bearing in three places, which is why it's a field rather than a
   * naming convention: (1) the description is a permanently-reusable artifact
   * keyed by the sticker's immutable snowflake, so the whole dispatch set (key,
   * model, provider, tier) is the INSTANCE's rather than the triggering user's;
   * (2) it renders under a `[Sticker: …]` header instead of `[Image: …]`,
   * because calling it an image misdescribes what the user did; (3) it is what
   * the `stickerVisionEnabled` kill switch filters on, before any download.
   */
  isSticker: z.boolean().optional(),
  /**
   * True when this entry is an image Discord auto-generated as an embed/link
   * preview, minted as a synthetic attachment by `extractEmbedImages` rather
   * than uploaded by anyone.
   *
   * A field rather than a naming convention because consumers must not
   * name-sniff `embed-*` filenames. It gates two things: the `[Link preview: …]`
   * render header — the participant shared a LINK, and Discord generated the
   * image — and the `source="link-preview"` provenance attribute on the
   * reference paths' `<image>` element.
   *
   * Deliberately NOT a shared-asset/funding flag, unlike `isSticker`'s role
   * (1) above: a preview is message-scoped with no stable snowflake key, so
   * its vision spend stays with the triggering user
   * (`MultimodalProcessor`'s `isSharedAsset` keys on `isSticker` alone).
   */
  isEmbedPreview: z.boolean().optional(),
  /**
   * Discord message ID this attachment came from (for inline image descriptions).
   * Optional because attachments in direct/triggering messages don't need source tracking.
   */
  sourceDiscordMessageId: z.string().optional(),
});

/**
 * Guild member info schema
 * Discord server-specific information about a user
 * Used for enriching participant context in prompts
 */
export const guildMemberInfoSchema = z.object({
  /** User's top server roles (sorted by position, excluding @everyone). Limit: MESSAGE_LIMITS.MAX_GUILD_ROLES */
  roles: z.array(z.string()).max(MESSAGE_LIMITS.MAX_GUILD_ROLES),
  /** Display color from highest colored role (hex, e.g., '#FF00FF') */
  displayColor: z.string().optional(),
  /** When user joined the server (ISO 8601) */
  joinedAt: z.string().optional(),
});

// Infer TypeScript types from schemas
export type DiscordEnvironment = z.infer<typeof discordEnvironmentSchema>;

export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;

export type GuildMemberInfo = z.infer<typeof guildMemberInfoSchema>;
