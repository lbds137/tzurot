# DDD Phase 0: Stop the Bleeding

## Objective
Prevent further architectural degradation while preparing for Domain-Driven Design implementation.

## Duration: 1 Week

## Critical Actions

### Day 1-2: Feature Freeze & Assessment

#### 1. Implement Feature Freeze
```javascript
// Add to all PR templates and README
⚠️ FEATURE FREEZE IN EFFECT ⚠️
- No new features until DDD migration complete
- Bug fixes require architectural review
- All changes must reduce, not increase, technical debt
```

#### 2. Document All Work-In-Progress
Create `WORK_IN_PROGRESS.md`:
- [ ] Mock migration (5% complete)
- [ ] Module refactoring (stalled)
- [ ] Environment variable cleanup (partial)
- [ ] Timer injection (incomplete)
- [ ] Singleton removal (not started)

#### 3. Establish "Stop Work" Criteria
Any change that:
- Touches > 10 files → STOP, needs architectural review
- Adds backwards compatibility → REJECTED
- Creates new facades → REJECTED
- Increases file size > 500 lines → REJECTED
- Adds circular dependencies → REJECTED

### Day 3-4: Fix Critical Technical Debt

#### Priority 1: Timer Injection (Blocking Tests)
```javascript
// Before (blocks fake timers)
class Service {
  async retry() {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// After (testable)
class Service {
  constructor({ delay = (ms) => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.delay = delay;
  }
  
  async retry() {
    await this.delay(5000);
  }
}
```

**Files to fix immediately**:
1. `aiService.js` - Retry logic
2. `webhookManager.js` - Chunk delays
3. `rateLimiter.js` - Rate limit delays
4. `messageThrottler.js` - Throttle delays

#### Priority 2: Singleton Exports (Blocking Modularity)
```javascript
// Before (untestable singleton)
const manager = new PersonalityManager();
module.exports = manager;

// After (injectable)
class PersonalityManager { /* ... */ }
module.exports = { PersonalityManager };
```

**Singletons to eliminate**:
1. `personalityManager.js`
2. `conversationManager.js`
3. `webhookManager.js`
4. `logger.js` (create factory)

### Day 5: Metrics & Monitoring

#### 1. Create Health Dashboard
Track daily:
- File size violations (target: 0)
- Circular dependencies (target: 0)
- Test execution time (target: < 30s)
- Mock pattern violations (target: decreasing)
- Files per PR (target: < 10)

#### 2. Automated Checks
```json
// package.json scripts
{
  "lint:architecture": "npm run lint:module-size && npm run lint:circular",
  "lint:module-size": "node scripts/check-module-size.sh",
  "lint:circular": "madge --circular src/",
  "precommit": "npm run lint:architecture"
}
```

### Day 6-7: Prepare for Phase 1

#### 1. Create Domain Structure
```bash
mkdir -p src/domain/{personality,conversation,authentication,ai,shared}
mkdir -p src/adapters/{discord,persistence,ai}
```

#### 2. Set Up Event Bus
```javascript
// src/domain/shared/DomainEventBus.js
class DomainEventBus {
  constructor() {
    this.handlers = new Map();
  }
  
  subscribe(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);
  }
  
  async publish(event) {
    const handlers = this.handlers.get(event.type) || [];
    await Promise.all(handlers.map(h => h(event)));
  }
}

module.exports = { DomainEventBus };
```

#### 3. Create Base Classes
```javascript
// src/domain/shared/AggregateRoot.js
class AggregateRoot {
  constructor() {
    this.events = [];
  }
  
  addEvent(event) {
    this.events.push(event);
  }
  
  getUncommittedEvents() {
    return [...this.events];
  }
  
  markEventsAsCommitted() {
    this.events = [];
  }
}

// src/domain/shared/ValueObject.js
class ValueObject {
  equals(other) {
    if (!other || !(other instanceof this.constructor)) {
      return false;
    }
    return JSON.stringify(this) === JSON.stringify(other);
  }
}
```

## Critical Success Criteria

### Must Complete in Phase 0:
- [ ] Feature freeze communicated and enforced
- [ ] Timer injection in 4 critical files
- [ ] Singleton exports eliminated
- [ ] Health metrics dashboard created
- [ ] Domain structure prepared
- [ ] Event bus implemented

### Must NOT Do in Phase 0:
- ❌ Start migrating existing functionality
- ❌ Add new features "just this once"
- ❌ Create temporary workarounds
- ❌ Skip writing tests
- ❌ Compromise on quality

## Daily Standup Questions

1. What technical debt did I eliminate today?
2. What architectural violations did I prevent?
3. What metrics improved?
4. What is blocking Phase 1 preparation?

## Escalation Protocol

If you encounter:
- Pressure to add features → Escalate to project lead
- "Just this one hack" → Document in TECHNICAL_DEBT.md
- Test failures from changes → Fix immediately or revert
- Resistance to freeze → Show the 52-file cascade example

## Phase 0 Completion Checklist

- [ ] All critical timer injections complete
- [ ] All singleton exports removed
- [ ] Zero file size violations
- [ ] Zero circular dependencies
- [ ] Test suite runs < 45 seconds
- [ ] Domain structure created
- [ ] Event bus tested and ready
- [ ] Team aligned on Phase 1 start

## Remember

> "Every line of code written during Phase 0 should make Phase 1 easier, not harder."

The goal is not to fix everything, but to stop making things worse while preparing for the real fix.