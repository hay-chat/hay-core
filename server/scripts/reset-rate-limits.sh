#!/bin/bash
# Script to reset all rate limits in Redis (for development/testing)

echo "🔄 Resetting rate limits..."

# Load environment variables from .env file
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
elif [ -f "../.env" ]; then
    export $(grep -v '^#' ../.env | xargs)
elif [ -f "../../.env" ]; then
    export $(grep -v '^#' ../../.env | xargs)
else
    echo "⚠️  No .env file found. Using default Redis connection settings."
fi

# Set Redis connection parameters from environment variables
REDIS_HOST=${REDIS_HOST:-localhost}
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_PASSWORD=${REDIS_PASSWORD:-}
REDIS_DB=${REDIS_DB:-0}
REDIS_TLS=${REDIS_TLS:-false}

# Build redis-cli command with connection parameters
REDIS_CMD="redis-cli -h $REDIS_HOST -p $REDIS_PORT -n $REDIS_DB"

# Add password if provided
if [ -n "$REDIS_PASSWORD" ]; then
    REDIS_CMD="$REDIS_CMD -a $REDIS_PASSWORD"
fi

# Add TLS if enabled
if [ "$REDIS_TLS" = "true" ]; then
    REDIS_CMD="$REDIS_CMD --tls"
fi

# Check if redis-cli is available
if ! command -v redis-cli &> /dev/null; then
    echo "❌ redis-cli not found. Please install Redis CLI tools."
    exit 1
fi

# Test Redis connection
echo "🔍 Testing Redis connection..."
echo "   Host: $REDIS_HOST"
echo "   Port: $REDIS_PORT"
echo "   Database: $REDIS_DB"
echo "   TLS: $REDIS_TLS"
echo "   Command: $REDIS_CMD"

if ! $REDIS_CMD ping > /dev/null 2>&1; then
    echo "❌ Cannot connect to Redis at $REDIS_HOST:$REDIS_PORT"
    echo "   Please check your Redis configuration and ensure Redis is running."
    echo "   If using TLS, make sure REDIS_TLS=true is set in your .env file."
    exit 1
fi

echo "🔗 Connected to Redis at $REDIS_HOST:$REDIS_PORT (database $REDIS_DB)"

# Delete all rate limit keys
echo "🗑️  Deleting rate limit keys..."
$REDIS_CMD KEYS "rate_limit:*" | xargs -r $REDIS_CMD DEL

echo "✅ All rate limits have been reset"
echo ""
echo "You can now test privacy requests again without hitting rate limits."
