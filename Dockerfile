# Builder
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache \
    curl \
    python3 \
    build-base

# Download yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /yt-dlp \
    && chmod a+rx /yt-dlp

# Copy package files
COPY package.json tsconfig.json ./

# Install ALL dependencies (including dev for TypeScript)
RUN npm install

# Copy source files
COPY src ./src/

# Build TypeScript
RUN npx tsc

# Runtime
FROM node:20-alpine

ENV TZ=Asia/Jakarta
ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache \
    ffmpeg \
    python3 \
    tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

COPY --from=builder /yt-dlp /usr/local/bin/yt-dlp

# Copy only production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy built output + config
COPY --from=builder /app/dist ./dist/

# Run the application
CMD ["node", "dist/index.js"]
