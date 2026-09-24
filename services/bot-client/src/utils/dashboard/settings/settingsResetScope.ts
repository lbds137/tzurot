/**
 * Settings dashboard reset scopes: which settings a Reset page or Reset all
 * press covers, how that scope rides in a customId's extra segment, and which
 * of the covered settings hold an override at this dashboard's tier.
 *
 * A page scope is addressed by the page's stable `SettingsPage.id`, never its
 * position, and is resolved against the CURRENT config at click time — so a
 * deploy that reorders pages while a confirm surface is open still clears the
 * page the user read.
 */

import {
  type SettingDefinition,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsPage,
  type SettingValue,
  isPlainSetting,
} from './types.js';

/** What a reset press covers: one concern page, or every setting the dashboard shows. */
export type ResetScope = { kind: 'page'; page: SettingsPage; pageIndex: number } | { kind: 'all' };

const PAGE_SCOPE_PREFIX = 'page:';
const ALL_SCOPE = 'all';

/** The customId extra segment for a scope: `page:<pageId>` or `all`. */
export function resetScopeExtra(scope: ResetScope): string {
  return scope.kind === 'all' ? ALL_SCOPE : `${PAGE_SCOPE_PREFIX}${scope.page.id}`;
}

/** The page's setting definitions; ids that no longer resolve are skipped (as `getPageSettings` does). */
function resolvePageSettings(
  config: SettingsDashboardConfig,
  page: SettingsPage
): SettingDefinition[] {
  return page.settingIds
    .map(id => config.settings.find(setting => setting.id === id))
    .filter((setting): setting is SettingDefinition => setting !== undefined);
}

/**
 * A page offers Reset page when it shows at least one setting and every one
 * of them is Auto-capable. A page holding any plain (non-cascading) setting
 * — the admin System pages — has no Auto to return to.
 */
export function isResettablePage(config: SettingsDashboardConfig, page: SettingsPage): boolean {
  const settings = resolvePageSettings(config, page);
  return settings.length > 0 && settings.every(setting => !isPlainSetting(config, setting));
}

/** The settings a scope covers: the page's settings, or every Auto-capable setting the dashboard shows. */
function scopeSettings(config: SettingsDashboardConfig, scope: ResetScope): SettingDefinition[] {
  return scope.kind === 'page'
    ? resolvePageSettings(config, scope.page)
    : config.settings.filter(setting => !isPlainSetting(config, setting));
}

/**
 * The ids in the scope that hold an override at this tier, in scope order.
 * Presence, not value: a stored explicit OFF (a null local value on a
 * null-terminal field such as Max Age) IS an override and is reset too.
 */
export function locallySetIds(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  scope: ResetScope
): string[] {
  return scopeSettings(config, scope)
    .filter(setting => {
      const value = session.data[setting.id] as SettingValue | undefined;
      return value?.hasLocalOverride === true;
    })
    .map(setting => setting.id);
}

/**
 * Resolve a reset customId's extra segment to a scope against the current
 * config. Returns null when the scope no longer resolves — an unknown page
 * id, a page that is not resettable, `all` on a dashboard without Reset all,
 * or a scope-less id on a dashboard that never rendered the pre-scope button
 * — and the caller answers with the out-of-date notice.
 */
export function parseResetScope(
  config: SettingsDashboardConfig,
  extra: string | undefined
): ResetScope | null {
  if (extra === undefined) {
    return config.resetAll === true && config.legacyBareResetMeansAll === true
      ? { kind: 'all' }
      : null;
  }
  if (extra === ALL_SCOPE) {
    return config.resetAll === true ? { kind: 'all' } : null;
  }
  if (!extra.startsWith(PAGE_SCOPE_PREFIX)) {
    return null;
  }
  const pageId = extra.slice(PAGE_SCOPE_PREFIX.length);
  const pages = config.pages ?? [];
  const pageIndex = pages.findIndex(page => page.id === pageId);
  if (pageIndex === -1 || !isResettablePage(config, pages[pageIndex])) {
    return null;
  }
  return { kind: 'page', page: pages[pageIndex], pageIndex };
}
