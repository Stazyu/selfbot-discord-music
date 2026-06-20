# Discord Music Selfbot

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20.x-339933?style=flat-square&logo=node.js" alt="Node.js"/>
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Discord.js_Selfbot-v13-5865F2?style=flat-square&logo=discord" alt="Discord.js Selfbot"/>
  <img src="https://img.shields.io/badge/license-ISC-blue?style=flat-square" alt="License"/>
  <img src="https://img.shields.io/badge/yt--dlp-powered-FF0000?style=flat-square&logo=youtube" alt="yt-dlp"/>
</p>

A feature-rich Discord selfbot for streaming high-quality music in voice channels via YouTube and internet radio. Built with TypeScript, [`discord.js-selfbot-v13`](src/../package.json:14), [`yt-dlp`](src/services/youtube.ts:6), and [`FFmpeg`](src/services/radio.ts:68). Supports YouTube videos, playlists, radio stations from the global Radio Browser directory, an advanced queue system, and an interactive reaction-based control panel.

---

## ⚠️ Disclaimer & Warning

> **This is a selfbot, not a regular bot.** Selfbots automate user accounts, which **violates [Discord's Terms of Service](https://discord.com/terms)**. Using this project **may result in your account being permanently banned**.
>
> This project is provided **for educational purposes only**. The author is **not responsible** for any account suspensions, bans, or other consequences arising from its use. **Use at your own risk.**

---

## ✨ Features

| Category | Features |
|----------|----------|
| **🎵 YouTube Playback** | Search and play songs by name, play single/multiple URLs, fetch entire playlists with optional item limits, cookies-based authentication for age-restricted content |
| **📻 Radio Streaming** | Search global Radio Browser by station name, direct stream URL support, automatic codec detection, real-time song metadata via ICY protocol |
| **🎛️ Queue Management** | Add/remove songs, shuffle the queue, three loop modes (Off / Single / All), view full queue exported as `.txt` file, play history tracking (last 10) |
| **🔊 Audio Controls** | Volume adjustment (0%–500%), play/pause, skip, stop, seamless transition between music and radio modes |
| **🖥️ Interactive UI** | Reaction-based control panel with 10 buttons (⏮ ⏯️ ⏭ 🔉 🔊 ⏹ 📻 🎵 🗑️ ℹ️), per-song reaction controls (⏯ ⏭ 🔉 🔊 ⏹) |
| **🔄 Resilience** | Automatic reconnection with exponential backoff for stream interruptions (yt-dlp, FFmpeg, radio), voice state monitoring — auto-rejoins when kicked, saved resume position on disconnect |
| **💾 Persistent State** | Saves queue, radio station, volume, loop mode, play history, and resume position to [`state.json`](src/core/queue.ts:7). Auto-restores everything on restart |
| **🔇 Silent Mode** | Toggle to route all bot messages to your DMs instead of the server text channel |
| **🧹 Chat Management** | Bulk-delete bot messages (up to 100), remove all reactions from channel messages |
| **📊 Monitoring** | Detailed bot state inspector, radio stream statistics (size, uptime, reconnect attempts), now-playing display with progress |
| **🐳 Deployment Ready** | Multi-stage Docker build, Docker Compose support, Coolify one-click deploy, environment-variable based configuration |

---

## 📋 Table of Contents

- [⚠️ Disclaimer & Warning](#️-disclaimer--warning)
- [✨ Features](#-features)
- [🏗️ Architecture Overview](#️-architecture-overview)
- [📋 Prerequisites](#-prerequisites)
- [🚀 Installation](#-installation)
  - [Option 1: Docker (Recommended)](#option-1-docker-recommended)
  - [Option 2: Local Installation](#option-2-local-installation)
- [⚙️ Configuration](#️-configuration)
  - [Environment Variables](#environment-variables-recommended)
  - [Config File (Legacy)](#config-file-legacy)
  - [YouTube Cookies](#youtube-cookies)
- [🎮 Command Reference](#-command-reference)
- [🖱️ Usage Examples](#️-usage-examples)
- [🎛️ Interactive Control Panel](#️-interactive-control-panel)
- [🔄 Auto-Reconnection & Resilience](#-auto-reconnection--resilience)
- [🔇 Silent Mode](#-silent-mode)
- [📁 Project Structure](#-project-structure)
- [🚢 Deployment](#-deployment)
  - [Docker / Docker Compose](#docker--docker-compose)
  - [Coolify](#coolify)
  - [Other Platforms](#other-platforms)
- [🔧 Troubleshooting](#-troubleshooting)
- [❓ FAQ](#-faq)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## 🏗️ Architecture Overview

The project follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────┐
│                    src/index.ts                      │
│            Client bootstrap & event wiring           │
└──────┬──────────────────────────────────┬────────────┘
       │                                  │
       ▼                                  ▼
┌──────────────┐                  ┌──────────────┐
│  commands/   │◄─────msg────────│  core/        │
│  index.ts    │                  │  queue.ts     │
│              │                  │  player.ts    │
│  music.ts    │                  │  voice.ts     │
│  radio.ts    │                  └──────┬────────┘
│  utility.ts  │                         │
└──────┬───────┘                         ▼
       │                         ┌──────────────┐
       │                         │  services/    │
       │                         │  youtube.ts   │
       │                         │  radio.ts     │
       │                         │  radioMetadata│
       │                         └──────┬────────┘
       │                                │
       ▼                                ▼
┌──────────────┐                  ┌──────────────┐
│  ui/          │                  │  utils/       │
│  embeds.ts    │                  │  send.ts      │
│  reactions.ts │                  │  format.ts    │
└──────────────┘                  └──────────────┘
```

- **`src/core/`** — Core state management ([`queue.ts`](src/core/queue.ts)), audio playback logic ([`player.ts`](src/core/player.ts)), and voice connection handling ([`voice.ts`](src/core/voice.ts)).
- **`src/commands/`** — Command routing and per-command handlers for music, radio, and utility commands.
- **`src/services/`** — External service integrations: [`yt-dlp`](src/services/youtube.ts) for YouTube, [`Radio Browser API`](src/services/radio.ts) for station discovery, and [`ICY metadata`](src/services/radioMetadata.ts) for live radio song info.
- **`src/ui/`** — Rich embeds and reaction-based interactive controls.
- **`src/utils/`** — Shared utilities for message sending and formatting.

---

## 📋 Prerequisites

| Requirement | Version / Notes |
|-------------|----------------|
| **Node.js** | v16 or higher (v20+ recommended) — for local installation |
| **npm** | Comes with Node.js |
| **FFmpeg** | Included automatically in Docker; install separately for local setup |
| **yt-dlp** | Included automatically in Docker; download separately for local setup |
| **Docker** | Optional — for containerized deployment |

---

## 🚀 Installation

### Option 1: Docker (Recommended)

The Docker setup includes everything you need (Node, FFmpeg, yt-dlp) in a single container.

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/discord-music-selfbot.git
   cd discord-music-selfbot
   ```

2. **Configure environment variables**

   Copy [`.env.example`](.env.example) to `.env` and edit it:

   ```bash
   cp .env.example .env
   ```

   ```env
   DISCORD_TOKEN=your_discord_token_here
   DISCORD_PREFIX=?
   ALLOWED_USERS=user_id1,user_id2,user_id3
   ```

   > **⚠️ Never share your token or commit `.env` to version control!**

3. **Run with Docker Compose**

   ```bash
   docker-compose up -d
   ```

   This builds the image (if needed) and starts the container in detached mode. Persistent data (state, cookies) is stored in the `./data` directory.

   **Or build and run manually:**

   ```bash
   docker build -t discord-music-selfbot .
   docker run -d \
     --name discord-music-selfbot \
     --restart unless-stopped \
     -e DISCORD_TOKEN=your_token \
     -e DISCORD_PREFIX=? \
     -v ./data:/app/data \
     discord-music-selfbot
   ```

### Option 2: Local Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/discord-music-selfbot.git
   cd discord-music-selfbot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Install FFmpeg**

   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH, or the package [`ffmpeg-static`](package.json:17) provides a bundled binary.
   - **macOS**: `brew install ffmpeg`
   - **Linux (Debian/Ubuntu)**: `sudo apt install ffmpeg`
   - **Linux (Alpine)**: `apk add ffmpeg`

4. **Download yt-dlp**

   - **Windows**: Download [`yt-dlp.exe`](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe) and place it in the project root.
   - **macOS / Linux**:
     ```bash
     sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
     sudo chmod a+rx /usr/local/bin/yt-dlp
     ```

5. **Configure** — see [Configuration](#️-configuration) below.

6. **Build and start**

   ```bash
   npm start
   ```

   This compiles TypeScript and runs the compiled output. For development with auto-recompilation:

   ```bash
   npm run dev
   ```

---

## ⚙️ Configuration

### Environment Variables (Recommended)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| [`DISCORD_TOKEN`](src/config.ts:9) | ✅ Yes | — | Your Discord account token |
| [`DISCORD_PREFIX`](src/config.ts:8) | ❌ No | `?` | Command prefix |
| [`ALLOWED_USERS`](src/config.ts:10) | ❌ No | (empty) | Comma-separated Discord user IDs for access restriction. Leave empty to allow all users |
| [`STATE_FILE`](src/config.ts:13) | ❌ No | `./state.json` | Path to persistent state file |
| [`COOKIES_FILE`](src/config.ts:14) | ❌ No | `./cookies.txt` | Path to YouTube cookies file (for age-restricted content) |

Set these in your shell, in a `.env` file (loaded automatically), or in your Docker Compose environment block.

### Config File (Legacy)

You may also use a [`config.json`](config.example.json) file in the project root:

```json
{
  "token": "YOUR_DISCORD_TOKEN_HERE",
  "prefix": "?",
  "allowedUsers": ["user_id_1", "user_id_2"]
}
```

> **Note**: Environment variables take precedence over `config.json`. The config file is only read if `DISCORD_TOKEN` is not set in the environment.

### YouTube Cookies

To access age-restricted or private YouTube content, place a [`cookies.txt`](src/config.ts:14) file (exported from your browser via extensions like [Get cookies.txt](https://chrome.google.com/webstore/detail/get-cookiestxt/bgaddhkoddajcdgocldbbfleckgcbcid)) in the project root. The selfbot automatically detects and uses it when present.

---

## 🎮 Command Reference

All commands use the configured prefix (default: `?`). You must be in a voice channel to use music and radio commands.

### Music Commands

| Command | Usage | Description |
|---------|-------|-------------|
| [`?play`](src/commands/music.ts:67) | `?play <song name>` | Search YouTube and play the best matching result |
| [`?play`](src/commands/music.ts:67) | `?play <URL>` | Play a single YouTube video by URL |
| [`?play`](src/commands/music.ts:67) | `?play <playlist URL> [limit]` | Fetch and play a YouTube playlist (optionally limit to N songs) |
| [`?play`](src/commands/music.ts:67) | `?play <URL1 URL2 URL3...>` | Play multiple YouTube URLs (space-separated, mixed with playlists) |
| [`?skip`](src/commands/music.ts:223) | `?skip` | Skip the currently playing song |
| [`?stop`](src/commands/music.ts:311) | `?stop` | Stop playback, kill all processes, and clear the queue |
| [`?loop`](src/commands/music.ts:236) | `?loop` | Cycle loop mode: **Off ❌** → **Single 🔂** → **All 🔁** → **Off** |
| [`?shuffle`](src/commands/music.ts:247) | `?shuffle` | Randomly shuffle the queue (minimum 2 songs) |
| [`?queue`](src/commands/music.ts:263) | `?queue` | Show the current queue, now playing, and loop mode (sent as a `.txt` file) |
| [`?volume`](src/commands/music.ts:342) | `?volume [0-100]` | Set volume (0–100). Omit the argument to show current volume |

### Radio Commands

| Command | Usage | Description |
|---------|-------|-------------|
| [`?radio`](src/commands/radio.ts:9) | `?radio <station name>` | Search [Radio Browser](https://api.radio-browser.info) and play the best matching station |
| [`?radio`](src/commands/radio.ts:9) | `?radio <stream URL>` | Play a direct radio stream URL |
| [`?radiostats`](src/commands/radio.ts:71) | `?radiostats` | Show radio stream statistics (stream size, last restart, reconnect attempts, metadata detector status) |

### Utility Commands

| Command | Usage | Description |
|---------|-------|-------------|
| [`?help`](src/commands/utility.ts:15) | `?help` | Display the full command list |
| [`?leave`](src/commands/utility.ts:47) | `?leave` | Leave the voice channel, destroy connection, and clear the queue |
| [`?join`](src/commands/utility.ts:210) | `?join [channel ID]` | Join a specific voice channel by ID. If omitted, joins your current channel |
| [`?sync`](src/commands/utility.ts:161) | `?sync` | Re-sync the voice/text channel binding and rejoin the voice channel. Useful if the bot gets out of sync |
| [`?state`](src/commands/utility.ts:269) | `?state` | Show detailed bot state for all guilds: active queues, now playing, volume, recent history |
| [`?panel`](src/commands/utility.ts:354) | `?panel` | Show the interactive reaction-based control panel |
| [`?silent`](src/commands/utility.ts:362) | `?silent` | Toggle silent mode — routes all messages to your DMs instead of the server channel |
| [`?clearchat`](src/commands/utility.ts:75) | `?clearchat [number]` | Delete the last N bot messages from the text channel (default 100, max 100) |
| [`?clearreactions`](src/commands/utility.ts:134) | `?clearreactions` | Remove all reactions from bot messages in the text channel (within the last 14 days) |
| [`?test`](src/commands/utility.ts:10) | `?test` | Basic connectivity test — responds with "Test command working!" |

---

## 🖱️ Usage Examples

### Playing Music

```bash
# Search and play by song name
?play never gonna give you up

# Play a single YouTube URL
?play https://www.youtube.com/watch?v=dQw4w9WgXcQ

# Play a YouTube playlist (with optional limit of 10 songs)
?play https://www.youtube.com/playlist?list=PLxyz 10

# Play multiple URLs at once
?play https://youtu.be/abc123 https://youtu.be/def456 https://youtu.be/ghi789

# Control playback
?volume 75    # Set volume to 75%
?loop         # Toggle loop mode
?shuffle      # Shuffle the queue
?queue        # View the queue
?skip         # Skip the current track
?stop         # Stop and clear everything
```

### Radio Streaming

```bash
# Search for a radio station by name
?radio Jazz

# Search with a more specific query
?radio Classic Rock
?radio BBC Radio 1

# Play a direct stream URL
?radio https://stream.example.com/radio.mp3

# Check radio status
?radiostats
```

### Utility

```bash
# Interactive control panel
?panel

# Switch to silent mode (DMs only)
?silent

# Check full bot state
?state

# Clean up the channel
?clearchat 50
?clearreactions

# Sync if the bot gets disconnected
?sync
```

---

## 🎛️ Interactive Control Panel

The [`?panel`](src/ui/reactions.ts:152) command displays an interactive control panel with reaction buttons, providing a visual remote control for the selfbot.

| Reaction | Action |
|----------|--------|
| ⏮ | Previous song (pop last, move to front) |
| ⏯️ | Play / Pause toggle |
| ⏭ | Skip current song |
| 🔉 | Volume down (−20%) |
| 🔊 | Volume up (+20%) |
| ⏹ | Stop & clear queue |
| 📻 | Switch to radio mode (if a station was previously set) |
| 🎵 | Switch to music mode (resume queue playback) |
| 🗑️ | Delete recent messages (up to 10) |
| ℹ️ | Show queue info & history |

Additionally, whenever a song starts playing, a set of reaction controls is automatically added to the "Now Playing" message:

| Reaction | Action |
|----------|--------|
| ⏯ | Play / Pause toggle |
| ⏭ | Skip current song |
| 🔉 | Volume down (−10%) |
| 🔊 | Volume up (+10%) |
| ⏹ | Stop & clear queue |

---

## 🔄 Auto-Reconnection & Resilience

The selfbot is designed to handle interruptions gracefully with multiple layers of resilience:

### Music Stream Reconnection ([`player.ts`](src/core/player.ts:60))

- Monitors yt-dlp and FFmpeg processes for errors (broken pipe, connection reset, timeout, etc.)
- Implements **exponential backoff** — waits double the previous delay before each retry (starting at 1.5s for broken pipe, 3s for other errors, max 10s)
- **Broken pipe mode**: Up to 5 retries; **general errors**: Up to 3 retries
- After exhausting retries, automatically advances to the next song in the queue

### Radio Stream Reconnection ([`player.ts`](src/core/player.ts:314))

- Detects broken pipe, server errors, connection failures
- Performs up to 5 reconnection attempts (7 for broken pipe) with strategic delays
- Automatically restarts FFmpeg with the same stream URL
- Resumes metadata detection 2 seconds after reconnection

### Voice State Recovery ([`voice.ts`](src/core/voice.ts:91))

- Detects when the selfbot is **kicked from a voice channel**
- Saves the current playback position before disconnection
- Automatically rejoins the channel after 5 seconds and resumes playback exactly where it left off
- Handles temporary voice channels (auto-resets state if channel is deleted)

### Discord Client Resilience ([`index.ts`](src/index.ts:122))

- Monitors client disconnect events and automatically attempts to reconnect
- On resume, restores all active queues, rejoins voice channels, and continues playback
- Handles unhandled promise rejections and uncaught exceptions gracefully

### State Persistence ([`queue.ts`](src/core/queue.ts:7))

- Saves full state to [`state.json`](src/core/queue.ts:39) on every significant action (play, skip, stop, volume change, etc.)
- Periodically saves play progress every 15 seconds during active playback
- On restart, automatically restores all guild states and resumes playback

---

## 🔇 Silent Mode

Enable **silent mode** with [`?silent`](src/commands/utility.ts:362) to route all bot messages to your **Direct Messages** instead of the server text channel. This is useful for keeping channels clean while still receiving playback notifications.

- Toggle on/off with `?silent`
- State is persisted across restarts
- Works for music, radio, and utility command responses

---

## 📁 Project Structure

```
discord-music-selfbot/
├── src/
│   ├── index.ts              # Entry point: client setup, event handlers, graceful shutdown
│   ├── config.ts             # Configuration loader (env vars + config.json)
│   ├── commands/
│   │   ├── index.ts          # Command router — parses messages, dispatches handlers
│   │   ├── music.ts          # Play, skip, loop, shuffle, queue, stop, volume
│   │   ├── radio.ts          # Radio station search, stream start, radio stats
│   │   └── utility.ts        # Help, leave, join, sync, state, panel, silent, clearchat, clearreactions
│   ├── core/
│   │   ├── queue.ts          # Queue state management, save/load persistent state
│   │   ├── player.ts         # Audio playback (YouTube + radio), stream reconnection logic
│   │   └── voice.ts          # Voice connection management, voice state monitoring, resume
│   ├── services/
│   │   ├── youtube.ts        # YouTube search via yt-dlp
│   │   ├── radio.ts          # Radio Browser API, codec detection, FFmpeg radio streaming
│   │   └── radioMetadata.ts  # ICY metadata polling for live radio song info
│   ├── ui/
│   │   ├── embeds.ts         # Rich embed builders (now playing, progress bar)
│   │   └── reactions.ts      # Reaction-based UI (controls + command panel)
│   ├── utils/
│   │   ├── send.ts           # Message sending with silent mode support
│   │   └── format.ts         # Duration formatting, URL validation, YouTube ID extraction
│   └── types/
│       └── index.ts          # TypeScript interfaces and type definitions
├── .env.example              # Example environment variables
├── config.example.json       # Example config file (legacy)
├── docker-compose.yml        # Docker Compose configuration
├── Dockerfile                # Multi-stage Docker build
├── package.json              # Project metadata and dependencies
└── tsconfig.json             # TypeScript compiler configuration
```

---

## 🚢 Deployment

### Docker / Docker Compose

The included [`Dockerfile`](Dockerfile) uses a **multi-stage build** for a small final image:

1. **Builder stage**: Installs dependencies, downloads yt-dlp, compiles TypeScript.
2. **Runtime stage**: Copies only production dependencies and compiled output. Includes FFmpeg and yt-dlp.

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Persistent data (state, cookies) is stored in a mounted [`./data`](docker-compose.yml:18) volume.

### Coolify

1. Connect your Git repository in Coolify
2. Select **"Dockerfile"** as the build type
3. Set environment variables in the Coolify dashboard:
   - `DISCORD_TOKEN` — your Discord token
   - `DISCORD_PREFIX` — your preferred prefix (default: `?`)
   - `ALLOWED_USERS` — (optional) access restriction
4. Deploy

### Other Platforms

Most PaaS platforms (Railway, Render, Fly.io, etc.) support Docker-based deployments. Use the provided [`Dockerfile`](Dockerfile) and set environment variables in their dashboard.

---

## 🔧 Troubleshooting

| Issue | Possible Cause & Solution |
|-------|--------------------------|
| **Bot won't connect to voice** | Ensure you are in a voice channel before issuing commands. The selfbot joins your current channel automatically. |
| **Audio not playing** | Check that FFmpeg and yt-dlp are properly installed and accessible in PATH. The Docker image includes both automatically. Run `?state` to verify the queue has songs. |
| **"Join VC dulu" message** | You are not in a voice channel. Join one and try again. |
| **YouTube videos not found** | The video may be blocked, private, or age-restricted. Try using a [`cookies.txt`](#youtube-cookies) file exported from a logged-in browser session. |
| **Playlist not loading** | Ensure the playlist is public and accessible. Very large playlists may take time to process. |
| **Radio not working** | The station may be offline or have changed URLs. Try searching for a different station with `?radio <name>`. Check `?radiostats` for stream diagnostics. |
| **Radio metadata not showing** | Not all radio stations broadcast ICY metadata. The stream will still play, but song titles may not appear. |
| **Bot not responding** | If [`ALLOWED_USERS`](#environment-variables-recommended) is configured, ensure your Discord user ID is in the list. |
| **"Missing Access" error** | The bot lacks permissions to view the channel or send messages. Check channel permissions. |
| **Reactions not working** | Ensure the selfbot has "Add Reactions" permission in the channel. Reactions on messages older than 14 days cannot be managed. |
| **State not saving** | Verify the bot has write permissions to the project directory. In Docker, the `state.json` is stored in the `./data` volume mount. |
| **Docker build fails** | Ensure Docker is running, you have sufficient disk space, and a stable internet connection (for downloading yt-dlp and dependencies). |
| **Environment variables not applied** | Verify the `.env` file exists in the project root and matches the format in [`.env.example`](.env.example). Restart the container after changes. |
| **Reconnection loop** | If the bot repeatedly tries to reconnect, use `?stop` or `?leave` to reset the state, then try again. |

---

## ❓ FAQ

**Q: Can I use this with a bot account instead of a user account?**

A: No. This project uses [`discord.js-selfbot-v13`](package.json:18), which is specifically designed for user accounts. For bot accounts, use the official [`discord.js`](https://github.com/discordjs/discord.js) library.

**Q: Can I use multiple prefixes?**

A: Only a single prefix is supported. Set it via `DISCORD_PREFIX` or in [`config.json`](config.example.json).

**Q: Can the selfbot be in multiple servers at once?**

A: Yes. The selfbot maintains independent queues per guild and supports simultaneous playback in multiple servers.

**Q: How do I stop the bot gracefully?**

A: Send `SIGINT` (Ctrl+C) or `SIGTERM` to the process. The bot kills child processes (yt-dlp, FFmpeg) and saves state before exiting.

**Q: Does the bot support Spotify or other platforms?**

A: Currently only YouTube and internet radio (via Radio Browser) are supported. YouTube URLs and search terms are resolved through yt-dlp.

**Q: Can I run commands via DM?**

A: Yes. If the selfbot is already in a voice channel in any server, you can send commands via DM and it will respond in that server's text channel (or via DM in silent mode).

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** — please follow the existing code style and TypeScript conventions
4. **Test** your changes thoroughly
5. **Commit** with a clear message: `git commit -m 'Add amazing feature'`
6. **Push** to your branch: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Development Guidelines

- Use TypeScript — the project is fully typed with strict mode enabled
- Run `npm run dev` during development for TypeScript auto-compilation
- Follow the existing module structure (commands, core, services, ui, utils)
- Handle errors gracefully and log appropriately
- Update the README if you add or change commands/features

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).

```
ISC License

Copyright (c) 2026

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

<p align="center">
  <sub>Built with ❤️ for educational purposes. Not affiliated with Discord or YouTube.</sub>
</p>
