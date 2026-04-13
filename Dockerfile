# Use Node.js LTS
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Download yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN npm install

# Copy application files
COPY *.js ./

# Set environment variables
ENV NODE_ENV=production

# Run the application
CMD ["node", "index.js"]
