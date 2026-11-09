FROM node:20-bookworm-slim

WORKDIR /app

# Install system utilities needed for yt-dlp, ffmpeg, python, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci

# Copy application files
COPY . .

# Set production environment and build Next.js
ENV NODE_ENV=production
RUN npm run build

# Expose custom server port
EXPOSE 3000
ENV PORT=3000

# Start the unified custom server (Next.js + WebSocket + Stream Proxy)
CMD ["npm", "start"]
