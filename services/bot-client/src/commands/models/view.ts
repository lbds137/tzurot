/**
 * Models View Handler
 *
 * `/models view <model>` — render the detail card for one model by slug.
 */

import { escapeMarkdown } from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
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
        renderSpec(
          CATALOG.error.notFound('Model', {
            name: escapeMarkdown(modelId),
            hint: 'Try `/models browse` to discover what is available.',
          })
        )
      );
      return;
    }

    // null = wallet fetch failed (keys UNKNOWN) — distinct from an empty Set
    // (confirmed keyless guest). annotateUsability's guest branch relies on
    // the distinction; browse.ts's getActiveProviders makes the same call.
    const activeProviders = walletResult.ok
      ? new Set(walletResult.data.keys.filter(k => k.isActive).map(k => k.provider))
      : null;
    const [annotated] = annotateUsability([model], activeProviders);
    await context.editReply({ embeds: [buildModelCard(annotated)] });
    logger.info({ modelId, usability: annotated.usability }, 'Viewed model card');
  } catch (error) {
    logger.error({ err: error, modelId }, 'Failed to view model');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'model', { operation: 'read' }))
    );
  }
}
