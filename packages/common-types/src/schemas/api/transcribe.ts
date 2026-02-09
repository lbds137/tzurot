/**
 * Zod schemas for /ai/transcribe API endpoint inputs
 *
 * Validates request bodies for audio transcription operations.
 */

import { z } from 'zod';

const TranscribeAttachmentSchema = z.object({
  url: z.string().min(1, 'url is required'),
  contentType: z.string().min(1, 'contentType is required'),
  name: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

export const TranscribeRequestSchema = z.object({
  attachments: z.array(TranscribeAttachmentSchema).min(1, 'At least one attachment is required'),
});
export type TranscribeRequestInput = z.infer<typeof TranscribeRequestSchema>;
