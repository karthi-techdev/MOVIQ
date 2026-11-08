FROM node:20-bullseye-slim

# Install system dependencies: ffmpeg for audio/video transcoding, python3 for streaming
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp for reliable YouTube stream resolution
RUN pip3 install --no-cache-dir yt-dlp

# Set up user according to Hugging Face Spaces requirements (UID 1000)
RUN useradd -m -u 1000 user
WORKDIR /app

# Copy dependency manifests
COPY --chown=user:user package*.json ./

# Install npm dependencies
RUN npm install

# Copy application code
COPY --chown=user:user . .

# Set environment variables for Hugging Face
ENV NODE_ENV=production
ENV PORT=7860
ENV HOST=0.0.0.0

# Build Next.js production bundle
RUN npm run build

# Ensure write permissions for cache and temporary files
RUN mkdir -p /app/public/assets/movies/cache && chown -R user:user /app

USER user

EXPOSE 7860

CMD ["npm", "start"]
