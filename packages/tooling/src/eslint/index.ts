/**
 * @tzurot/eslint-plugin
 *
 * Custom ESLint rules for Tzurot v3 codebase.
 *
 * Usage in eslint.config.js:
 *   import tzurotPlugin from '@tzurot/tooling/eslint';
 *   // OR for direct import during development:
 *   import tzurotPlugin from './packages/tooling/src/eslint/index.js';
 *
 *   export default [
 *     {
 *       plugins: { '@tzurot': tzurotPlugin },
 *       rules: {
 *         '@tzurot/no-singleton-export': 'error',
 *       },
 *     },
 *   ];
 */

import noSingletonExport from './no-singleton-export.js';
import componentHandlerAckFirst from './component-handler-ack-first.js';
import noDiscordBuildersInCommands from './no-discord-builders-in-commands.js';
import buttonOrderDangerLast from './button-order-danger-last.js';
import noRawContentLiterals from './no-raw-content-literals.js';

const plugin = {
  meta: {
    name: '@tzurot/eslint-plugin',
    version: '1.0.0',
  },
  rules: {
    'no-singleton-export': noSingletonExport,
    'component-handler-ack-first': componentHandlerAckFirst,
    'no-discord-builders-in-commands': noDiscordBuildersInCommands,
    'button-order-danger-last': buttonOrderDangerLast,
    'no-raw-content-literals': noRawContentLiterals,
  },
};

export default plugin;
