# Express.js Migration Consideration

## Overview

The bot currently uses a custom lightweight HTTP routing system. As the HTTP endpoints grow in complexity, migrating to Express.js could provide significant benefits.

## Current System

- Custom route handler in `httpServer.js`
- Simple pattern matching for routes
- Basic request/response handling
- Limited to exact path matches (with recent prefix matching support)

## Benefits of Express.js

### 1. **Advanced Routing**

```javascript
// Current system - limited pattern matching
{ method: 'GET', path: '/avatars', handler: avatarHandler }

// Express - powerful route patterns
app.get('/avatars/:filename', avatarHandler);
app.get('/users/:userId/personalities/:personalityName', handler);
```

### 2. **Middleware Support**

```javascript
// Authentication, logging, error handling as middleware
app.use(authMiddleware);
app.use(loggingMiddleware);
app.use(errorHandler);
```

### 3. **Built-in Features**

- Request body parsing (`express.json()`)
- Static file serving (`express.static()`)
- Better error handling
- Request/response helpers
- Cookie and session support

### 4. **Ecosystem**

- Huge ecosystem of middleware packages
- Well-documented patterns
- Community support
- Testing utilities

## When to Consider Migration

Consider migrating when:

- Need more complex routing patterns
- Want to add authentication middleware
- Need request body parsing for POST/PUT endpoints
- Want better error handling
- Plan to add more HTTP endpoints
- Need file upload handling
- Want to serve a web dashboard

## Migration Impact

### Low Risk

- Express can coexist with Discord.js
- Can migrate incrementally (route by route)
- Backward compatible with existing routes

### Considerations

- Adds dependency (~500KB)
- Slight learning curve
- May be overkill for simple endpoints

## Implementation Plan (When Needed)

1. Install Express: `npm install express`
2. Create new `expressServer.js` alongside existing
3. Migrate routes one by one
4. Test thoroughly
5. Switch over when ready
6. Remove old routing system

## Example Migration

```javascript
// Old system
function createHTTPServer(port = 3000, context = {}) {
  const server = http.createServer(handleRequest);
  // ... custom routing
}

// Express system
const express = require('express');
const app = express();

// Middleware
app.use(express.json());
app.use(loggingMiddleware);

// Routes
app.get('/health', healthHandler);
app.get('/avatars/:filename', avatarHandler);
app.post('/webhooks/github', githubWebhookHandler);

// Error handling
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`Express server running on port ${port}`);
});
```

## Recommendation

Current system is adequate for:

- Health checks
- Simple webhooks
- Static file serving

Consider Express when adding:

- User authentication
- Complex API endpoints
- File uploads
- Web dashboard
- RESTful APIs

## References

- [Express.js Documentation](https://expressjs.com/)
- [Express vs Native HTTP](https://stackoverflow.com/questions/17589178/why-should-i-use-express-when-developing-a-web-app-with-node-js)
