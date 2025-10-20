# syntax=docker/dockerfile:1

# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first for better caching
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy built assets and server
COPY --from=build /app/dist ./dist
COPY server.js ./server.js

# Create minimal package.json for server runtime and set ESM mode
RUN node -e "const fs=require('fs');fs.writeFileSync('package.json', JSON.stringify({name:'readis-server',version:'1.0.0',type:'module'}, null, 2))"

# Install only runtime dependencies
RUN npm install --no-audit --no-fund express compression

EXPOSE 3000
CMD ["node", "server.js"]
