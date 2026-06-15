/**
 * Model Card
 *
 * Builds the detail embed for a single model, shown by `/models view` and by
 * selecting an item in `/models browse`. Pure (no I/O) so it's directly
 * unit-testable.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS, buildModelInfoUrl, AIProvider } from '@tzurot/common-types';
import { formatContextLength } from '../../utils/modelAutocomplete.js';
import {
  formatCapabilities,
  type ModelUsability,
  type UsableCatalogModel,
} from '../../utils/modelCatalog.js';

/** One-line usability summary keyed by status. */
const USABILITY_LINE: Record<ModelUsability, string> = {
  free: '🆓 Free — available to everyone',
  usable: '✅ You can use this',
  'needs-openrouter-key': '🔒 Needs an OpenRouter key — add one with `/settings apikey set`',
  'needs-zai-key': '🔒 Needs a z.ai coding-plan key — add one with `/settings apikey set`',
  'needs-either-key':
    '🔒 Needs an OpenRouter or z.ai coding-plan key — add one with `/settings apikey set`',
};

/** Format the pricing field, or the BYOK note when no per-token figures exist. */
function formatPricing(model: UsableCatalogModel): string {
  if (!model.hasPricing) {
    // z.ai-only catalog entries have no $ figures; OpenRouter meta/auto-routers
    // have negative pricing because the cost depends on the routed model.
    return model.source === 'zai-catalog'
      ? 'z.ai coding plan — bring your own key'
      : 'Variable — depends on the routed model';
  }
  const inPrice = model.promptPricePerMillion.toFixed(2);
  const outPrice = model.completionPricePerMillion.toFixed(2);
  return `$${inPrice} in / $${outPrice} out (per 1M tokens)`;
}

/** Build the markdown links line (z.ai docs and/or OpenRouter model page). */
function formatLinks(model: UsableCatalogModel): string | null {
  const links: string[] = [];
  if (model.docsUrl !== null) {
    links.push(`[z.ai docs](${model.docsUrl})`);
  }
  if (model.source !== 'zai-catalog') {
    links.push(`[OpenRouter model page](${buildModelInfoUrl(model.id, AIProvider.OpenRouter)})`);
  }
  return links.length > 0 ? links.join(' • ') : null;
}

/**
 * Build the model detail card.
 */
export function buildModelCard(model: UsableCatalogModel): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(model.name)
    .setColor(model.canUse ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.BLURPLE)
    .setDescription(
      [`\`${model.id}\``, '', formatCapabilities(model), USABILITY_LINE[model.usability]].join('\n')
    )
    .addFields(
      {
        name: 'Context',
        value: `${formatContextLength(model.contextLength)} tokens`,
        inline: true,
      },
      { name: 'Pricing', value: formatPricing(model), inline: true }
    );

  if (model.isZaiCoding) {
    embed.addFields({
      name: 'z.ai coding plan',
      value: '⚡ Available on the z.ai GLM coding plan',
      inline: false,
    });
  }

  const links = formatLinks(model);
  if (links !== null) {
    embed.addFields({ name: 'Links', value: links, inline: false });
  }

  return embed;
}
