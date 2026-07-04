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
