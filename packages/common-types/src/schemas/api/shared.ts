/**
 * Shared Zod schemas for API responses
 *
 * Common schemas used across multiple API endpoints.
 */

import { z } from 'zod';

/**
 * Standard entity permissions schema
 * Used for personalities, LLM configs, personas, etc.
 */
export const EntityPermissionsSchema = z.object({
  /** Whether the requesting user can edit this entity */
  canEdit: z.boolean(),
  /** Whether the requesting user can delete this entity */
  canDelete: z.boolean(),
});
export type EntityPermissionsDto = z.infer<typeof EntityPermissionsSchema>;
