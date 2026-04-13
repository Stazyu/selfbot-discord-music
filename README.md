# Discord Music Selfbot

A Discord selfbot for playing music in voice channels using yt-dlp and FFmpeg. Supports YouTube videos, playlists, and radio streaming.

## ⚠️ Warning

**This is a selfbot, not a regular bot.** Using selfbots violates Discord's Terms of Service and may result in your account being banned. Use at your own risk.

## Features

- 🎵 Play YouTube videos and playlists
- 📻 Stream radio stations from Radio Browser
- ⏭️ Skip and stop music controls
- 🎧 Queue system for multiple songs
- 🔊 High-quality audio streaming via FFmpeg

## Prerequisites

- Node.js (v16 or higher)
- FFmpeg (included via `ffmpeg-static`)
- yt-dlp executable (included in this project)

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Configure your bot:
   - Copy `config.example.json` to `config.json`
   - Open `config.json`
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

Run the bot:
```bash
node index.js
```

## Commands

All commands use the `?` prefix. You must be in a voice channel to use them.

| Command | Usage | Description |
|---------|-------|-------------|
| `?play` | `?play <song name or URL>` | Play a song from YouTube |
| `?play` | `?play <playlist URL> [limit]` | Play a YouTube playlist (optional limit) |
| `?skip` | `?skip` | Skip the current song |
| `?stop` | `?stop` | Stop playing and clear the queue |
| `?radio` | `?radio <station name or URL>` | Play a radio station |
| `?help` | `?help` | Show all available commands |

### Examples

```
?play never gonna give you up
?play https://www.youtube.com/watch?v=dQw4w9WgXcQ
?play https://www.youtube.com/playlist?list=xyz 10
?radio Jazz
?radio https://stream.example.com
```

## Configuration

### Token
Edit `index.js` and change:
```javascript
const TOKEN = "YOUR_DISCORD_TOKEN_HERE"
```

### Prefix
Change the command prefix in `index.js`:
```javascript
const PREFIX = "?"
```

## Dependencies

- `discord.js-selfbot-v13` - Discord API wrapper for selfbots
- `@discordjs/voice` - Voice connection support
- `@discordjs/opus` - Opus codec for audio
- `ffmpeg-static` - Static FFmpeg binary
- `yt-search` - YouTube search functionality
- `@distube/ytdl-core` - YouTube downloader

## Troubleshooting

- **Bot won't connect to voice**: Ensure you're in a voice channel before using commands
- **Audio not playing**: Check that FFmpeg and yt-dlp are properly installed
- **Playlist not loading**: Verify the playlist URL is public and accessible
- **Radio not working**: Some radio stations may be offline or have changed URLs

## License

ISC

## Disclaimer

This project is for educational purposes only. The author is not responsible for any account bans or issues arising from the use of this selfbot.
