# DDD Command System Monitoring Setup

## Overview

Comprehensive monitoring setup for the DDD command system migration, providing real-time insights into system performance, error rates, and migration health.

## Monitoring Architecture

```
Discord Bot → CommandIntegrationAdapter → [Metrics Collection] → [Aggregation] → [Dashboards & Alerts]
```

### Components
1. **Metrics Collection**: In-app instrumentation
2. **Aggregation**: Local metrics store or external service
3. **Dashboards**: Real-time monitoring views
4. **Alerts**: Automated notification system

## Metrics Collection Implementation

### 1. Command Execution Metrics

Create a metrics collection service:

```javascript
// src/monitoring/MetricsCollector.js
class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.counters = new Map();
    this.timers = new Map();
  }

  // Track command execution
  recordCommandExecution(command, system, duration, success, error = null) {
    const metric = {
      timestamp: new Date().toISOString(),
      command,
      system, // 'legacy' or 'ddd'
      duration_ms: duration,
      success,
      error: error?.message || null,
    };

    this.addMetric('command_execution', metric);
  }

  // Track system resource usage
  recordResourceUsage() {
    const usage = process.memoryUsage();
    const metric = {
      timestamp: new Date().toISOString(),
      memory_used_mb: Math.round(usage.heapUsed / 1024 / 1024),
      memory_total_mb: Math.round(usage.heapTotal / 1024 / 1024),
      cpu_usage_percent: process.cpuUsage(),
    };

    this.addMetric('resource_usage', metric);
  }

  // Track feature flag usage
  recordFeatureFlagCheck(flag, enabled, command = null) {
    const metric = {
      timestamp: new Date().toISOString(),
      flag,
      enabled,
      command,
    };

    this.addMetric('feature_flag_check', metric);
  }

  addMetric(type, data) {
    if (!this.metrics.has(type)) {
      this.metrics.set(type, []);
    }
    
    const metrics = this.metrics.get(type);
    metrics.push(data);
    
    // Keep only last 1000 entries per type
    if (metrics.length > 1000) {
      metrics.shift();
    }
  }

  getMetrics(type, since = null) {
    const metrics = this.metrics.get(type) || [];
    if (!since) return metrics;
    
    const sinceTime = new Date(since).getTime();
    return metrics.filter(m => new Date(m.timestamp).getTime() >= sinceTime);
  }

  // Get summary statistics
  getSummary(timeWindow = '1h') {
    const since = new Date(Date.now() - this.parseTimeWindow(timeWindow)).toISOString();
    
    const executions = this.getMetrics('command_execution', since);
    const resources = this.getMetrics('resource_usage', since);
    
    return {
      command_executions: {
        total: executions.length,
        by_system: this.groupBy(executions, 'system'),
        by_command: this.groupBy(executions, 'command'),
        avg_duration: this.average(executions, 'duration_ms'),
        error_rate: executions.filter(e => !e.success).length / executions.length,
      },
      resource_usage: {
        avg_memory_mb: this.average(resources, 'memory_used_mb'),
        peak_memory_mb: Math.max(...resources.map(r => r.memory_used_mb)),
        current_memory_mb: resources[resources.length - 1]?.memory_used_mb || 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  parseTimeWindow(window) {
    const num = parseInt(window);
    const unit = window.slice(-1);
    const multipliers = { m: 60000, h: 3600000, d: 86400000 };
    return num * (multipliers[unit] || 3600000);
  }

  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const value = item[key];
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }

  average(array, key) {
    if (array.length === 0) return 0;
    return array.reduce((sum, item) => sum + item[key], 0) / array.length;
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

// Auto-collect resource metrics every 30 seconds
setInterval(() => {
  metricsCollector.recordResourceUsage();
}, 30000);

module.exports = { metricsCollector };
```

### 2. Instrument CommandIntegrationAdapter

```javascript
// Update CommandIntegrationAdapter.js
const { metricsCollector } = require('../monitoring/MetricsCollector');

async function processCommand(message, commandName, args) {
  const startTime = Date.now();
  let system = 'unknown';
  let success = false;
  let error = null;

  try {
    // ... existing logic ...
    
    const useNewSystem = this.shouldUseNewSystem(commandName, hasNewCommand);
    system = useNewSystem ? 'ddd' : 'legacy';
    
    // Record feature flag check
    metricsCollector.recordFeatureFlagCheck('ddd.commands.enabled', useNewSystem, commandName);
    
    let result;
    if (useNewSystem) {
      result = await this.processNewCommand(message, commandName, args);
    } else {
      result = await this.processLegacyCommand(message, commandName, args);
    }
    
    success = true;
    return result;
    
  } catch (err) {
    error = err;
    success = false;
    throw err;
    
  } finally {
    const duration = Date.now() - startTime;
    metricsCollector.recordCommandExecution(commandName, system, duration, success, error);
  }
}
```

