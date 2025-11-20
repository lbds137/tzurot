# Domain Event System

## Overview

The domain event system implements the Event-Driven Architecture pattern, allowing different parts of the application to react to changes in the domain without tight coupling.

## Current Status

✅ **Event Publishing**: PersonalityApplicationService publishes domain events after successful operations
✅ **Event Infrastructure**: DomainEventBus supports pub/sub with wildcard handlers
✅ **Event Handlers Created**: Example handlers for logging and cache invalidation
❌ **Event Handlers Not Wired**: No production event handlers are currently registered

## How It Works

### 1. Domain Events are Created

When domain operations occur, the aggregate roots create events:

```javascript
// In Personality.js
personality.applyEvent(
  new PersonalityCreated(personalityId.toString(), {
    personalityId: personalityId.toString(),
    ownerId: ownerId.toString(),
    profile: profile.toJSON(),
    model: model.toJSON(),
    createdAt: new Date().toISOString(),
  })
);
```

### 2. Application Service Publishes Events

After successful operations, the application service publishes uncommitted events:

```javascript
// In PersonalityApplicationService.js
async _publishEvents(personality) {
  const events = personality.getUncommittedEvents();

  for (const event of events) {
    await this.eventBus.publish(event);
  }

  personality.markEventsAsCommitted();
}
```

### 3. Event Handlers React

Event handlers (policies/sagas) subscribe to events and perform side effects:

```javascript
// Example: PersonalityCacheInvalidator
async handlePersonalityProfileUpdated(event) {
  const personalityName = event.payload.profile?.name;
  if (personalityName && this.profileInfoCache) {
    this.profileInfoCache.deleteFromCache(personalityName);
  }
}
```

## Available Domain Events

### Personality Events

- **PersonalityCreated**: When a new personality is registered
- **PersonalityProfileUpdated**: When personality profile changes
- **PersonalityRemoved**: When a personality is deleted
- **PersonalityAliasAdded**: When an alias is added
- **PersonalityAliasRemoved**: When an alias is removed

## Creating Event Handlers

### 1. Create Handler Class

```javascript
class MyEventHandler {
  constructor(dependencies) {
    // Inject dependencies
  }

  async handlePersonalityCreated(event) {
    // React to the event
    // e.g., send notification, update search index, etc.
  }
}
```

### 2. Register in EventHandlerRegistry

```javascript
// In EventHandlerRegistry.js
const myHandler = new MyEventHandler(dependencies);

this.eventBus.subscribe('PersonalityCreated', event => myHandler.handlePersonalityCreated(event));
```

## Example Use Cases

### Cache Invalidation

When personality data changes, clear relevant caches to ensure fresh data.

### Notification System

When a personality is created, notify followers or interested users.

### Analytics

Track personality creation/deletion for usage metrics.

### Search Index Updates

When personality profiles change, update search indexes.

### Cascade Operations

When a personality is removed, clean up related data (conversations, preferences, etc.).

## Wiring Event Handlers

To activate event handlers in production:

1. Create EventHandlerRegistry instance during application startup
2. Pass required dependencies (eventBus, caches, etc.)
3. Call `registerHandlers()` to subscribe all handlers
4. Ensure eventBus is shared with application services

Example bootstrap code:

```javascript
// In application startup
const eventBus = new DomainEventBus();
const eventHandlerRegistry = new EventHandlerRegistry({
  eventBus,
  profileInfoCache,
  messageTracker,
});

eventHandlerRegistry.registerHandlers();

// Pass same eventBus to application services
const personalityService = new PersonalityApplicationService({
  personalityRepository,
  aiService,
  authenticationRepository,
  eventBus, // Same instance!
});
```

## Benefits

1. **Decoupling**: Event producers don't know about consumers
2. **Scalability**: Easy to add new reactions without modifying existing code
3. **Testability**: Event handlers can be tested in isolation
4. **Observability**: Events provide natural audit trail
5. **Flexibility**: Can add/remove handlers without touching domain

## Next Steps

1. Wire EventHandlerRegistry in production bootstrap
2. Add more sophisticated event handlers (notifications, analytics)
3. Consider event persistence for event sourcing
4. Add correlation IDs for tracing
5. Implement event replay capabilities
