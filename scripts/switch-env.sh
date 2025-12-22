#!/bin/bash

# Script to switch between local and cloud environments

ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

show_usage() {
    echo "Usage: ./scripts/switch-env.sh [local|cloud|status]"
    echo ""
    echo "Commands:"
    echo "  local   - Switch to local development environment"
    echo "  cloud   - Switch to cloud/production environment"
    echo "  status  - Show current environment"
    echo ""
}

show_status() {
    if [ -L "$ENV_DIR/.env" ]; then
        CURRENT=$(readlink "$ENV_DIR/.env")
        echo "Current environment: ${CURRENT#.env.}"
        echo "(.env is a symlink to $CURRENT)"
    else
        echo "⚠️  Warning: .env is not a symlink"
        echo "Run this script with 'local' or 'cloud' to set up proper environment switching"
    fi
}

switch_to_local() {
    if [ ! -f "$ENV_DIR/.env.local" ]; then
        echo "❌ Error: .env.local not found"
        exit 1
    fi

    ln -sf .env.local "$ENV_DIR/.env"
    echo "✅ Switched to local development environment"
    echo "Database: localhost:5432"
    echo "Redis: localhost:6379"
}

switch_to_cloud() {
    if [ ! -f "$ENV_DIR/.env.cloud" ]; then
        echo "❌ Error: .env.cloud not found"
        exit 1
    fi

    ln -sf .env.cloud "$ENV_DIR/.env"
    echo "✅ Switched to cloud environment"
    echo "Database: DigitalOcean"
    echo "Redis: DigitalOcean"
}

# Main
case "$1" in
    local)
        switch_to_local
        ;;
    cloud)
        switch_to_cloud
        ;;
    status)
        show_status
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
