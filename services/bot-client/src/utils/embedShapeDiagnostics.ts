/**
 * Embed Shape Diagnostics
 *
 * Permanent observability for an embed that carried no renderable content —
 * whether it rendered nothing at all, or only wrapper metadata (`url`,
 * `type`, `provider`, `color`, `timestamp`) that names where an unfurl came
 * from without showing what it displayed. Logs only key names and the
 * declared type, never any value drawn from the embed.
 */

import type { APIEmbed } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('EmbedShapeDiagnostics');

/**
 * Key names only, sorted for a stable, order-independent read — never values.
 *
 * Shared by the `<embed keys="...">` marker attribute (EmbedParser) and this
 * module's `embedKeys` log field: both are meant to name the SAME key set, so
 * diagnosing a production occurrence means correlating the marker's attribute
 * against the log line's field. Computing the two sets independently would
 * let them silently diverge with nothing to detect it.
 */
export function sortedEmbedKeys(embed: APIEmbed): string[] {
  return Object.keys(embed).sort();
}

/**
 * Log the structural shape of an embed with no renderable content: its key
 * names and declared type, plus the source message's id when available.
 *
 * @param embed - The embed with no renderable content
 * @param messageId - The live Discord message's id carrying this embed, when
 *   available; absent for a stored/snapshot embed with no live message to
 *   identify
 */
export function logEmptyEmbedShape(embed: APIEmbed, messageId?: string): void {
  const embedKeys = sortedEmbedKeys(embed);
  const embedType = embed.type ?? null;

  const fields: { embedKeys: string[]; embedType: string | null; messageId?: string } = {
    embedKeys,
    embedType,
  };
  if (messageId !== undefined) {
    fields.messageId = messageId;
  }

  logger.warn(fields, 'Embed rendered no content');
}
