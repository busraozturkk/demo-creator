#!/bin/bash

# Demo Creator Production Deployment Script
# Usage: ./deploy-prod.sh

set -e  # Exit on error

echo "Starting production deployment..."

# 1. Ensure we're on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    echo "Error: You must be on main branch to deploy to production"
    echo "Current branch: $current_branch"
    exit 1
fi

# 2. Pull latest changes
echo "Pulling latest changes from main..."
git pull origin main

# 3. Build the project
echo "Building TypeScript..."
npm run build

# 4. Create archive
echo "Creating deployment package..."
tar -czf demo-creator-update.tar.gz dist/ public/ views/ data/ package.json package-lock.json .env.example

# 5. Upload to server
echo "Uploading to production server..."
scp demo-creator-update.tar.gz ubuntu@10.30.1.201:~/

# 6. Extract and reload on server with new DEPLOY_TIME (graceful reload, keeps connections alive)
echo "Extracting and gracefully reloading application..."
DEPLOY_TIME=$(date +%s)
ssh ubuntu@10.30.1.201 "cd ~/demo-creator && tar -xzf ~/demo-creator-update.tar.gz && sed -i '/^DEPLOY_TIME=/d' .env && echo \"DEPLOY_TIME=$DEPLOY_TIME\" >> .env && pm2 reload demo-creator --update-env && rm ~/demo-creator-update.tar.gz"

# 7. Clean up local archive
echo "Cleaning up..."
rm demo-creator-update.tar.gz

echo "Production deployment completed successfully!"
echo "Application is running at: http://10.30.1.201:3000"
