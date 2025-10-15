#!/usr/bin/env node

/**
 * Token Expiry Checker
 *
 * Checks if COMPANY_CREATION_TOKEN is expired or will expire soon.
 * Can be run as a cron job to alert before expiration.
 *
 * Usage:
 *   node scripts/check-token-expiry.js
 *
 * Cron example (daily at 9 AM):
 *   0 9 * * * cd /path/to/demo-creator && node scripts/check-token-expiry.js
 */

require('dotenv').config();

function checkTokenExpiry() {
    const token = process.env.COMPANY_CREATION_TOKEN;

    if (!token) {
        console.error('❌ ERROR: COMPANY_CREATION_TOKEN not found in .env file');
        process.exit(1);
    }

    try {
        // Extract JWT payload (remove 'Bearer ' if present)
        const jwtToken = token.replace(/^Bearer\s+/i, '');
        const parts = jwtToken.split('.');

        if (parts.length !== 3) {
            console.error('❌ ERROR: Invalid JWT token format');
            process.exit(1);
        }

        // Decode payload
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

        if (!payload.exp) {
            console.warn('⚠️  WARNING: Token does not have expiration time');
            return;
        }

        const expiresAt = new Date(payload.exp * 1000);
        const now = new Date();
        const msUntilExpiry = expiresAt.getTime() - now.getTime();
        const daysUntilExpiry = Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24));
        const hoursUntilExpiry = Math.floor(msUntilExpiry / (1000 * 60 * 60));

        console.log('\n========================================');
        console.log('  COMPANY_CREATION_TOKEN Status');
        console.log('========================================\n');

        if (now > expiresAt) {
            const daysAgo = Math.abs(daysUntilExpiry);
            console.error('❌ TOKEN EXPIRED!');
            console.error(`   Expired: ${expiresAt.toLocaleString()}`);
            console.error(`   Expired ${daysAgo} days ago\n`);
            console.error('ACTION REQUIRED:');
            console.error('  1. Get new token from https://clusterix.io');
            console.error('  2. Update .env file with new token');
            console.error('  3. See DEPLOYMENT.md for detailed instructions\n');

            // Don't send alerts if already expired for more than 1 day (avoid spam)
            if (daysAgo > 1) {
                console.log('Note: Skipping repeated alerts for expired token (already expired for', daysAgo, 'days)');
                process.exit(0); // Exit without error to avoid cron spam
            }
            process.exit(1);
        } else if (daysUntilExpiry <= 2) {
            console.warn('⚠️  TOKEN EXPIRING SOON!');
            console.warn(`   Expires: ${expiresAt.toLocaleString()}`);
            console.warn(`   Time remaining: ${daysUntilExpiry} days (${hoursUntilExpiry} hours)\n`);
            console.warn('ACTION RECOMMENDED:');
            console.warn('  Update token soon to avoid service interruption');
            console.warn('  See DEPLOYMENT.md for instructions\n');
            process.exit(0);
        } else if (daysUntilExpiry <= 5) {
            console.warn('⚠️  Token will expire soon');
            console.warn(`   Expires: ${expiresAt.toLocaleString()}`);
            console.warn(`   Days remaining: ${daysUntilExpiry}\n`);
            console.log('Consider updating token in the next few days\n');
            process.exit(0);
        } else {
            console.log('✅ Token is valid');
            console.log(`   Expires: ${expiresAt.toLocaleString()}`);
            console.log(`   Days remaining: ${daysUntilExpiry}\n`);
            process.exit(0);
        }
    } catch (error) {
        console.error('❌ ERROR checking token:', error.message);
        process.exit(1);
    }
}

checkTokenExpiry();
