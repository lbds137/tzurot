/**
 * Deny List Subcommand
 *
 * Lists all denylist entries. Bot owner only.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { adminFetch } from '../../utils/adminApiClient.js';

const logger = createLogger('deny-list');

interface DenylistEntryResponse {
  type: string;
  discordId: string;
  scope: string;
  scopeId: string;
  reason: string | null;
}

export async function handleList(context: DeferredCommandContext): Promise<void> {
  if (!(await requireBotOwnerContext(context))) {
    return;
  }

  const typeFilter = context.getOption<string>('type');

  try {
    const query = typeFilter !== null ? `?type=${encodeURIComponent(typeFilter)}` : '';
    const response = await adminFetch(`/admin/denylist${query}`, {
      userId: context.user.id,
    });

    if (!response.ok) {
      await context.editReply('❌ Failed to fetch denylist entries.');
      return;
    }

    const data = (await response.json()) as { entries: DenylistEntryResponse[] };
    const { entries } = data;

    if (entries.length === 0) {
      await context.editReply('No denylist entries found.');
      return;
    }

    const lines = entries.map((e, i) => {
      const scopeInfo = e.scope === 'BOT' ? 'Bot-wide' : `${e.scope}:${e.scopeId}`;
      const reason = e.reason !== null ? ` — ${e.reason}` : '';
      return `${String(i + 1)}. \`${e.discordId}\` (${e.type}) [${scopeInfo}]${reason}`;
    });

    const header = `**Denylist Entries** (${String(entries.length)}):\n`;
    let message = header + lines.join('\n');

    // Truncate for Discord's 2000 char limit
    if (message.length > 1900) {
      const truncated = lines.slice(0, 20).join('\n');
      message = `${header}${truncated}\n... and ${String(entries.length - 20)} more`;
    }

    await context.editReply(message);
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to list entries');
    await context.editReply('❌ Failed to fetch denylist entries.');
  }
}
