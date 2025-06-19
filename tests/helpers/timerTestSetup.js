/**
 * Timer test setup helper
 *
 * Provides utilities for setting up timer-related mocks in tests
 * to work with injectable timer patterns
 */

/**
 * Setup timer mocks for a module with injectable timers
 * @param {Object} module - The module with configureTimers function
 * @returns {Object} Mock timer functions
 */
function setupInjectableTimers(module) {
  const mockTimers = {
    setTimeout: jest.fn((callback, delay) => {
      // Return a mock timer ID
      const id = Math.random();
      // For fake timers, register with Jest
      if (jest.isMockFunction(global.setTimeout)) {
        return global.setTimeout(callback, delay);
      }
      return id;
    }),
    clearTimeout: jest.fn(),
    setInterval: jest.fn((callback, delay) => {
      // Return a mock timer ID
      const id = Math.random();
      // For fake timers, register with Jest
      if (jest.isMockFunction(global.setInterval)) {
        return global.setInterval(callback, delay);
      }
      return id;
    }),
    clearInterval: jest.fn(),
  };

  // Configure the module if it has timer configuration
  if (module.configureTimers) {
    module.configureTimers(mockTimers);
  }

  return mockTimers;
}

/**
 * Setup delay function mocks for a module with injectable delays
 * @param {Object} module - The module with configureDelay function
 * @param {Object} options - Configuration options
 * @returns {Function} Mock delay function
 */
function setupInjectableDelay(module, options = {}) {
  const { immediate = true } = options;

  const mockDelay = jest.fn(ms => {
    if (immediate) {
      return Promise.resolve();
    }
    // Use Jest's timer mocks if available
    if (jest.isMockFunction(global.setTimeout)) {
      return new Promise(resolve => {
        global.setTimeout(resolve, ms);
      });
    }
    return Promise.resolve();
  });

  // Configure the module if it has delay configuration
  if (module.configureDelay) {
    module.configureDelay(mockDelay);
  }

  return mockDelay;
}

/**
 * Reset timer configurations to defaults
 * @param {Object} module - The module to reset
 */
function resetTimerMocks(module) {
  if (module.configureTimers) {
    module.configureTimers({
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
    });
  }
  if (module.configureDelay) {
    module.configureDelay(ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
}

module.exports = {
  setupInjectableTimers,
  setupInjectableDelay,
  resetTimerMocks,
};
