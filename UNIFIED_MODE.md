# Unified Mode Deployment

This application supports two deployment modes:

## Separate Mode (Development - Default)
Run frontend and backend on separate ports for development with hot reload:
- Frontend: http://localhost:5173 (Nuxt with hot reload)
- Backend: http://localhost:3000 (Express API server)

```bash
# Run both in separate terminals or together
npm run dev

# Or run individually
npm run dev:dashboard  # Frontend only
npm run dev:server     # Backend only
```

## Unified Mode (Production)
Run frontend and backend on a single port, ideal for production deployments without nginx:
- Single server: http://localhost:3000 (or your configured PORT)
- Frontend served from Express
- API available at /v1
- No proxy overhead, reduced latency

### Setup Unified Mode

1. Build the application:
```bash
npm run build:unified
```

2. Set environment variable:
```bash
# In .env file
UNIFIED_MODE=true

# Or inline
UNIFIED_MODE=true npm run start:unified
```

3. Start the unified server:
```bash
npm run start:unified
```

### Quick Development Test
To quickly test unified mode in development:
```bash
npm run dev:unified
```
This will build and start the unified server.

## Configuration

### Environment Variables
- `UNIFIED_MODE`: Set to `true` for unified mode, `false` for separate mode (default: `false`)
- `PORT`: The port to run the server on (default: `3000`)

### API Configuration
When running in unified mode, the frontend automatically uses the same origin for API calls, eliminating CORS issues and improving performance.

## Benefits

### Separate Mode
- Hot reload for rapid development
- Independent frontend/backend debugging
- Faster development iteration

### Unified Mode
- Single port deployment
- No nginx/proxy configuration needed
- Reduced latency (no proxy overhead)
- Simplified production deployment
- Easier Docker containerization
- Single process management

## Deployment Examples

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build:unified
ENV UNIFIED_MODE=true
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:unified"]
```

### PM2
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'hay-unified',
    script: 'npm',
    args: 'run start:unified',
    env: {
      NODE_ENV: 'production',
      UNIFIED_MODE: 'true',
      PORT: 3000
    }
  }]
}
```

### systemd
```ini
[Service]
Environment="NODE_ENV=production"
Environment="UNIFIED_MODE=true"
Environment="PORT=3000"
ExecStart=/usr/bin/npm run start:unified
WorkingDirectory=/path/to/hay-v3
```

## Troubleshooting

### Frontend not loading
Ensure you've built the frontend first:
```bash
npm run build:unified
```

### Port already in use
The unified server will attempt to clean up ports. If issues persist:
```bash
npm run kill-ports
```

### API calls failing in unified mode
Check that `UNIFIED_MODE=true` is set when building the frontend, as this configures the API base URL correctly.