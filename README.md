# Discord Music Selfbot

A Discord selfbot for playing music in voice channels using yt-dlp and FFmpeg. Supports YouTube videos, playlists, and radio streaming.

## ⚠️ Warning

**This is a selfbot, not a regular bot.** Using selfbots violates Discord's Terms of Service and may result in your account being banned. Use at your own risk.

## Features

- 🎵 Play YouTube videos, playlists, and multiple URLs
- 📻 Stream radio stations from Radio Browser with metadata detection
- ⏭️ Skip, stop, and volume controls
- 🎧 Advanced queue system with shuffle and loop modes
- 🔊 High-quality audio streaming via FFmpeg
- 🎛️ Interactive reaction UI control panel
- 💾 Persistent state saving across restarts
- 🔄 Automatic reconnection for interrupted streams
- 🧹 Chat cleanup and reaction management
- 📊 Detailed bot state monitoring

## Prerequisites

- Node.js (v16 or higher) - for local installation
- Docker - for containerized deployment

## Installation

### Option 1: Docker (Recommended)

1. Clone or download this repository

2. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Open `.env`
   - Set your Discord token and prefix:
     ```env
     DISCORD_TOKEN=your_discord_token_here
     DISCORD_PREFIX=?
     ```
   - **⚠️ Never share your token or commit .env to git!**

3. Run with Docker Compose:
```bash
docker-compose up -d
```

Or build and run manually:
```bash
docker build -t discord-music-bot .
docker run -e DISCORD_TOKEN=your_token -e DISCORD_PREFIX=? discord-music-bot
```

### Option 2: Local Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Configure your bot:
   - **Option A (Recommended)**: Use environment variables
     - Copy `.env.example` to `.env`
     - Set `DISCORD_TOKEN` and `DISCORD_PREFIX` in `.env`
     - Run with: `node index.js`
   - **Option B**: Use config.json (legacy)
     - Copy `config.example.json` to `config.json`
     - Replace `YOUR_DISCORD_TOKEN_HERE` with your Discord account token
     - You can also change the `prefix` if desired
     - **⚠️ Never share your token or commit config.json to git!**

4. Download yt-dlp:
   - **Windows**: Download `yt-dlp.exe` from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) and place it in the project directory
   - **Linux**: Run the following commands in the project directory:
     ```bash
     wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
     chmod +x yt-dlp
     ```
     Or download manually from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases)
   - **Mac**: Same as Linux, or install via Homebrew: `brew install yt-dlp`

## Usage

### Docker
```bash
docker-compose up -d
```

### Local
```bash
node index.js
```

## Commands

All commands use the `?` prefix. You must be in a voice channel to use them.

| Command | Usage | Description |
|---------|-------|-------------|
| `?play` | `?play <song name or URL>` | Play a song from YouTube |
| `?play` | `?play <playlist URL> [limit]` | Play a YouTube playlist (optional limit) |
| `?play` | `?play <URL1 URL2 URL3...>` | Play multiple URLs (space-separated) |
| `?skip` | `?skip` | Skip the current song |
| `?stop` | `?stop` | Stop playing and clear queue |
| `?loop` | `?loop` | Toggle loop mode (Off/Single/All) |
| `?shuffle` | `?shuffle` | Shuffle the current queue |
| `?queue` | `?queue` | Show current queue and loop mode |
| `?volume` | `?volume [0-100]` | Set or check playback volume |
| `?radio` | `?radio <station name or URL>` | Play a radio station |
| `?clearchat` | `?clearchat [number]` | Delete messages (default 100, max 100) |
| `?clearreactions` | `?clearreactions` | Remove all reactions from channel |
| `?leave` | `?leave` | Leave voice channel and clear queue |
| `?sync` | `?sync` | Sync channel IDs and rejoin voice channel |
| `?panel` | `?panel` | Show control panel with reaction UI |
| `?state` | `?state` | Show current bot state |
| `?help` | `?help` | Show all available commands |

### Examples

```
?play never gonna give you up
?play https://www.youtube.com/watch?v=dQw4w9WgXcQ
?play https://www.youtube.com/playlist?list=xyz 10
?play https://youtu.be/abc123 https://youtu.be/def456 https://youtu.be/ghi789
?radio Jazz
?radio https://stream.example.com
?volume 75
?loop
?shuffle
?queue
?panel
?state
```

## Configuration

### Environment Variables (Recommended)

Set these environment variables:

- `DISCORD_TOKEN` - Your Discord account token (required)
- `DISCORD_PREFIX` - Command prefix (default: `?`)
- `ALLOWED_USERS` - Comma-separated list of Discord user IDs (optional, for access control)

**Docker**: Set in `.env` file or Docker Compose environment section
**Local**: Set in `.env` file or system environment variables

### Config File (Legacy)

You can also use `config.json`:
```json
{
  "token": "YOUR_DISCORD_TOKEN_HERE",
  "prefix": "?",
  "allowedUsers": ["user_id_1", "user_id_2"]
}
```

**Note**: Environment variables take precedence over config.json

## Dependencies

- `discord.js-selfbot-v13` - Discord API wrapper for selfbots
- `@discordjs/voice` - Voice connection support
- `@discordjs/opus` - Opus codec for audio
- `ffmpeg-static` - Static FFmpeg binary
- `yt-search` - YouTube search functionality
- `youtube-video-id` - YouTube video ID extraction
- `node-fetch` - HTTP requests for radio metadata
- `icy` - ICY metadata parsing for radio streams
- `dotenv` - Environment variable management

## Troubleshooting

- **Bot won't connect to voice**: Ensure you're in a voice channel before using commands
- **Audio not playing**: Check that FFmpeg and yt-dlp are properly installed (Docker includes these automatically)
- **Docker build fails**: Ensure Docker is running and you have sufficient disk space
- **Environment variables not working**: Verify `.env` file is in the project root and properly formatted
- **Playlist not loading**: Verify the playlist URL is public and accessible
- **Radio not working**: Some radio stations may be offline or have changed URLs
- **Bot not responding**: Check if you're in the allowed users list (if `ALLOWED_USERS` is configured)
- **State not saving**: Ensure the bot has write permissions in the project directory
- **Reactions not working**: Make sure the bot has permission to add/remove reactions in the channel

## Deployment

### Coolify
1. Connect your Git repository
2. Select "Dockerfile" as build type
3. Set environment variables in Coolify UI:
   - `DISCORD_TOKEN`: your token
   - `DISCORD_PREFIX`: `?` (or your preferred prefix)
4. Deploy

### Other Platforms
Most PaaS platforms (Railway, Render, etc.) support Docker. Use the Dockerfile and set environment variables in their dashboard.

## License

ISC

## Disclaimer

This project is for educational purposes only. The author is not responsible for any account bans or issues arising from the use of this selfbot.
