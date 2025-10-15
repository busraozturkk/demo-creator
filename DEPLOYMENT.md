
# Deployment Guide

## Overview
Demo Creator is an automated tool for creating demo accounts in the Clusterix HR system with complete employee, project, and task data.

## Tech Stack
- **Runtime**: Node.js (v18+)
- **Language**: TypeScript
- **Framework**: Express.js
- **Real-time**: Socket.IO
- **Browser Automation**: Puppeteer
- **Template Engine**: EJS

## Prerequisites

### System Requirements
- Node.js >= 18.x
- npm >= 9.x
- Chrome/Chromium (for Puppeteer)
- Minimum 2GB RAM
- Minimum 1GB disk space

### Dependencies
All dependencies are listed in `package.json`:
- Production dependencies: axios, puppeteer, express, socket.io, dotenv, etc.
- No external databases required (uses file-based caching)

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Company Creation Token
COMPANY_CREATION_TOKEN=your-token-here

# Testing Environment
TESTING_EMAIL=your-testing-email@yopmail.com
TESTING_PASSWORD=YourPassword123!

# Production Environment (optional)
PROD_EMAIL=your-prod-email@yopmail.com
PROD_PASSWORD=YourPassword123!
```

### Required Environment Variables
- `COMPANY_CREATION_TOKEN` - JWT token for company creation API (see renewal instructions below)
- `TESTING_EMAIL` - Email for testing environment (must be @yopmail.com)
- `TESTING_PASSWORD` - Password for testing environment
- `PROD_EMAIL` - Email for production environment (optional)
- `PROD_PASSWORD` - Password for production environment (optional)

### Company Creation Token Renewal

The `COMPANY_CREATION_TOKEN` is a JWT token that expires after approximately 7 days. When it expires, you'll see an error:

```
Authorization token expired. Please update the token.
```

**How to get a new token:**

1. Login to Clusterix platform (https://clusterix.io) with your **personal account**
2. Open browser Developer Tools (F12)
3. Go to Network tab
4. Navigate to any company-related page or make a company search
5. Look for API requests to `company-searcher-api.innoscripta.com`
6. Find the request and copy the `Authorization` header value (starts with `Bearer `)
7. Remove `Bearer ` prefix and copy only the JWT token
8. Update `.env` file:
   ```bash
   COMPANY_CREATION_TOKEN=eyJ0eXAiOiJKV1QiLCJhbGc...
   ```
9. Restart the application

**Alternative method using cURL:**

```bash
# Login to get token
curl -X POST https://api-testing.innoscripta.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@innoscripta.com","password":"your-password"}'

# Copy the token from response and add to .env
```

**Important Notes:**
- Token is tied to **your personal Clusterix account**
- Token expires after ~7 days
- Keep token secure - don't commit to git
- Token has same permissions as your user account

### Optional API URLs
The application has hardcoded defaults for all API URLs. You can override them:
- `TESTING_API_BASE_URL`
- `TESTING_HR_API_BASE_URL`
- `TESTING_TASK_MANAGEMENT_API_BASE_URL`
- `TESTING_IMS_CUSTOMERS_API_BASE_URL`
- (Same variables with `PROD_` prefix for production)

## Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Running the Application

### Option 1: CLI Mode (Development)
```bash
npm run dev
```

### Option 2: Web UI Mode
```bash
npm run ui
```
Then open http://localhost:3000 in your browser.

### Option 3: Production Mode
```bash
npm run build
npm start
```

## Port Configuration
- Default port: **3000**
- Change by setting `PORT` environment variable:
  ```bash
  PORT=8080 npm run ui
  ```

## Directory Structure

```
demo-creator/
├── src/                    # TypeScript source files
│   ├── operations/        # Business logic modules
│   ├── api-client.ts      # API communication
│   ├── environment.ts     # Environment configuration
│   ├── index.ts          # CLI entry point
│   └── ui-server.ts      # Web UI server
├── data/                  # Data files
│   ├── avatars/          # Employee profile pictures
│   └── cache/            # Runtime cache (gitignored)
├── public/               # Static web assets
│   ├── css/
│   └── js/
├── views/                # EJS templates
├── dist/                 # Compiled JavaScript (gitignored)
└── node_modules/         # Dependencies (gitignored)
```

## Cache Files
The application creates cache files in `data/cache/` during runtime:
- These are **temporary** and **should not be committed**
- Already included in `.gitignore`
- Safe to delete between runs

## Build Process

```bash
# TypeScript compilation
npm run build

# Output directory
dist/
```

## Deployment Checklist

### 1. Pre-deployment
- [ ] Ensure `.env` file is NOT committed to git
- [ ] Verify `.gitignore` includes sensitive files
- [ ] Run `npm run build` successfully
- [ ] Test in both CLI and UI modes
- [ ] Check all dependencies are in `package.json`

### 2. Server Setup
- [ ] Install Node.js 18+ on server
- [ ] Clone repository
- [ ] Run `npm install`
- [ ] Create `.env` file with production credentials
- [ ] Run `npm run build`

### 3. Process Management (Recommended)
Use PM2 or similar process manager:

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start dist/ui-server.js --name demo-creator

# Enable auto-restart on server reboot
pm2 startup
pm2 save
```

### 4. Reverse Proxy (Nginx Example)
```nginx
server {
    listen 80;
    server_name demo-creator.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Security Considerations

### Sensitive Data
- **Never commit** `.env` file
- **Never commit** cache files with real data
- Email must use **@yopmail.com** domain for testing

### API Access
- Application makes API calls to:
  - `api-testing.innoscripta.com` (testing)
  - `innos-hr-backend-testing.innoscripta.com` (testing HR)
  - `task-management-backend-testing.innoscripta.com` (testing tasks)
  - Same domains without `-testing` suffix for production

### Firewall Rules
Ensure outbound HTTPS (443) access to:
- `*.innoscripta.com`
- `yopmail.com` (for email verification)

## Monitoring & Logs

### Application Logs
- Logs are output to console (stdout/stderr)
- Use PM2 or systemd to capture logs:
  ```bash
  pm2 logs demo-creator
  ```

### Health Check
- Web UI: `GET http://localhost:3000/`
- Returns 200 OK if healthy

## Troubleshooting

### Puppeteer Issues
If Puppeteer fails to launch Chrome:
```bash
# Install Chrome dependencies (Ubuntu/Debian)
apt-get install -y chromium-browser

# Or set executable path in environment
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### Port Already in Use
```bash
# Change port
PORT=8080 npm run ui
```

### Memory Issues
- Increase Node.js memory limit:
  ```bash
  NODE_OPTIONS=--max-old-space-size=4096 npm run ui
  ```

## Backup & Recovery
- No database to backup
- Configuration is in `.env` file
- Cache files are temporary and regenerated

## Scaling Considerations
- Single instance recommended (browser automation is resource-intensive)
- Not designed for horizontal scaling
- Consider queuing system for multiple concurrent requests

## Contact
For deployment support, contact DevOps team with:
- Node.js version
- Operating system
- Error logs from `pm2 logs` or console
- Environment (testing/production)
