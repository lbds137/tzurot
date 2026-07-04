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
    includeOnly: ['^services/', '^packages/'],
  },
};
