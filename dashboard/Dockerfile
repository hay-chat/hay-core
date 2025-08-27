FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY nuxt.config.ts ./
COPY tailwind.config.ts ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start Nuxt in development mode for hot-reload
CMD ["npm", "run", "dev"]