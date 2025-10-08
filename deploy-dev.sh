#!/bin/bash

# Demo Creator Development Deployment Script
# Usage: ./deploy-dev.sh

set -e  # Exit on error

echo "Starting development deployment..."

# 1. Ensure we're on development branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "development" ]; then
    echo "Error: You must be on development branch to deploy to dev environment"
    echo "Current branch: $current_branch"
    exit 1
fi

# 2. Build the project
echo "Building TypeScript..."
npm run build

# 3. Create archive
echo "Creating deployment package..."
tar -czf demo-creator-update.tar.gz dist/ public/ views/ data/ package.json package-lock.json .env.example

# 4. Upload to server
echo "Uploading to server..."
scp demo-creator-update.tar.gz ubuntu@10.30.1.201:~/

# 5. Extract and restart on server
echo "Extracting and restarting application..."
ssh ubuntu@10.30.1.201 "cd ~/demo-creator && tar -xzf ~/demo-creator-update.tar.gz && pm2 restart demo-creator && rm ~/demo-creator-update.tar.gz"

# 6. Clean up local archive
echo "Cleaning up..."
rm demo-creator-update.tar.gz

echo "Development deployment completed successfully!"
echo "Application is running at: http://10.30.1.201:3000"
