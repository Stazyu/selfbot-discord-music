# Use Node.js LTS
FROM node:20-slim

# Set timezone
ENV TZ=Asia/Jakarta

# Set working directory
WORKDIR /app

# Install system dependencies + tzdata
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    python3 \
    python3-pip \
    tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# Download yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY *.js ./

# Set environment variables
ENV NODE_ENV=production

# Run the application
CMD ["node", "index.js"]