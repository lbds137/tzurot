/**
 * Discord Environment Schemas
 *
 * Zod schemas for Discord environment context and attachment metadata.
 */

import { z } from 'zod';

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

// Infer TypeScript types from schemas
export type DiscordEnvironment = z.infer<typeof discordEnvironmentSchema>;
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
