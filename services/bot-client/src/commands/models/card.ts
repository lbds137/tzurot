/**
 * Model Card
 *
 * Builds the detail embed for a single model, shown by `/models view` and by
 * selecting an item in `/models browse`. Pure (no I/O) so it's directly
 * unit-testable.
 *
 * Layout: a provider author line, a hyperlinked title, a compact slug +
 * capabilities + status description (usability speaks through the badge-coded
 * status line — detail cards stay BLURPLE per §2.3), and a single short inline
 * field row (Context · Price · Access). No thumbnail — pure text/emoji, so
 * there are no image assets to host.
 */

import { EmbedBuilder } from 'discord.js';
import { buildModelInfoUrl, AIProvider } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { formatContextLength } from '../../utils/modelAutocomplete.js';
import {
  formatCapabilities,
  type ModelUsability,
  type UsableCatalogModel,
} from '../../utils/modelCatalog.js';

/** Bold, badge-prefixed status line for the description (glyphs from the registry). */
const USABILITY_LINE: Record<ModelUsability, string> = {
  free: `${AUTOCOMPLETE_BADGES.FREE} **Free** — available to everyone`,
  usable: `${AUTOCOMPLETE_BADGES.ACTIVE} **You can use this**`,
  'needs-openrouter-key': `${AUTOCOMPLETE_BADGES.NEEDS_KEY} **Needs an OpenRouter key** — add one with \`/settings apikey set\``,
  'needs-zai-key': `${AUTOCOMPLETE_BADGES.NEEDS_KEY} **Needs a z.ai coding-plan key** — add one with \`/settings apikey set\``,
  'needs-either-key': `${AUTOCOMPLETE_BADGES.NEEDS_KEY} **Needs an OpenRouter or z.ai key** — add one with \`/settings apikey set\``,
  unknown: `${AUTOCOMPLETE_BADGES.UNVERIFIED} **Couldn't verify your keys** — try again in a moment`,
};

/** Short one-word(ish) access category for the inline field. */
const ACCESS_LABEL: Record<ModelUsability, string> = {
  free: 'Free',
  usable: 'Ready',
  'needs-openrouter-key': 'OpenRouter key',
  'needs-zai-key': 'z.ai key',
  'needs-either-key': 'OpenRouter / z.ai',
  unknown: 'Unverified',
};

/** Inline separator shared by the capability line and the links line. */
const SEP = '  ·  ';

/** A z.ai-only model (z.ai catalog, not on OpenRouter) — no $ pricing, no OR page. */
function isZaiOnly(model: UsableCatalogModel): boolean {
  return model.source === 'zai-catalog';
}

/** Split the OpenRouter "Provider: Model" name into a provider + bare title. */
function splitName(model: UsableCatalogModel): { provider: string; title: string } {
  const sep = model.name.indexOf(': ');
  if (sep > 0) {
    return { provider: model.name.slice(0, sep), title: model.name.slice(sep + 2) };
  }
  return { provider: model.id.split('/')[0], title: model.name };
}

/**
 * Where the title links: OpenRouter page, or the z.ai docs for z.ai-only models.
 * Every ZAI_MODEL_CATALOG entry has a docsUrl today, so the `?? undefined`
 * fallback (title renders unlinked) only fires if a future catalog entry omits it.
 */
function titleUrl(model: UsableCatalogModel): string | undefined {
  if (isZaiOnly(model)) {
    return model.docsUrl ?? undefined; // null → undefined (setURL ignores undefined)
  }
  return buildModelInfoUrl(model.id, AIProvider.OpenRouter);
}

/** Short pricing value for the inline field (unit is clarified in the footer). */
function formatPriceShort(model: UsableCatalogModel): string {
  if (!model.hasPricing) {
    return isZaiOnly(model) ? 'z.ai plan' : 'Variable';
  }
  return `$${model.promptPricePerMillion.toFixed(2)} / $${model.completionPricePerMillion.toFixed(2)}`;
}

/** Capability emoji line, with meta-router and z.ai-coding markers appended when applicable. */
function capabilityLine(model: UsableCatalogModel): string {
  const parts = [formatCapabilities(model)];
  if (model.isRouter === true) {
    parts.push(`${AUTOCOMPLETE_BADGES.ROUTER} meta-router`);
  }
  if (model.isZaiCoding) {
    parts.push(`${AUTOCOMPLETE_BADGES.ZAI_CODING} z.ai coding-plan`);
  }
  return parts.join(SEP);
}

/** Masked-markdown links (z.ai docs and/or the OpenRouter model page). */
function formatLinks(model: UsableCatalogModel): string | null {
  const links: string[] = [];
  if (model.docsUrl !== null) {
    links.push(`[z.ai docs](${model.docsUrl})`);
  }
  if (!isZaiOnly(model)) {
    links.push(`[OpenRouter model page](${buildModelInfoUrl(model.id, AIProvider.OpenRouter)})`);
  }
  return links.length > 0 ? links.join(SEP) : null;
}

/**
 * Build the model detail card.
 */
export function buildModelCard(model: UsableCatalogModel): EmbedBuilder {
  const { provider, title } = splitName(model);
  // `both`-source models route via either OpenRouter (the shown pricing) or a
  // z.ai coding-plan key, so name both — footering "via OpenRouter" alone
  // misleads a z.ai-key-only viewer.
  const source = isZaiOnly(model)
    ? 'z.ai coding plan'
    : model.source === 'both'
      ? 'OpenRouter (also z.ai coding-plan)'
      : 'OpenRouter';

  const embed = new EmbedBuilder()
    // Detail cards stay BLURPLE (§2.3 — color encodes surface kind, not
    // usability state); the status line's badge + words carry the signal.
    .setColor(DISCORD_COLORS.BLURPLE)
    .setAuthor({ name: provider })
    .setTitle(title)
    .setDescription(
      [`\`${model.id}\``, capabilityLine(model), USABILITY_LINE[model.usability]].join('\n')
    )
    .addFields(
      {
        name: 'Context',
        value: `${formatContextLength(model.contextLength)} tokens`,
        inline: true,
      },
      { name: 'Price', value: formatPriceShort(model), inline: true },
      { name: 'Access', value: ACCESS_LABEL[model.usability], inline: true }
    );

  const url = titleUrl(model);
  if (url !== undefined) {
    embed.setURL(url);
  }

  const links = formatLinks(model);
  if (links !== null) {
    embed.addFields({ name: 'Links', value: links, inline: false });
  }

  embed.setFooter({
    text: model.hasPricing ? `via ${source} · prices: in / out per 1M tokens` : `via ${source}`,
  });

  return embed;
}
