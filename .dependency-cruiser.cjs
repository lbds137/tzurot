/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // === HARD BOUNDARIES (errors) ===
    {
      name: 'bot-client-no-prisma',
      comment: 'bot-client must NEVER import Prisma directly — use gateway APIs',
      severity: 'error',
      from: { path: '^services/bot-client/' },
      to: { path: '@prisma/client' },
    },
    {
      name: 'bot-client-no-config-resolver',
      comment:
        'bot-client must NEVER import @tzurot/config-resolver — it reads Prisma config tables; use gateway APIs',
      severity: 'error',
      from: { path: '^services/bot-client/' },
      to: { path: '(^|/)@tzurot/config-resolver|^packages/config-resolver/' },
    },
    {
      name: 'bot-client-no-identity',
      comment:
        'bot-client must NEVER import @tzurot/identity — it is Prisma-backed (users/personas/personalities); use gateway APIs',
      severity: 'error',
      from: { path: '^services/bot-client/' },
      to: { path: '(^|/)@tzurot/identity|^packages/identity/' },
    },
    {
      name: 'bot-client-no-conversation-history',
      comment:
        'bot-client must NEVER import @tzurot/conversation-history — it is Prisma-backed (conversation persistence); use gateway APIs. The ConversationMessage data shapes + conversationSyncDiff util stay in @tzurot/common-types for bot-client.',
      severity: 'error',
      from: { path: '^services/bot-client/' },
      to: { path: '(^|/)@tzurot/conversation-history|^packages/conversation-history/' },
    },
    {
      name: 'no-prod-import-test-factories',
      comment:
        '@tzurot/test-factories is a test-fixture package — production code must never import it',
      severity: 'error',
      from: {
        path: '^(services|packages)/',
        pathNot: ['\\.test\\.ts$', '^packages/test-factories/'],
      },
      to: { path: '(^|/)@tzurot/test-factories|^packages/test-factories/' },
    },
    {
      name: 'no-cross-service-imports',
      comment: 'Services must not import from each other — use common-types or APIs',
      severity: 'error',
      from: { path: '^services/([^/]+)/' },
      to: {
        path: '^services/([^/]+)/',
        pathNot: '^services/$1/',
      },
    },
    {
      name: 'no-circular-dependencies',
      comment: 'Circular dependencies break reasoning and import ordering',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    {
      name: 'ux-catalog-no-discord',
      comment:
        'ux/catalog is the platform-neutral message-intent layer (design: ' +
        'platform-portable-ux-design §4.6) — only ux/render may touch discord.js. ' +
        'This boundary IS the portability posture; an adapter for a second ' +
        'platform renders the same catalog. Same discord.js-vs-discord-named-' +
        'module collision handling as ai-worker-no-discord below.',
      severity: 'error',
      from: { path: '^services/bot-client/src/ux/catalog/' },
      to: { path: 'discord\\.js', pathNot: '^packages/common-types/' },
    },

    // === WARNINGS ===
    {
      name: 'ai-worker-no-discord',
      comment: 'ai-worker should use common-types for Discord types, not the discord.js library',
      severity: 'warn',
      from: { path: '^services/ai-worker/' },
      // Ban the discord.js NPM library, NOT common-types' own discord-NAMED
      // modules (constants/discord.js, types/schemas/discord.js, utils/discord.js)
      // — ai-worker legitimately consumes those shared Discord types, which is
      // the rule's entire point. The `discord\.js` path pattern collides with
      // those filenames; `pathNot: '^packages/common-types/'` keeps the ban on
      // the library while allowing the shared types. Anchored (like the sibling
      // `^packages/...` rules) so a future `common-types-v2` isn't exempted.
      // (The root barrel hid this collision — ai-worker's imports resolved
      // through index.js; deep imports exposed it.)
      to: { path: 'discord\\.js', pathNot: '^packages/common-types/' },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', 'dist', '\\.turbo'],
    },
    exclude: {
      // Generated Prisma client has inherent circular deps (models ↔ prismaNamespace).
      // These are auto-generated and unfixable — exclude rather than baseline.
      path: ['src/generated/prisma/'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    cache: {
      strategy: 'content',
      folder: 'node_modules/.cache/dependency-cruiser',
    },
    // node_modules/discord.js is deliberately IN the graph (as a leaf —
    // doNotFollow stops traversal): the ai-worker-no-discord and
    // ux-catalog-no-discord rules ban importing the library, and includeOnly
    // filters dependency TARGETS out of the graph, so without this entry the
    // discord.js edge is never recorded and both rules are dead — verified
    // empirically with a canary import that produced zero violations.
    // Unanchored: pnpm resolves to node_modules/.pnpm/discord.js@…/node_modules/discord.js/…
    includeOnly: ['^services/', '^packages/', 'node_modules/discord\\.js'],
  },
};
