#!/bin/bash
set -e

echo "🔨 Starting production build..."

# Install root dependencies
echo "📦 Installing root dependencies..."
npm ci --include=dev

# Install dashboard dependencies  
echo "📦 Installing dashboard dependencies..."
cd dashboard
npm ci --include=dev
cd ..

# Install server dependencies
echo "📦 Installing server dependencies..."
cd server
npm ci --include=dev
cd ..

# Build unified mode
echo "🏗️ Building unified application..."
export UNIFIED_MODE=true
export NODE_ENV=production

# Build dashboard
cd dashboard
echo "🎨 Building frontend..."
npm run build
cd ..

# Build server
cd server
echo "⚙️ Building backend..."
npm run build
cd ..

echo "✅ Build complete!"
echo "📝 To start the application, run: npm run start:unified"