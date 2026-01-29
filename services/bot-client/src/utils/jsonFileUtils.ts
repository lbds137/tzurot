/**
 * JSON File Utilities
 *
 * Shared utilities for JSON file import/export operations.
 * Used by character and preset import/export commands.
 */

import { AttachmentBuilder } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import type { Attachment } from 'discord.js';

const logger = createLogger('json-file-utils');

// ============================================================================
// TYPES
// ============================================================================

/** Result of JSON file validation */
export interface JsonValidationResult {
  valid: true;
}

/** Result of JSON download and parse */
export interface JsonDownloadResult<T = Record<string, unknown>> {
  data: T;
}

/** Error result for validation/download operations */
export interface JsonErrorResult {
  error: string;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate that an attachment is a JSON file within size limits
 * @param file - Discord attachment to validate
 * @param maxSizeBytes - Maximum file size (default: Discord's 10MB limit)
 * @returns Validation result or error
 */
export function validateJsonFile(
  file: Attachment,
  maxSizeBytes: number = DISCORD_LIMITS.AVATAR_SIZE
): JsonValidationResult | JsonErrorResult {
  const isJson = (file.contentType?.includes('json') ?? false) || file.name.endsWith('.json');

  if (!isJson) {
    return { error: '❌ File must be a JSON file (.json)' };
  }

  if (file.size > maxSizeBytes) {
    const maxSizeMB = (maxSizeBytes / 1024 / 1024).toFixed(0);
    return { error: `❌ File is too large (max ${maxSizeMB}MB)` };
  }

  return { valid: true };
}

// ============================================================================
// DOWNLOAD AND PARSE
// ============================================================================

/**
 * Download and parse a JSON file from a URL
 * @param url - URL to download from
 * @param filename - Filename for logging
 * @returns Parsed JSON data or error
 */
export async function downloadAndParseJson<T = Record<string, unknown>>(
  url: string,
  filename: string
): Promise<JsonDownloadResult<T> | JsonErrorResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const data = JSON.parse(text) as T;
    logger.info(
      { filename, sizeKb: (text.length / 1024).toFixed(2) },
      '[JsonFile] Downloaded and parsed JSON'
    );
    return { data };
  } catch (error) {
    logger.error({ err: error, filename }, '[JsonFile] Failed to download or parse JSON');
    return {
      error: '❌ Failed to parse JSON file. Make sure the file is valid JSON format.',
    };
  }
}

/**
 * Validate, download, and parse a JSON file attachment
 * Combines validation and download into a single operation
 * @param file - Discord attachment to process
 * @param maxSizeBytes - Maximum file size
 * @returns Parsed JSON data or error
 */
export async function validateAndParseJsonFile<T = Record<string, unknown>>(
  file: Attachment,
  maxSizeBytes?: number
): Promise<JsonDownloadResult<T> | JsonErrorResult> {
  const validationResult = validateJsonFile(file, maxSizeBytes);
  if ('error' in validationResult) {
    return validationResult;
  }

  return downloadAndParseJson<T>(file.url, file.name);
}

// ============================================================================
// EXPORT HELPERS
// ============================================================================

/**
 * Create a JSON file attachment for export
 * @param data - Data to export as JSON
 * @param filename - Name for the exported file (without extension)
 * @param description - Description for the attachment
 * @returns AttachmentBuilder ready for Discord
 */
export function createJsonAttachment(
  data: Record<string, unknown>,
  filename: string,
  description: string
): AttachmentBuilder {
  const jsonContent = JSON.stringify(data, null, 2);
  const jsonBuffer = Buffer.from(jsonContent, 'utf-8');

  return new AttachmentBuilder(jsonBuffer, {
    name: `${filename}.json`,
    description,
  });
}

/**
 * Build exportable data by filtering out null/undefined/empty values
 * @param source - Source object to filter
 * @param fields - List of fields to include
 * @returns Filtered object with only non-empty values
 */
export function buildExportData<T extends Record<string, unknown>>(
  source: T,
  fields: readonly string[]
): Record<string, unknown> {
  const exportData: Record<string, unknown> = {};

  for (const field of fields) {
    const value = source[field];
    // Only include non-null, non-undefined, non-empty values
    if (value !== null && value !== undefined && value !== '') {
      exportData[field] = value;
    }
  }

  return exportData;
}
