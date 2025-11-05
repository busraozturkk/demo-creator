# Token Management Guide

## Overview

The `COMPANY_CREATION_TOKEN` is a JWT token required for creating companies via the Clusterix API. This token:
- **Expires after ~7 days**
- Must be renewed before expiration to avoid service interruption
- Is tied to your personal Clusterix account

## Automatic Token Monitoring

The system now automatically checks token expiration:

### On Application Startup
- Validates token is present
- Checks if token is expired
- Warns if token expires within 2 days
- Shows expiration date and days remaining

### Daily Cron Job (Production)
A cron job runs daily at 9 AM on the production server:
```bash
0 9 * * * cd ~/demo-creator && node scripts/check-token-expiry.js >> ~/demo-creator/logs/token-check.log 2>&1
```

Check logs:
```bash
tail -f ~/demo-creator/logs/token-check.log
```

### Manual Check
Run anytime to check token status:
```bash
node scripts/check-token-expiry.js
```

## How to Renew Token

### Step 1: Get New Token from Clusterix

1. Login to https://clusterix.io with your **personal account**
2. Open Browser Developer Tools (F12)
3. Go to **Network** tab
4. Navigate to company-related page or search for a company
5. Find API request to `company-searcher-api.innoscripta.com`
6. Copy the **entire** `Authorization` header value (including `Bearer `)

Example:
```
Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOi...
```

### Step 2: Update Local .env

Edit your local `.env` file:
```bash
COMPANY_CREATION_TOKEN="Bearer eyJ0eXAiOiJKV1QiLCJhbGc..."
```

**IMPORTANT:**
- Include `Bearer ` prefix
- Wrap in double quotes
- No extra spaces or newlines
- Copy the FULL token

### Step 3: Deploy to Production

#### Option A: Using SCP (Recommended)
```bash
# From your local machine
scp .env ubuntu@ip-10-30-1-201.eu-central-1.compute.internal:~/demo-creator/.env

# Restart PM2
ssh ubuntu@ip-10-30-1-201.eu-central-1.compute.internal "cd demo-creator && pm2 restart all"
```

#### Option B: Manual Update on Server
```bash
# SSH to production
ssh ubuntu@ip-10-30-1-201.eu-central-1.compute.internal

# Edit .env
cd demo-creator
nano .env
# Update COMPANY_CREATION_TOKEN value

# Restart
pm2 restart all
```

### Step 4: Verify

Check application logs to ensure token is valid:
```bash
# Production
ssh ubuntu@ip-10-30-1-201.eu-central-1.compute.internal "cd demo-creator && pm2 logs --lines 50"

# Look for:
# ✓ Token is valid. Expires on: ... (X days remaining)
```

## Troubleshooting

### Token Already Expired
**Error:** `COMPANY_CREATION_TOKEN has EXPIRED!`

**Solution:**
1. Get new token immediately (see Step 1)
2. Update .env file (see Step 2)
3. Deploy to production (see Step 3)

### Token Format Error
**Error:** `Invalid JWT token format`

**Cause:** Token not properly formatted in .env

**Solution:**
Ensure .env has:
```bash
COMPANY_CREATION_TOKEN="Bearer eyJ0eXAi..."
```
NOT:
```bash
COMPANY_CREATION_TOKEN=Bearer eyJ0eXAi...  # Missing quotes
COMPANY_CREATION_TOKEN="eyJ0eXAi..."       # Missing Bearer
COMPANY_CREATION_TOKEN=eyJ0eXAi...         # Missing both
```

### Company Creation Fails with 500 Error
**Possible Causes:**
1. Token expired
2. Token format incorrect
3. Production .env not updated

**Debug Steps:**
```bash
# Check token on production
ssh ubuntu@ip-10-30-1-201.eu-central-1.compute.internal "cd demo-creator && node scripts/check-token-expiry.js"

# Check .env format
ssh ubuntu@ip-10-30-1-201.eu-central-1.compute.internal "cd demo-creator && head -10 .env"
```

## Best Practices

1. **Renew Proactively**: Don't wait until token expires. Renew when you see the 2-day warning.

2. **Keep Backup**: Save the new token somewhere safe (password manager) in case you need to redeploy.

3. **Monitor Logs**: Check `~/demo-creator/logs/token-check.log` regularly.

4. **Test Locally First**: After getting new token, test locally before deploying to production.

5. **Document Changes**: Note when you renew tokens for audit trail.

## Quick Reference

| Task | Command |
|------|---------|
| Check token status | `node scripts/check-token-expiry.js` |
| View cron logs | `tail -f ~/demo-creator/logs/token-check.log` |
| Update production .env | `scp .env ubuntu@production:~/demo-creator/` |
| Restart production | `ssh ubuntu@production "cd demo-creator && pm2 restart all"` |
| Check PM2 logs | `ssh ubuntu@production "pm2 logs"` |

## Support

If you encounter issues with token renewal:
1. Check this guide first
2. Review DEPLOYMENT.md
3. Check application logs
4. Contact DevOps team if problem persists