### 3. Health Check Endpoints

```javascript
// src/routes/health.js - Add monitoring endpoints

// Basic health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: require('../../package.json').version,
  });
});

// Feature flags status
app.get('/health/features', (req, res) => {
  const featureFlags = getFeatureFlags();
  const flags = {};
  
  // Get all DDD-related flags
  const dddFlags = [
    'ddd.commands.enabled',
    'ddd.commands.integration', 
    'ddd.commands.personality',
    'ddd.commands.conversation',
    'ddd.commands.authentication',
    'ddd.commands.utility',
  ];
  
  dddFlags.forEach(flag => {
    flags[flag] = featureFlags.isEnabled(flag);
  });
  
  res.json(flags);
});

// Command system metrics
app.get('/health/commands', (req, res) => {
  const timeWindow = req.query.window || '1h';
  const summary = metricsCollector.getSummary(timeWindow);
  
  res.json({
    ...summary,
    commands_migrated: 18,
    migration_complete: true,
  });
});

// Detailed metrics endpoint
app.get('/health/metrics/:type', (req, res) => {
  const { type } = req.params;
  const since = req.query.since;
  const metrics = metricsCollector.getMetrics(type, since);
  
  res.json({
    type,
    count: metrics.length,
    metrics: metrics.slice(-100), // Return last 100 entries
  });
});
```

## Dashboard Implementation

### Simple HTML Dashboard

```html
<!-- public/monitoring-dashboard.html -->
<!DOCTYPE html>
<html>
<head>
    <title>DDD Command System Monitoring</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric-card { 
            border: 1px solid #ddd; 
            border-radius: 8px; 
            padding: 15px; 
            margin: 10px; 
            display: inline-block; 
            min-width: 200px;
        }
        .metric-value { font-size: 2em; font-weight: bold; }
        .metric-label { color: #666; }
        .error { color: #e74c3c; }
        .success { color: #27ae60; }
        .warning { color: #f39c12; }
    </style>
</head>
<body>
    <h1>🚀 DDD Command System Monitoring</h1>
    
    <div id="status-cards"></div>
    
    <div id="command-chart" style="width:100%;height:400px;"></div>
    <div id="performance-chart" style="width:100%;height:400px;"></div>
    <div id="error-rate-chart" style="width:100%;height:400px;"></div>

    <script>
        // Real-time dashboard updates
        async function fetchMetrics() {
            const response = await fetch('/health/commands?window=1h');
            return await response.json();
        }

        async function fetchFeatureFlags() {
            const response = await fetch('/health/features');
            return await response.json();
        }

        function createStatusCards(data) {
            const container = document.getElementById('status-cards');
            
            const cards = [
                {
                    label: 'Total Commands (1h)',
                    value: data.command_executions.total,
                    status: 'success'
                },
                {
                    label: 'Avg Response Time',
                    value: `${Math.round(data.command_executions.avg_duration)}ms`,
                    status: data.command_executions.avg_duration > 1000 ? 'warning' : 'success'
                },
                {
                    label: 'Error Rate',
                    value: `${(data.command_executions.error_rate * 100).toFixed(2)}%`,
                    status: data.command_executions.error_rate > 0.01 ? 'error' : 'success'
                },
                {
                    label: 'Memory Usage',
                    value: `${data.resource_usage.current_memory_mb}MB`,
                    status: data.resource_usage.current_memory_mb > 1000 ? 'warning' : 'success'
                }
            ];
            
            container.innerHTML = cards.map(card => `
                <div class="metric-card">
                    <div class="metric-value ${card.status}">${card.value}</div>
                    <div class="metric-label">${card.label}</div>
                </div>
            `).join('');
        }

        function createCommandChart(data) {
            const systems = Object.entries(data.command_executions.by_system);
            
            const trace = {
                x: systems.map(([system]) => system.toUpperCase()),
                y: systems.map(([, count]) => count),
                type: 'bar',
                marker: {
                    color: systems.map(([system]) => 
                        system === 'ddd' ? '#3498db' : '#95a5a6'
                    )
                }
            };
            
            Plotly.newPlot('command-chart', [trace], {
                title: 'Commands by System (Last Hour)',
                yaxis: { title: 'Number of Commands' }
            });
        }

        async function updateDashboard() {
            try {
                const [metrics, features] = await Promise.all([
                    fetchMetrics(),
                    fetchFeatureFlags()
                ]);
                
                createStatusCards(metrics);
                createCommandChart(metrics);
                
                // Update feature flags status
                console.log('Feature Flags:', features);
                
            } catch (error) {
                console.error('Failed to update dashboard:', error);
            }
        }

        // Update dashboard every 30 seconds
        setInterval(updateDashboard, 30000);
        
        // Initial load
        updateDashboard();
    </script>
</body>
</html>
```

