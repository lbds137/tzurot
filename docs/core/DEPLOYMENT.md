# Deployment Guide

This guide covers various deployment options for Tzurot, from simple VPS deployment to containerized solutions.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Production Environment Setup](#production-environment-setup)
- [Deployment Options](#deployment-options)
  - [VPS Deployment](#vps-deployment)
  - [Docker Deployment](#docker-deployment)
  - [Platform-as-a-Service (PaaS)](#platform-as-a-service-paas)
  - [Systemd Service](#systemd-service)
- [Process Management](#process-management)
- [Monitoring and Logging](#monitoring-and-logging)
- [Security Hardening](#security-hardening)
- [Backup and Recovery](#backup-and-recovery)
- [Scaling Considerations](#scaling-considerations)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Node.js**: Version 16.x or higher
- **Memory**: Minimum 512MB RAM (1GB recommended)
- **Storage**: 500MB for application and dependencies
- **Network**: Stable internet connection
- **OS**: Linux (Ubuntu/Debian recommended), macOS, or Windows Server

### Required Accounts

- Discord bot token (from Discord Developer Portal)
- AI service API credentials
- Server/hosting provider account

### Pre-deployment Checklist

- [ ] All environment variables documented
- [ ] Tests passing (`npm test`)
- [ ] Linting passing (`npm run lint`)
- [ ] Production dependencies only
- [ ] Secrets not in repository
- [ ] Backup strategy planned

## Production Environment Setup

### 1. Environment Variables

Create a production `.env` file:

```bash
# Copy example and edit
cp .env.example .env
nano .env
```

**Critical Production Settings:**

```env
# Set to production
NODE_ENV=production

# Disable debug logging
LOG_LEVEL=info

# Required variables (see SETUP.md for full list)
DISCORD_TOKEN=your_production_token
SERVICE_API_KEY=your_production_api_key
# ... other required variables
```

### 2. Install Production Dependencies

```bash
# Install only production dependencies
npm install --production

# Or with npm ci for exact versions
npm ci --production
```

### 3. Security Preparations

```bash
# Create dedicated user (Linux)
sudo useradd -r -s /bin/false tzurot
sudo mkdir /opt/tzurot
sudo chown tzurot:tzurot /opt/tzurot

# Set restrictive permissions
chmod 600 .env
chmod 700 data/
```

## Deployment Options

### VPS Deployment

#### 1. Server Setup (Ubuntu/Debian)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 16+
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools (if needed)
sudo apt install -y build-essential

# Install Git
sudo apt install -y git

# Setup firewall (if using UFW)
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

#### 2. Application Deployment

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/lbds137/tzurot.git
cd tzurot

# Change ownership
sudo chown -R tzurot:tzurot /opt/tzurot

# Switch to app user
sudo -u tzurot bash

# Install dependencies
npm ci --production

# Create and configure .env
cp .env.example .env
nano .env  # Add your production values

# Test the application
npm start
```

#### 3. Process Management with PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start application
pm2 start index.js --name tzurot --user tzurot

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup systemd -u tzurot --hp /home/tzurot
# Run the command it outputs

# Useful PM2 commands
pm2 status          # Check status
pm2 logs tzurot     # View logs
pm2 restart tzurot  # Restart
pm2 reload tzurot   # Zero-downtime reload
```

### Docker Deployment

#### 1. Create Dockerfile

```dockerfile
# Dockerfile
FROM node:16-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --production

# Copy app source
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /usr/src/app

# Switch to non-root user
USER nodejs

# Expose health check port (if applicable)
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
```

#### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  tzurot:
    build: .
    container_name: tzurot-bot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./data:/usr/src/app/data
      - ./logs:/usr/src/app/logs
    environment:
      - NODE_ENV=production
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "node", "healthCheck.js"]
      interval: 30s
      timeout: 10s
      retries: 3
```

#### 3. Build and Run

```bash
# Build image
docker build -t tzurot .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Stop
docker-compose down
```

### Platform-as-a-Service (PaaS)

#### Railway.app Deployment

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Deploy**:
   ```bash
   railway login
   railway init
   railway up
   ```

3. **Set Environment Variables**:
   ```bash
   railway variables set DISCORD_TOKEN=your_token
   railway variables set SERVICE_API_KEY=your_key
   # Set all other required variables
   ```

#### Heroku Deployment

1. **Create Procfile**:
   ```
   worker: node index.js
   ```

2. **Deploy**:
   ```bash
   heroku create tzurot-bot
   git push heroku main
   heroku ps:scale worker=1
   ```

3. **Set Config**:
   ```bash
   heroku config:set DISCORD_TOKEN=your_token
   heroku config:set SERVICE_API_KEY=your_key
   ```

#### Render.com Deployment

1. **Create render.yaml**:
   ```yaml
   services:
     - type: worker
       name: tzurot
       env: node
       buildCommand: npm ci --production
       startCommand: node index.js
       envVars:
         - key: NODE_ENV
           value: production
   ```

2. Connect GitHub repository and deploy via Render dashboard

### Systemd Service

For VPS deployments without PM2:

#### 1. Create Service File

```bash
sudo nano /etc/systemd/system/tzurot.service
```

```ini
[Unit]
Description=Tzurot Discord Bot
After=network.target

[Service]
Type=simple
User=tzurot
WorkingDirectory=/opt/tzurot
ExecStart=/usr/bin/node /opt/tzurot/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=tzurot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

#### 2. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable tzurot
sudo systemctl start tzurot
sudo systemctl status tzurot
```

## Process Management

### Health Monitoring

Implement health check endpoint:

```javascript
// healthCheck.js
const http = require('http');

const server = http.createServer((req, res) => {
  // Check bot connection
  if (client.ws.status === 0) {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(503);
    res.end('Bot disconnected');
  }
});

server.listen(3000);
```

### Auto-restart Configuration

#### PM2 Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'tzurot',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

## Monitoring and Logging

### Log Management

#### 1. Log Rotation (Linux)

```bash
# /etc/logrotate.d/tzurot
/opt/tzurot/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 tzurot tzurot
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

#### 2. External Logging Services

**Papertrail**:
```bash
# Install remote_syslog2
wget https://github.com/papertrail/remote_syslog2/releases/download/v0.20/remote_syslog_linux_amd64.tar.gz
tar xzf remote_syslog_linux_amd64.tar.gz
sudo cp remote_syslog/remote_syslog /usr/local/bin

# Configure
echo "files:
  - /opt/tzurot/logs/*.log
destination:
  host: logs.papertrailapp.com
  port: 12345
  protocol: tls" | sudo tee /etc/log_files.yml
```

### Metrics and Monitoring

#### 1. Basic Monitoring Script

```bash
#!/bin/bash
# monitor.sh

# Check if bot process is running
if ! pgrep -f "node.*index.js" > /dev/null; then
    echo "Bot is not running! Restarting..."
    cd /opt/tzurot && npm start &
fi

# Check memory usage
MEM=$(ps aux | grep "node.*index.js" | awk '{print $4}')
if (( $(echo "$MEM > 80.0" | bc -l) )); then
    echo "High memory usage: $MEM%"
    # Send alert or restart
fi
```

#### 2. Uptime Monitoring Services

- **UptimeRobot**: Monitor bot's online status
- **Datadog**: Comprehensive monitoring
- **New Relic**: Application performance monitoring

## Security Hardening

### 1. File Permissions

```bash
# Restrict access to sensitive files
chmod 600 .env
chmod 700 data/
find . -type f -name "*.json" -exec chmod 600 {} \;
```

### 2. Environment Isolation

```bash
# Use separate user
sudo -u tzurot bash

# Restrict network access (if needed)
sudo iptables -A OUTPUT -m owner --uid-owner tzurot -j ACCEPT
```

### 3. Secrets Management

**Using Environment Variables**:
```bash
# Store secrets in /etc/environment (system-wide)
sudo echo "DISCORD_TOKEN=your_token" >> /etc/environment

# Or user-specific
echo "export DISCORD_TOKEN=your_token" >> ~/.bashrc
```

**Using Secret Files**:
```bash
# Create secrets directory
mkdir -p /opt/tzurot/secrets
chmod 700 /opt/tzurot/secrets

# Store secrets
echo "your_token" > /opt/tzurot/secrets/discord_token
chmod 600 /opt/tzurot/secrets/discord_token
```

## Backup and Recovery

### 1. Data Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backup/tzurot"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup data files
tar -czf "$BACKUP_DIR/data_$DATE.tar.gz" /opt/tzurot/data/

# Backup environment (without secrets)
grep -v "TOKEN\|KEY" /opt/tzurot/.env > "$BACKUP_DIR/env_$DATE"

# Keep only last 7 days
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete
```

### 2. Automated Backups

```bash
# Add to crontab
crontab -e
# Add: 0 2 * * * /opt/tzurot/scripts/backup.sh
```

### 3. Recovery Procedure

```bash
# Stop bot
pm2 stop tzurot

# Restore data
tar -xzf /backup/tzurot/data_20240101_020000.tar.gz -C /

# Restart bot
pm2 start tzurot
```

## Scaling Considerations

### Vertical Scaling

1. **Increase Server Resources**:
   - Monitor CPU and memory usage
   - Upgrade when consistently >70% usage
   - Consider dedicated Discord gateway

2. **Optimize Application**:
   - Enable Node.js cluster mode
   - Implement caching layers
   - Use connection pooling

### Horizontal Scaling

Currently limited due to Discord bot constraints, but consider:

1. **Sharding** (for 2500+ guilds):
   ```javascript
   const { ShardingManager } = require('discord.js');
   const manager = new ShardingManager('./index.js', {
     token: process.env.DISCORD_TOKEN
   });
   manager.spawn();
   ```

2. **Microservices Architecture**:
   - Separate webhook service
   - Dedicated AI service proxy
   - Independent message queue

## Troubleshooting

### Common Deployment Issues

#### Bot Won't Start

1. **Check logs**:
   ```bash
   pm2 logs tzurot --lines 100
   journalctl -u tzurot -n 100
   ```

2. **Verify environment**:
   ```bash
   node --version  # Should be 16+
   npm list        # Check dependencies
   ```

3. **Test manually**:
   ```bash
   NODE_ENV=production node index.js
   ```

#### Connection Issues

1. **Discord connection**:
   - Verify token is correct
   - Check firewall rules
   - Ensure Discord API accessible

2. **AI Service connection**:
   - Test API endpoint directly
   - Verify API key validity
   - Check SSL/TLS certificates

#### Memory Issues

1. **Monitor usage**:
   ```bash
   pm2 monit
   htop -F node
   ```

2. **Analyze heap**:
   ```bash
   node --inspect index.js
   # Use Chrome DevTools for heap snapshot
   ```

3. **Implement limits**:
   ```bash
   node --max-old-space-size=512 index.js
   ```

### Emergency Procedures

#### Quick Restart

```bash
# PM2
pm2 restart tzurot

# Systemd
sudo systemctl restart tzurot

# Docker
docker-compose restart
```

#### Rollback Deployment

```bash
# Keep previous version
cp -r /opt/tzurot /opt/tzurot.backup

# Rollback if needed
rm -rf /opt/tzurot
mv /opt/tzurot.backup /opt/tzurot
pm2 restart tzurot
```

#### Disable Bot Temporarily

```bash
# Stop without removing
pm2 stop tzurot

# Maintenance mode (update presence)
# Add to bot.js ready event:
client.user.setPresence({
  status: 'dnd',
  activities: [{
    name: 'Maintenance Mode',
    type: 'PLAYING'
  }]
});
```

## Post-Deployment

### Verification Checklist

- [ ] Bot shows as online in Discord
- [ ] Commands respond correctly
- [ ] Personalities load properly
- [ ] Logs show no errors
- [ ] Memory usage stable
- [ ] API connections working
- [ ] Data persistence verified
- [ ] Backup system tested

### Maintenance Schedule

- **Daily**: Check logs for errors
- **Weekly**: Review resource usage
- **Monthly**: Update dependencies
- **Quarterly**: Security audit

### Documentation

Maintain deployment documentation:
- Server access credentials (secure storage)
- Deployment procedures
- Rollback procedures
- Contact information
- Incident response plan

## Success Metrics

### Technical Performance Targets

Monitor these key metrics to ensure healthy operation:

1. **Availability**
   - Target: 99%+ uptime
   - Measure: Health check endpoint monitoring
   - Alert threshold: < 95% in any hour

2. **Response Time**
   - Target: < 2 seconds average
   - Measure: AI response generation time
   - Alert threshold: > 5 seconds

3. **Error Rate**
   - Target: < 1% of requests
   - Measure: Failed commands and API calls
   - Alert threshold: > 5% in 5 minutes

4. **Memory Stability**
   - Target: Stable usage pattern
   - Measure: RSS memory over time
   - Alert threshold: Continuous growth over 24 hours

### User Experience Metrics

Track these to understand usage patterns:

1. **User Adoption**
   - Active users per day/week/month
   - New personality additions per week
   - Command usage frequency

2. **Personality Usage**
   - Most/least popular personalities
   - Average conversations per personality
   - Personality retention rate

3. **Feature Utilization**
   - Command usage distribution
   - Auto-response adoption rate
   - Channel activation frequency

4. **Conversation Metrics**
   - Average conversation length
   - Response satisfaction (based on continued interaction)
   - Peak usage hours