# Command Architecture and Testability

This document describes the improved command architecture that supports dependency injection for better testability.

## Overview

Commands in Tzurot now support an optional third parameter called `context` that allows for dependency injection. This makes commands fully testable without relying on real timers or other system dependencies.

## Command Interface

### Basic Structure

```javascript
module.exports = {
  meta: {
    name: 'commandname',
    description: 'What the command does',
    usage: 'commandname [args]',
    aliases: ['alt1', 'alt2']
  },
  execute: async (message, args, context = {}) => {
    // Command implementation
  }
};
```

### Context Parameter

The `context` parameter is an object that can contain injectable dependencies:

```javascript
{
  scheduler: setTimeout,      // For scheduling tasks
  clearScheduler: clearTimeout,  // For clearing scheduled tasks
  interval: setInterval,      // For recurring tasks
  clearInterval: clearInterval,  // For clearing intervals
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))  // For async delays
}
```

## Usage Examples

### Using Injectable Timers

```javascript
async function execute(message, args, context = {}) {
  // Use default timers if context not provided (backward compatibility)
  const { scheduler = setTimeout, clearScheduler = clearTimeout } = context;
  
  // Schedule a cleanup task
  const timerId = scheduler(() => {
    // Cleanup logic
    processedMessages.delete(message.id);
  }, 60000); // 1 minute
  
  // If needed, clear the timer
  if (someCondition) {
    clearScheduler(timerId);
  }
}
```

### Using Injectable Delays

```javascript
async function execute(message, args, context = {}) {
  const { delay = ((ms) => new Promise(resolve => setTimeout(resolve, ms))) } = context;
  
  // Process items with rate limiting
  for (const item of items) {
    await processItem(item);
    await delay(100); // 100ms delay between items
  }
}
```

## Testing Commands

### Basic Test Setup

```javascript
describe('Command Tests', () => {
  it('should handle timers correctly', async () => {
    // Create mock timer functions
    const mockScheduler = jest.fn();
    const mockClearScheduler = jest.fn();
    const mockDelay = jest.fn().mockResolvedValue(undefined);
    
    // Create context with mocks
    const mockContext = {
      scheduler: mockScheduler,
      clearScheduler: mockClearScheduler,
      delay: mockDelay
    };
    
    // Execute command with mock context
    await command.execute(mockMessage, args, mockContext);
    
    // Verify timer was scheduled
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.any(Function),
      60000
    );
    
    // Test the scheduled function
    const scheduledFn = mockScheduler.mock.calls[0][0];
    scheduledFn(); // Execute immediately in test
  });
});
```

### Testing with Command System Integration

```javascript
const { setCommandContext } = require('../../../../src/commands');

beforeEach(() => {
  // Override command context for all commands in this test
  setCommandContext({
    scheduler: jest.fn(),
    clearScheduler: jest.fn(),
    delay: jest.fn().mockResolvedValue(undefined)
  });
});
```

## Migration Guide

### Updating Existing Commands

1. Add the `context` parameter to your execute function:
   ```javascript
   // Before
   async function execute(message, args) {
   
   // After
   async function execute(message, args, context = {}) {
   ```

2. Extract timer functions from context:
   ```javascript
   const { scheduler = setTimeout, clearScheduler = clearTimeout } = context;
   ```

3. Replace direct timer usage:
   ```javascript
   // Before
   setTimeout(() => { /* ... */ }, 1000);
   
   // After
   scheduler(() => { /* ... */ }, 1000);
   ```

## Benefits

1. **Testability**: Commands can be tested without real timers
2. **Predictability**: Tests run instantly without waiting for timeouts
3. **Flexibility**: Different timer implementations can be injected
4. **Backward Compatibility**: Commands work without context parameter
5. **Maintainability**: Clear separation of concerns

## Future Enhancements

The context system can be extended to inject other dependencies:
- Logger instances
- Database connections
- API clients
- Configuration objects
- Service instances

This creates a foundation for a full dependency injection system while maintaining simplicity.