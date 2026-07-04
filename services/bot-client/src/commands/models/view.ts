/**
 * Models View Handler
 *
 * `/models view <model>` — render the detail card for one model by slug.
 */

import { escapeMarkdown } from 'discord.js';
import { modelsViewOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { fetchCatalogModelById, annotateUsability } from '../../utils/modelCatalog.js';
import { buildModelCard } from './card.js';

const logger = createLogger('models-view');

/**
 * Handle /models view <model>
 */
export async function handleView(context: DeferredCommandContext): Promise<void> {
  const modelId = modelsViewOptions(context.interaction).model();

  try {
    const { userClient } = clientsFor(context.interaction);
    const [model, walletResult] = await Promise.all([
      fetchCatalogModelById(modelId),
      userClient.listWalletKeys(),
    ]);

    if (model === null) {
      await context.editReply(
        `❌ No model found matching \`${escapeMarkdown(modelId)}\`. Try \`/models browse\` to discover what's available.`
      );
      return;
    }

    const activeProviders = new Set(
      walletResult.ok ? walletResult.data.keys.filter(k => k.isActive).map(k => k.provider) : []
    );
    const [annotated] = annotateUsability([model], activeProviders);
    await context.editReply({ embeds: [buildModelCard(annotated)] });
    logger.info({ modelId, usability: annotated.usability }, 'Viewed model card');
  } catch (error) {
    logger.error({ err: error, modelId }, 'Failed to view model');
    await context.editReply('❌ Failed to load that model. Please try again.');
  }
}
