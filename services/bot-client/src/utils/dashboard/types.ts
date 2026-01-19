/**
 * Dashboard Framework Types
 *
 * Reusable type definitions for the dashboard pattern used across
 * /character, /profile, /preset, and other entity editing flows.
 */

import type {
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
} from 'discord.js';
import { z } from 'zod';

/**
 * Status indicator for dashboard sections
 */
export enum SectionStatus {
  /** All required fields complete */
  COMPLETE = 'complete',
  /** Has some data but missing required fields */
  PARTIAL = 'partial',
  /** No data set, using defaults */
  DEFAULT = 'default',
  /** No data set, needs attention */
  EMPTY = 'empty',
}

/**
 * Status indicator emoji mapping
 */
export const STATUS_EMOJI: Record<SectionStatus, string> = {
  [SectionStatus.COMPLETE]: '✅',
  [SectionStatus.PARTIAL]: '⚠️',
  [SectionStatus.DEFAULT]: '🔧',
  [SectionStatus.EMPTY]: '❌',
};

/**
 * Field definition for modals
 */
export interface FieldDefinition {
  /** Unique field ID (matches DB column or form field) */
  id: string;
  /** Display label for the field */
  label: string;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Whether field is required */
  required?: boolean;
  /** Short (single line) or paragraph (multi-line) */
  style: 'short' | 'paragraph';
  /** Minimum length */
  minLength?: number;
  /** Maximum length */
  maxLength?: number;
}

/**
 * Section definition for dashboard
 */
export interface SectionDefinition<T> {
  /** Unique section ID */
  id: string;
  /** Display label with emoji */
  label: string;
  /** Description shown in embed */
  description?: string;
  /** Field IDs that belong to this section */
  fieldIds: string[];
  /** Field definitions for the modal */
  fields: FieldDefinition[];
  /** Function to determine section status from entity data */
  getStatus: (data: T) => SectionStatus;
  /** Function to get preview text for embed */
  getPreview: (data: T) => string;
}

/**
 * Action definition for dashboard menu (non-edit actions)
 */
export interface ActionDefinition {
  /** Unique action ID */
  id: string;
  /** Display label */
  label: string;
  /** Description for menu */
  description: string;
  /** Emoji for visual distinction */
  emoji?: string;
  /** Whether this is a destructive action (delete, etc.) */
  destructive?: boolean;
}

/**
 * Dashboard configuration
 */
export interface DashboardConfig<T> {
  /** Entity type identifier (character, profile, preset) */
  entityType: string;
  /** Function to generate dashboard title */
  getTitle: (data: T) => string;
  /** Function to generate dashboard description */
  getDescription?: (data: T) => string;
  /** Section definitions */
  sections: SectionDefinition<T>[];
  /** Additional actions (visibility, delete, etc.) */
  actions?: ActionDefinition[];
  /** Function to generate footer text */
  getFooter?: (data: T) => string;
  /** Embed color */
  color?: number;
}

/**
 * Active dashboard session state
 */
export interface DashboardSession<T> {
  /** Entity type */
  entityType: string;
  /** Entity ID being edited */
  entityId: string;
  /** User who owns this session */
  userId: string;
  /** Current entity data */
  data: T;
  /** Message ID of the dashboard embed */
  messageId: string;
  /** Channel ID where dashboard is displayed */
  channelId: string;
  /** Timestamp when session was created */
  createdAt: Date;
  /** Timestamp of last activity */
  lastActivityAt: Date;
}

/**
 * Result of a dashboard update operation
 */
export interface DashboardUpdateResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Handler function types for dashboard interactions
 */
export type EditSelectionHandler<T> = (
  interaction: StringSelectMenuInteraction,
  session: DashboardSession<T>,
  sectionId: string
) => Promise<void>;

export type ModalSubmitHandler<T> = (
  interaction: ModalSubmitInteraction,
  session: DashboardSession<T>,
  sectionId: string,
  values: Record<string, string>
) => Promise<DashboardUpdateResult<T>>;

export type ActionHandler<T> = (
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  session: DashboardSession<T>,
  actionId: string
) => Promise<void>;

/**
 * Data persistence interface for dashboard entities
 */
export interface DashboardRepository<T> {
  /** Fetch entity by ID */
  findById(id: string): Promise<T | null>;
  /** Create new entity */
  create(data: Partial<T>): Promise<T>;
  /** Update entity */
  update(id: string, data: Partial<T>): Promise<T>;
  /** Delete entity */
  delete(id: string): Promise<void>;
}

/**
 * Delimiter used for dashboard custom IDs
 * Using :: because both UUIDs and slugs contain - which breaks simple splitting
 */
const CUSTOM_ID_DELIMITER = '::';

/**
 * Type guard for checking if interaction is from a dashboard
 *
 * CustomId format: {entityType}::{action}::{entityId?}::{sectionId?}
 * This puts entityType first so Discord.js CommandHandler routes correctly
 */
export function isDashboardInteraction(customId: string, entityType: string): boolean {
  return customId.startsWith(`${entityType}${CUSTOM_ID_DELIMITER}`);
}

/**
 * Parse dashboard custom ID to extract components
 *
 * Format: {entityType}::{action}::{entityId}::{sectionId}
 * Examples:
 *   character::seed (seed modal)
 *   character::menu::abc12345-def6-7890-abcd-ef1234567890 (select menu with UUID)
 *   character::modal::abc12345-def6-7890-abcd-ef1234567890::identity (section modal)
 *   character::close::abc12345-def6-7890-abcd-ef1234567890 (close button)
 */
export function parseDashboardCustomId(customId: string): {
  entityType: string;
  action: string;
  entityId?: string;
  sectionId?: string;
} | null {
  const parts = customId.split(CUSTOM_ID_DELIMITER);
  if (parts.length < 2) {
    return null;
  }

  return {
    entityType: parts[0],
    action: parts[1],
    entityId: parts[2],
    sectionId: parts[3],
  };
}

/**
 * Build dashboard custom ID
 *
 * Format: {entityType}::{action}::{entityId?}::{sectionId?}
 */
export function buildDashboardCustomId(
  entityType: string,
  action: string,
  entityId?: string,
  sectionId?: string
): string {
  const parts = [entityType, action];
  if (entityId !== undefined && entityId.length > 0) {
    parts.push(entityId);
  }
  if (sectionId !== undefined && sectionId.length > 0) {
    parts.push(sectionId);
  }
  return parts.join(CUSTOM_ID_DELIMITER);
}

/**
 * Schema for session data stored in Redis
 *
 * Dates are stored as ISO strings since Redis stores everything as strings.
 * The data field is kept as unknown since different entity types have different data shapes.
 */
export const StoredSessionSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  userId: z.string(),
  data: z.unknown(),
  messageId: z.string(),
  channelId: z.string(),
  createdAt: z.string(), // ISO timestamp
  lastActivityAt: z.string(), // ISO timestamp
});

/**
 * Type for stored session data (before Date conversion)
 */
export type StoredSession = z.infer<typeof StoredSessionSchema>;