## Alert System

### Simple File-Based Alerting

```javascript
// src/monitoring/AlertManager.js
class AlertManager {
  constructor() {
    this.thresholds = {
      error_rate: 0.01, // 1%
      response_time: 1000, // 1 second
      memory_mb: 1000, // 1GB
    };
    
    this.alertHistory = [];
  }

  checkAlerts() {
    const summary = metricsCollector.getSummary('5m');
    const alerts = [];

    // Check error rate
    if (summary.command_executions.error_rate > this.thresholds.error_rate) {
      alerts.push({
        type: 'error_rate',
        severity: 'high',
        message: `Error rate ${(summary.command_executions.error_rate * 100).toFixed(2)}% exceeds threshold`,
        value: summary.command_executions.error_rate,
        threshold: this.thresholds.error_rate,
      });
    }

    // Check response time
    if (summary.command_executions.avg_duration > this.thresholds.response_time) {
      alerts.push({
        type: 'response_time',
        severity: 'medium',
        message: `Average response time ${summary.command_executions.avg_duration}ms exceeds threshold`,
        value: summary.command_executions.avg_duration,
        threshold: this.thresholds.response_time,
      });
    }

    // Check memory usage
    if (summary.resource_usage.current_memory_mb > this.thresholds.memory_mb) {
      alerts.push({
        type: 'memory',
        severity: 'medium',
        message: `Memory usage ${summary.resource_usage.current_memory_mb}MB exceeds threshold`,
        value: summary.resource_usage.current_memory_mb,
        threshold: this.thresholds.memory_mb,
      });
    }

    // Process new alerts
    alerts.forEach(alert => this.processAlert(alert));
    
    return alerts;
  }

  processAlert(alert) {
    const alertKey = `${alert.type}_${alert.severity}`;
    const lastAlert = this.alertHistory.find(a => a.key === alertKey);
    
    // Avoid alert spam - only send if last alert was >5 minutes ago
    if (lastAlert && Date.now() - lastAlert.timestamp < 300000) {
      return;
    }

    this.sendAlert(alert);
    this.alertHistory.push({
      key: alertKey,
      timestamp: Date.now(),
      alert,
    });
    
    // Keep only last 100 alerts
    if (this.alertHistory.length > 100) {
      this.alertHistory.shift();
    }
  }

  sendAlert(alert) {
    // Log to console/file
    console.error(`🚨 ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);
    
    // In production, integrate with:
    // - Discord webhook notifications
    // - Email alerts
    // - Slack notifications
    // - PagerDuty/incident management
    
    // For now, write to alert log file
    const fs = require('fs');
    const alertLog = {
      timestamp: new Date().toISOString(),
      ...alert,
    };
    
    fs.appendFileSync('alerts.log', JSON.stringify(alertLog) + '\n');
  }
}

const alertManager = new AlertManager();

// Check for alerts every minute
setInterval(() => {
  alertManager.checkAlerts();
}, 60000);

module.exports = { alertManager };
```

## Deployment Integration

### Environment Variables

```bash
# Enable monitoring in production
MONITORING_ENABLED=true
MONITORING_DASHBOARD=true
HEALTH_CHECK_PORT=3001

# Alert thresholds
ALERT_ERROR_RATE_THRESHOLD=0.01
ALERT_RESPONSE_TIME_THRESHOLD=1000
ALERT_MEMORY_THRESHOLD=1000
```

### Docker Health Checks

```dockerfile
# Add to Dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
```

### Railway Deployment

```json
// railway.json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 10,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

## Usage Instructions

### 1. Enable Monitoring

```javascript
// In bot startup
const { metricsCollector } = require('./src/monitoring/MetricsCollector');
const { alertManager } = require('./src/monitoring/AlertManager');

// Monitoring is automatically started
console.log('📊 Monitoring system initialized');
```

### 2. Access Dashboard

```bash
# Navigate to monitoring dashboard
open http://localhost:3001/monitoring-dashboard.html

# Or check specific metrics
curl http://localhost:3001/health/commands
curl http://localhost:3001/health/features
```

### 3. Monitor During Deployment

```bash
# Tail the alert log
tail -f alerts.log

# Watch real-time metrics
watch -n 5 "curl -s http://localhost:3001/health/commands | jq '.command_executions'"

# Check feature flag status
curl -s http://localhost:3001/health/features | jq
```

---

*Monitoring Setup Guide v1.0*
*Created: June 14, 2025*
*Ready for Phase 4 Stage 1 implementation*