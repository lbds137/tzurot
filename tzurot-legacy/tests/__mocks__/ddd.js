/**
 * DDD-specific mocks for Domain-Driven Design tests
 * Provides mocks for repositories, domain services, and events
 */

/**
 * Create a mock repository base with common repository methods
 */
function createMockRepository(options = {}) {
  const store = new Map();

  return {
    // Storage for testing
    _store: store,

    // Common repository methods
    save: jest.fn().mockImplementation(async aggregate => {
      const id = aggregate.id || aggregate.getId();
      store.set(id.toString(), JSON.parse(JSON.stringify(aggregate)));
      return aggregate;
    }),

    findById: jest.fn().mockImplementation(async id => {
      const stored = store.get(id.toString());
      return stored ? (options.hydrate ? options.hydrate(stored) : stored) : null;
    }),

    delete: jest.fn().mockImplementation(async id => {
      return store.delete(id.toString());
    }),

    findAll: jest.fn().mockImplementation(async () => {
      return Array.from(store.values());
    }),

    clear: jest.fn().mockImplementation(() => {
      store.clear();
    }),

    // For testing
    exists: jest.fn().mockImplementation(async id => {
      return store.has(id.toString());
    }),
  };
}

/**
 * Create a mock domain service
 */
function createMockDomainService(options = {}) {
  return {
    execute: jest.fn().mockResolvedValue(options.defaultResult || { success: true }),
    validate: jest.fn().mockReturnValue(true),
    ...options.methods,
  };
}

/**
 * Create a mock event bus for testing event-driven behavior
 */
function createMockEventBus() {
  const events = [];
  const handlers = new Map();

  return {
    // Track all published events
    publishedEvents: events,

    // Event publishing
    publish: jest.fn().mockImplementation(async event => {
      events.push(event);

      // Call registered handlers
      const eventHandlers = handlers.get(event.eventType) || [];
      for (const handler of eventHandlers) {
        await handler(event);
      }
    }),

    // Event subscription
    subscribe: jest.fn().mockImplementation((eventType, handler) => {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, []);
      }
      handlers.get(eventType).push(handler);
    }),

    // Clear for testing
    clear: jest.fn().mockImplementation(() => {
      events.length = 0;
      handlers.clear();
    }),

    // Test helper - wait for specific event
    waitForEvent: (eventType, timeout = 1000) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for event: ${eventType}`));
        }, timeout);

        const checkEvents = () => {
          const event = events.find(e => e.eventType === eventType);
          if (event) {
            clearTimeout(timer);
            resolve(event);
          }
        };

        // Check immediately and on each new event
        checkEvents();
        const originalPublish = this.publish;
        this.publish = jest.fn().mockImplementation(async event => {
          await originalPublish(event);
          checkEvents();
        });
      });
    },
  };
}

/**
 * Create mock filesystem operations for persistence adapters
 */
function createMockFileSystem() {
  const files = new Map();

  return {
    promises: {
      mkdir: jest.fn().mockResolvedValue(),

      readFile: jest.fn().mockImplementation(async path => {
        if (!files.has(path)) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        return files.get(path);
      }),

      writeFile: jest.fn().mockImplementation(async (path, data) => {
        files.set(path, data);
      }),

      rename: jest.fn().mockImplementation(async (oldPath, newPath) => {
        if (!files.has(oldPath)) {
          throw new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`);
        }
        files.set(newPath, files.get(oldPath));
        files.delete(oldPath);
      }),

      unlink: jest.fn().mockImplementation(async path => {
        if (!files.has(path)) {
          throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
        }
        files.delete(path);
      }),

      // Test helpers
      _setFileContent: (path, content) => {
        files.set(path, typeof content === 'string' ? content : JSON.stringify(content));
      },

      _getFiles: () => files,

      _clear: () => files.clear(),
    },
  };
}

/**
 * Create a mock timer system for testing time-based behavior
 */
function createMockTimers() {
  return {
    setTimeout: jest.fn().mockImplementation((callback, delay) => {
      const id = Math.random();
      // For testing, execute immediately unless using fake timers
      if (jest.isMockFunction(setTimeout)) {
        return setTimeout(callback, delay);
      }
      setImmediate(callback);
      return id;
    }),

    clearTimeout: jest.fn(),

    setInterval: jest.fn().mockImplementation((callback, interval) => {
      const id = Math.random();
      if (jest.isMockFunction(setInterval)) {
        return setInterval(callback, interval);
      }
      return id;
    }),

    clearInterval: jest.fn(),

    // Delay function for async operations
    delay: jest.fn().mockResolvedValue(),
  };
}

/**
 * DDD test environment presets
 */
const dddPresets = {
  /**
   * Domain model testing (no external dependencies)
   */
  domainTest: (options = {}) => ({
    eventBus: createMockEventBus(),
    ...options,
  }),

  /**
   * Repository testing
   */
  repositoryTest: (options = {}) => ({
    fs: createMockFileSystem(),
    timers: createMockTimers(),
    eventBus: createMockEventBus(),
    ...options,
  }),

  /**
   * Application service testing
   */
  applicationServiceTest: (options = {}) => ({
    repositories: {
      personality: createMockRepository(options.personality),
      conversation: createMockRepository(options.conversation),
      authentication: createMockRepository(options.authentication),
      aiRequest: createMockRepository(options.aiRequest),
      ...options.repositories,
    },
    domainServices: {
      tokenService: createMockDomainService(options.tokenService),
      aiService: createMockDomainService(options.aiService),
      ...options.domainServices,
    },
    eventBus: createMockEventBus(),
    ...options,
  }),

  /**
   * Full DDD integration testing
   */
  integrationTest: (options = {}) => ({
    fs: createMockFileSystem(),
    timers: createMockTimers(),
    eventBus: createMockEventBus(),
    repositories: {
      personality: createMockRepository(),
      conversation: createMockRepository(),
      authentication: createMockRepository(),
      aiRequest: createMockRepository(),
    },
    domainServices: {
      tokenService: createMockDomainService(),
      aiService: createMockDomainService(),
    },
    ...options,
  }),
};

module.exports = {
  createMockRepository,
  createMockDomainService,
  createMockEventBus,
  createMockFileSystem,
  createMockTimers,
  presets: dddPresets,
};
