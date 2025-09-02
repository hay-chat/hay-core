# Backend Deployment Guide

## Digital Ocean App Platform

### Quick Setup

1. Connect your GitHub repository to Digital Ocean App Platform
2. Use the configuration from `.do/app.yaml`

### Build Command:
```bash
npm ci
cd server && npm ci && cd ..
npm run build:server
```

### Run Command:
```bash
cd server && npm start
```

### Required Environment Variables:

```env
# Server
NODE_ENV=production
PORT=8080

# Database (PostgreSQL with pgvector)
DB_HOST=your-db-host
DB_PORT=5432
DB_USERNAME=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
DB_SSL=true

# Security
JWT_SECRET=generate-secure-random-string
JWT_REFRESH_SECRET=generate-another-secure-string

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# CORS (add your frontend domain)
CORS_ORIGIN=https://yourdomain.com
```

## Local Testing

1. Build the server:
```bash
cd server
npm run build
```

2. Start the server:
```bash
npm start
```

The API will be available at `http://localhost:3000/v1`

## Database Setup

1. Create PostgreSQL database with extensions:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

2. Run migrations:
```bash
npm run migration:run
```

## Endpoints

- `/v1` - tRPC API endpoint
- `/ws` - WebSocket connection
- `/plugins/webhooks/*` - Plugin webhook endpoints
- `/plugins/assets/*` - Plugin asset serving

## Monitoring

- Check server logs for startup confirmation
- API should respond at `/v1`
- Database connection status shown in logs