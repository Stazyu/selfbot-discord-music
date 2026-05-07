const { Client } = require("discord.js-selfbot-v13")
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice")
const { spawn } = require("child_process")
const ffmpegStatic = require("ffmpeg-static")
const https = require("https")
const fs = require("fs")
const path = require("path")
const dotenv = require("dotenv")
const { createReactionUI, createCommandPanel, setPlaySongFunction, removeAllReactionsFromChannel } = require("./reactionUI")
const { startRadioMetadataDetection } = require("./radioMetadata")
const { searchSong } = require("./yt")
dotenv.config()

// Use system ffmpeg on Linux, ffmpeg-static on Windows
const ffmpeg = process.platform === "win32" ? ffmpegStatic : "ffmpeg"

// Read config from environment variables or config.json
const config = {
    prefix: process.env.DISCORD_PREFIX || "?",
    token: process.env.DISCORD_TOKEN,
    allowedUsers: process.env.ALLOWED_USERS ? process.env.ALLOWED_USERS.split(",") : []
}

// Fallback to config.json if env vars not set
if (!config.token) {
    try {
        const fileConfig = require("./config.json")
        config.prefix = fileConfig.prefix || config.prefix
        config.token = fileConfig.token
        config.allowedUsers = fileConfig.allowedUsers || config.allowedUsers
    } catch (err) {
        console.error("Error: DISCORD_TOKEN environment variable or config.json required")
        process.exit(1)
    }
}

const ytdlpExecutable = process.platform === "win32" ? "./yt-dlp.exe" : "yt-dlp"

function formatDuration(seconds) {
    if (!seconds) return null
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

async function getPlaylistVideos(url) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn(ytdlpExecutable, [
            "--dump-single-json",
            url
        ])

        let output = ""
        let errorOutput = ""
        ytdlp.stdout.on("data", (data) => {
            output += data.toString()
        })
        ytdlp.stderr.on("data", (data) => {
            errorOutput += data.toString()
        })

        ytdlp.on("close", (code) => {
            if (code !== 0) {
                console.error("yt-dlp stderr:", errorOutput)
                reject(new Error("yt-dlp failed: " + errorOutput))
                return
            }

            try {
                const data = JSON.parse(output)
                const videos = data.entries
                    .filter(video => video && video.title && video.id)
                    .map(video => ({
                        title: video.title,
                        url: `https://www.youtube.com/watch?v=${video.id}`,
                        duration: video.duration,
                        durationFormatted: formatDuration(video.duration)
                    }))

                resolve(videos)
            } catch (err) {
                console.error("Error parsing JSON:", err)
                reject(new Error("Failed to parse yt-dlp JSON output"))
            }
        })

        ytdlp.on("error", reject)
    })
}

const client = new Client()

const PREFIX = config.prefix
const TOKEN = config.token

const queues = new Map()
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "state.json")

function saveState() {
    const state = {}
    for (const [guildId, queue] of queues) {
        state[guildId] = {
            voiceChannelId: queue.voiceChannelId,
            volume: queue.volume ?? 1.0,
            songs: queue.songs,
            radioUrl: queue.radioUrl,
            radioName: queue.radioName,
            radioStopped: queue.radioStopped,
            textChannelId: queue.textChannel?.id,
            playHistory: queue.playHistory || [],
            loopMode: queue.loopMode || 0,
            playing: queue.playing || false,
            musicReconnectAttempts: queue.musicReconnectAttempts || 0,
            isMusicReconnecting: queue.isMusicReconnecting || false
        }
    }
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
        console.log(" State saved to", STATE_FILE)
    } catch (err) {
        console.error("Error saving state:", err)
    }
}

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            console.log(" No state file found, starting fresh")
            return
        }
        const data = fs.readFileSync(STATE_FILE, "utf8")
        const state = JSON.parse(data)
        console.log(" State loaded from", STATE_FILE)
        return state
    } catch (err) {
        console.error("Error loading state:", err)
        return null
    }
}

client.on("ready", async () => {
    console.log("✅ Logged in as", client.user.tag)

    // Set playSong function for reactionUI
    setPlaySongFunction(playSong)
    const state = loadState()
    if (state) {
        for (const [guildId, guildState] of Object.entries(state)) {
            const guild = client.guilds.cache.get(guildId)
            if (!guild) continue

            const voiceChannel = guild.channels.cache.get(guildState.voiceChannelId)
            if (!voiceChannel) continue

            const textChannel = client.channels.cache.get(guildState.textChannelId)

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator
                })

                const player = createAudioPlayer()
                connection.subscribe(player)

                const queue = {
                    voiceChannelId: guildState.voiceChannelId,
                    songs: guildState.songs || [],
                    radioUrl: guildState.radioUrl,
                    radioName: guildState.radioName,
                    radioStopped: guildState.radioStopped,
                    textChannel: textChannel,
                    player: player,
                    connection: connection,
                    volume: guildState.volume ?? 1.0,
                    playHistory: guildState.playHistory || [],
                    loopMode: guildState.loopMode || 0,
                    isSkipping: false,
                    playing: guildState.playing || false,
                    musicReconnectAttempts: guildState.musicReconnectAttempts || 0,
                    musicReconnectMessage: null,
                    isMusicReconnecting: guildState.isMusicReconnecting || false
                }
                queues.set(guildId, queue)

                console.log(`🔄 Resuming playback for guild ${guildId}`)

                if (guildState.radioUrl && guildState.radioName && !guildState.radioStopped) {
                    console.log(`🔄 Resuming radio on startup: ${guildState.radioName}`)
                    queue.textChannel?.send("🔄 Reconnecting to radio after startup...")
                    setTimeout(() => playRadio(guild, guildState.radioUrl, guildState.radioName), 3000)
                } else if (guildState.songs && guildState.songs.length > 0) {
                    console.log(`🔄 Resuming music queue on startup`)
                    queue.textChannel?.send("🔄 Resuming music after startup...")
                    setTimeout(() => playSong(guild, guildState.songs[0]), 3000)
                }
            } catch (err) {
                console.error(`Error resuming playback for guild ${guildId}:`, err)
            }
        }
    }
})

client.on("disconnect", () => {
    console.log("⚠️ Discord client disconnected, attempting to reconnect...")
    setTimeout(() => {
        if (client.ws.status === 0) {
            client.login(TOKEN)
        }
    }, 5000)
})

client.on("reconnecting", () => {
    console.log("🔄 Reconnecting to Discord...")
})

client.on("resume", (replayed) => {
    console.log("✅ Resumed connection, replayed", replayed, "events")
    resumeAllMusic()
})

client.on("error", (err) => {
    console.error("Discord client error:", err)
})

process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err)
})

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err)
})

// Graceful shutdown handler
process.on("SIGTERM", () => {
    console.log("Received SIGTERM, shutting down gracefully...")
    for (const [guildId, queue] of queues) {
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue.metadataDetector) {
            queue.metadataDetector.stop()
        }
    }
    process.exit(0)
})

process.on("SIGINT", () => {
    console.log("Received SIGINT, shutting down gracefully...")
    for (const [guildId, queue] of queues) {
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue.metadataDetector) {
            queue.metadataDetector.stop()
        }
    }
    process.exit(0)
})

async function resumeAllMusic() {
    console.log("🔄 Resuming all music/radio after reconnection...")
    for (const [guildId, queue] of queues) {
        if (!queue.voiceChannelId) continue

        const guild = client.guilds.cache.get(guildId)
        if (!guild) continue

        try {
            const voiceChannel = guild.channels.cache.get(queue.voiceChannelId)
            if (!voiceChannel) continue

            console.log(`🔄 Rejoining voice channel for guild ${guildId}`)

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator
            })

            connection.subscribe(queue.player)
            queue.connection = connection

            // Reset reconnection flags and attempts
            queue.isReconnecting = false
            queue.radioReconnectAttempts = 0
            queue.reconnectMessage = null
            queue.isMusicReconnecting = false
            queue.musicReconnectAttempts = 0
            queue.musicReconnectMessage = null

            if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                console.log(`🔄 Resuming radio: ${queue.radioName}`)
                queue.textChannel?.send("🔄 Reconnecting to radio after deployment...")
                setTimeout(() => playRadio(guild, queue.radioUrl, queue.radioName), 3000)
            } else if (queue.songs.length > 0) {
                console.log(`🔄 Resuming music queue`)
                queue.textChannel?.send("🔄 Resuming music after deployment...")
                setTimeout(() => playSong(guild, queue.songs[0]), 2000)
            }
        } catch (err) {
            console.error(`Error resuming music for guild ${guildId}:`, err)
            queue.textChannel?.send("❌ Gagal reconnect setelah deployment. Silakan coba manual.")
        }
    }
}

client.on("voiceStateUpdate", (oldState, newState) => {
    if (!oldState.member) return

    // Handle bot yang keluar dari voice channel
    if (oldState.member.id === client.user.id && oldState.channel && !newState.channel) {
        console.log("⚠️ Bot was kicked from voice channel")
        const queue = queues.get(oldState.guild.id)
        if (queue) {
            // Calculate playback time for resume functionality
            if (queue.currentSong && !queue.currentSong.isRadio) {
                const startedAt = new Date(queue.currentSong.startedAt)
                const currentTime = new Date()
                const elapsedSeconds = Math.floor((currentTime - startedAt) / 1000)

                // Add resume time to the current song
                if (queue.songs.length > 0) {
                    queue.songs[0].resumeFrom = elapsedSeconds
                    console.log(`💾 Saved resume time: ${elapsedSeconds} seconds for "${queue.currentSong.title}"`)
                }
            }

            queue.voiceChannelId = oldState.channel.id
            queue.textChannel?.send("⚠️ Bot terkick dari VC, mencoba rejoin dalam 5 detik...")
            setTimeout(() => {
                const guild = client.guilds.cache.get(oldState.guild.id)
                if (guild) {
                    const voiceChannel = guild.channels.cache.get(oldState.channel.id)
                    if (voiceChannel) {
                        try {
                            const connection = joinVoiceChannel({
                                channelId: voiceChannel.id,
                                guildId: guild.id,
                                adapterCreator: guild.voiceAdapterCreator
                            })
                            connection.subscribe(queue.player)
                            queue.connection = connection
                            queue.textChannel?.send("✅ Berhasil rejoin ke VC")
                            queue.radioReconnectAttempts = 0 // Reset radioReconnectAttempts
                            queue.musicReconnectAttempts = 0 // Reset musicReconnectAttempts
                            queue.isMusicReconnecting = false
                            queue.musicReconnectMessage = null

                            if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                                playRadio(guild, queue.radioUrl, queue.radioName)
                            } else if (queue.songs.length > 0) {
                                playSong(guild, queue.songs[0])
                            }
                        } catch (err) {
                            console.error("Error rejoining voice channel:", err)
                            queue.textChannel?.send("❌ Gagal rejoin ke VC")
                        }
                    } else {
                        // Voice channel tidak ada (temporary channel deleted)
                        console.log("🔄 Voice channel tidak ditemukan, kemungkinan temporary channel dihapus")
                        queue.textChannel?.send("🔄 Voice channel tidak ditemukan. State direset. Join ke voice baru untuk melanjutkan.")

                        // Reset state untuk channel ID lama tapi pertahankan data lainnya
                        queue.voiceChannelId = null
                        queue.connection = null

                        // Stop semua proses yang sedang berjalan
                        if (queue.currentProcesses) {
                            queue.currentProcesses.ytdlp.kill()
                            queue.currentProcesses.ff.kill()
                        }
                        if (queue.radioFfmpeg) {
                            queue.radioFfmpeg.kill()
                        }
                        if (queue.metadataDetector) {
                            queue.metadataDetector.stop()
                            queue.metadataDetector = null
                        }

                        // Reset player
                        queue.player.stop()

                        // Save state yang sudah direset
                        saveState()
                    }
                }
            }, 5000)
        }
    }

    // Handle user yang join ke voice channel (untuk siap resume setelah temporary channel dihapus)
    if (oldState.member.id !== client.user.id && !oldState.channel && newState.channel) {
        const queue = queues.get(newState.guild.id)
        if (queue && !queue.voiceChannelId && queue.connection === null) {
            // User join ke voice baru dan bot sedang menunggu untuk resume
            console.log("🔄 User join ke voice channel baru, bot siap untuk resume")

            // Update state dengan channel baru tapi belum join
            queue.voiceChannelId = newState.channel.id
            queue.textChannel = newState.channel // Update text channel ke channel yang sama dengan voice

            // Beritahu user bahwa bot siap dan menunggu command
            queue.textChannel?.send("🔄 Bot siap untuk melanjutkan. Gunakan command ?play atau ?radio untuk memulai kembali.")

            saveState()
        }
    }
})

function stream(url, seekTime = null) {
    const ytdlpArgs = [
        "-f", "bestaudio",
        "-o", "-"
    ]

    // Add seek parameter if provided
    if (seekTime) {
        ytdlpArgs.push("-ss", seekTime.toString())
    }

    ytdlpArgs.push(url)

    const ytdlp = spawn(ytdlpExecutable, ytdlpArgs)

    const ff = spawn(ffmpeg, [
        "-i", "pipe:0",
        "-f", "opus",
        "-ar", "48000",
        "-ac", "2",
        "pipe:1"
    ])

    ytdlp.stdout.pipe(ff.stdin)

    ytdlp.stderr.on("data", (data) => {
        console.error("yt-dlp stderr:", data.toString())
    })

    ytdlp.on("error", (err) => {
        console.error("yt-dlp error:", err)
    })

    ff.on("error", (err) => {
        console.error("ffmpeg error:", err)
    })

    ytdlp.on("close", (code) => {
        if (code !== 0 && code !== null) {
            console.error("yt-dlp exited with code:", code)
        }
    })

    ff.on("close", (code) => {
        if (code !== 0 && code !== null) {
            console.error("ffmpeg exited with code:", code)
        }
    })

    const stream = ff.stdout
    stream.processes = { ytdlp, ff }
    return stream
}

// Radio helper functions
function isUrl(str) {
    try { new URL(str); return true; } catch { return false; }
}

function extractYouTubeVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
    const match = url.match(regex)
    return match ? match[1] : null
}

async function resolveRadioMetadata(query) {
    if (isUrl(query)) return { url: query, name: "Direct URL" };

    const enc = encodeURIComponent(query || "music");
    const rbUrl = `https://de1.api.radio-browser.info/json/stations/byname/${enc}`;

    return new Promise((resolve, reject) => {
        https.get(rbUrl, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const list = JSON.parse(data);
                    if (!Array.isArray(list) || list.length === 0) {
                        reject(new Error(`No results for "${query}"`));
                        return;
                    }
                    const first = list.find(x => x.url) || list[0];
                    resolve({
                        url: first.url,
                        name: first.name || query,
                        country: first.country || null,
                        codec: first.codec || null
                    });
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

async function detectStreamCodec(inputUrl) {
    return new Promise((resolve) => {
        const ff = spawn(ffmpeg, [
            '-analyzeduration', '5000000',
            '-probesize', '10000000',
            '-i', inputUrl,
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        ff.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ff.on('close', () => {
            const audioMatch = stderr.match(/Stream #\d+:\d+.*Audio:\s*(\w+)/i);
            const codec = audioMatch ? audioMatch[1].toLowerCase() : null;
            console.log(`[radio] Detected codec: ${codec || 'unknown'}`);
            resolve(codec);
        });

        ff.on('error', () => resolve(null));

        setTimeout(() => {
            ff.kill();
            resolve(null);
        }, 5000);
    });
}

function spawnRadioFfmpeg(inputUrl, codec = null, onClose = null) {
    const args = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-analyzeduration', '10000000',
        '-probesize', '50000000',
        '-i', inputUrl,
        '-vn'
    ];

    if (codec === 'opus') {
        args.push('-c:a', 'copy');
    } else {
        args.push('-f', 'opus', '-ar', '48000', '-ac', '2', '-b:a', '128k');
    }

    args.push('pipe:1');

    const ff = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    ff.on('spawn', () => console.log('[radio] ffmpeg spawned for', inputUrl));

    ff.stderr.on('data', (data) => {
        const stderrOutput = data.toString();
        // Skip the muxing overhead error message that appears when adding to recently played
        if (!stderrOutput.includes('0kB other streams:0kB global headers:0kB muxing overhead: unknown')) {
            console.error('[radio] ffmpeg stderr:', stderrOutput);
        }
    });

    ff.on('close', (code, signal) => {
        console.log('[radio] ffmpeg closed with code', code, 'signal:', signal);
        if (onClose) onClose(code, signal);
        // Don't treat signal 15 (SIGTERM) as an error - it's often normal termination
        if (code !== 0 && code !== null && code !== 1 && signal !== 'SIGTERM' && signal !== 15) {
            console.error('[radio] ffmpeg exited with error code:', code);
        }
    });

    ff.on('error', (err) => {
        console.error('[radio] ffmpeg process error:', err);
    });

    return ff;
}


async function playSong(guild, song) {

    const queue = queues.get(guild.id)

    if (!song) {
        // Reset playing state when no more songs
        queue.playing = false

        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue.reactionCollector && typeof queue.reactionCollector.stop === "function") {
            queue.reactionCollector.stop()
            queue.reactionCollector = null
        }
        if (queue.reactionMessage) {
            const { removeReactionUI } = require("./reactionUI")
            await removeReactionUI(queue.reactionMessage, null)
            queue.reactionMessage = null
        }
        if (queue.radioUrl && queue.radioName) {
            queue.radioStopped = false
            queue.textChannel?.send("✅ Musik selesai, kembali ke radio...")
            playRadio(guild, queue.radioUrl, queue.radioName)
            return
        }
        queue.textChannel?.send("✅ Selesai memutar semua lagu")
        return
    }

    console.log("🎵 Playing:", song)

    // Set playing state
    queue.playing = true

    // Track playback start time for resume functionality
    queue.currentSong = {
        title: song.title,
        url: song.url,
        startedAt: new Date().toISOString(),
        isRadio: false
    }

    // Add to play history
    if (!queue.playHistory) {
        queue.playHistory = []
    }
    queue.playHistory.unshift({
        title: song.title,
        url: song.url,
        playedAt: new Date().toISOString(),
        isRadio: false
    })
    // Keep only last 10 songs in history
    if (queue.playHistory.length > 10) {
        queue.playHistory = queue.playHistory.slice(0, 10)
    }

    if (queue.currentProcesses) {
        queue.currentProcesses.ytdlp.kill()
        queue.currentProcesses.ff.kill()
    }

    // Calculate seek time if resuming
    let seekTime = null
    if (song.resumeFrom) {
        seekTime = song.resumeFrom
        console.log(`🔄 Resuming from ${seekTime} seconds`)
        delete song.resumeFrom // Clean up the resume flag
    }

    const audio = stream(song.url, seekTime)

    const resource = createAudioResource(audio, { inlineVolume: true })
    resource.volume.setVolume(queue.volume ?? 1.0)

    queue.currentProcesses = audio.processes

    // Initialize music reconnection tracking
    if (!queue.musicReconnectAttempts) {
        queue.musicReconnectAttempts = 0
    }
    if (!queue.musicReconnectMessage) {
        queue.musicReconnectMessage = null
    }
    if (!queue.isMusicReconnecting) {
        queue.isMusicReconnecting = false
    }

    const MAX_MUSIC_RECONNECT_ATTEMPTS = 3

    // Add error handling for ffmpeg processes
    audio.processes.ytdlp.on("error", (err) => {
        console.error("yt-dlp error:", err)
        if (!queue.isMusicReconnecting && !queue.radioStopped) {
            handleMusicStreamingError(guild, song, "yt-dlp")
        }
    })

    audio.processes.ff.on("error", (err) => {
        console.error("ffmpeg error:", err)
        if (!queue.isMusicReconnecting && !queue.radioStopped) {
            handleMusicStreamingError(guild, song, "ffmpeg")
        }
    })

    audio.processes.ytdlp.on("close", (code) => {
        if (code !== 0 && code !== null && !queue.isMusicReconnecting && !queue.radioStopped) {
            console.error("yt-dlp exited with code:", code)
            handleMusicStreamingError(guild, song, "yt-dlp")
        }
    })

    audio.processes.ff.on("close", (code) => {
        if (code !== 0 && code !== null && !queue.isMusicReconnecting && !queue.radioStopped) {
            console.error("ffmpeg exited with code:", code)
            handleMusicStreamingError(guild, song, "ffmpeg")
        }
    })

    queue.player.play(resource)

    // Remove existing listeners to prevent accumulation
    queue.player.removeAllListeners("error")
    queue.connection.removeAllListeners("error")

    queue.player.on("error", (err) => {
        console.error("Audio player error:", err)
        if (!queue.isMusicReconnecting && !queue.radioStopped) {
            handleMusicStreamingError(guild, song, "player")
        }
    })

    queue.connection.on("error", (err) => {
        console.error("Voice connection error:", err)
        queue.textChannel.send("❌ Error connecting to voice channel, stopping music...")
        queue.songs = []
        queue.player.stop()
        queues.delete(guild.id)
        saveState()
    })

    const nowPlayingMsg = await queue.textChannel.send(`🎵 Now playing **${song.title}** 🎵`)
    queue.reactionCollector = createReactionUI(nowPlayingMsg, queue)
    saveState()

    queue.player.once(AudioPlayerStatus.Idle, () => {
        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }

        // Reset playing state temporarily before next song
        queue.playing = false

        // Reset music reconnection tracking on successful playback
        queue.musicReconnectAttempts = 0
        queue.isMusicReconnecting = false
        queue.musicReconnectMessage = null

        if (queue.isSkipping || (queue.loopMode || 0) === 0) {
            queue.songs.shift()
            queue.isSkipping = false
        } else if (queue.loopMode === 2) {
            const shiftedSong = queue.songs.shift()
            queue.songs.push(shiftedSong)
        }
        // loopMode === 1: keep current song at index 0

        playSong(guild, queue.songs[0])
    })

}

function handleMusicStreamingError(guild, song, source) {
    const queue = queues.get(guild.id)
    if (!queue) return

    console.log(`[music] ${source} failed, attempting reconnect...`)
    queue.isMusicReconnecting = true
    queue.musicReconnectAttempts++

    const MAX_MUSIC_RECONNECT_ATTEMPTS = 3

    if (queue.musicReconnectAttempts >= MAX_MUSIC_RECONNECT_ATTEMPTS) {
        queue.textChannel.send(`❌ Musik gagal diputar setelah ${MAX_MUSIC_RECONNECT_ATTEMPTS} percobaan reconnect. Melanjutkan ke lagu berikutnya...`)
        queue.musicReconnectAttempts = 0
        queue.isMusicReconnecting = false
        queue.musicReconnectMessage = null
        queue.songs.shift()
        playSong(guild, queue.songs[0])
        return
    }

    const delay = Math.min(3000 * Math.pow(2, queue.musicReconnectAttempts - 1), 10000)
    const reconnectText = `❌ Musik terputus (${source}), mencoba reconnect (${queue.musicReconnectAttempts}/${MAX_MUSIC_RECONNECT_ATTEMPTS}) dalam ${delay / 1000} detik...`

    if (queue.musicReconnectMessage) {
        queue.musicReconnectMessage.edit(reconnectText).catch(console.error)
    } else {
        queue.textChannel.send(reconnectText).then(msg => {
            queue.musicReconnectMessage = msg
        }).catch(console.error)
    }

    setTimeout(() => {
        const currentQueue = queues.get(guild.id)
        if (currentQueue && !currentQueue.radioStopped && currentQueue.connection.state.status === "ready") {
            console.log(`[music] Attempting to reconnect to: ${song.title}`)
            queue.isMusicReconnecting = false
            playSong(guild, song)
        } else {
            queue.isMusicReconnecting = false
        }
    }, delay)
}

async function playRadio(guild, radioUrl, radioName) {
    const queue = queues.get(guild.id)

    if (!queue) {
        console.error("Queue not found for radio")
        return
    }

    radioUrl = await fetch(radioUrl).then(res => res.url)

    console.log("📻 Playing radio:", radioName)

    if (queue.radioFfmpeg) {
        queue.radioFfmpeg.kill()
    }

    queue.radioStopped = false
    queue.radioUrl = radioUrl
    queue.radioName = radioName
    // Only reset reconnect attempts if this is not a reconnection attempt
    if (!queue.isReconnecting) {
        queue.radioReconnectAttempts = 0
        queue.reconnectMessage = null
    }
    const MAX_RECONNECT_ATTEMPTS = 5

    // Stop existing metadata detection if any
    if (queue.metadataDetector) {
        queue.metadataDetector.stop()
        queue.metadataDetector = null
    }

    const codec = await detectStreamCodec(radioUrl)
    const ff = spawnRadioFfmpeg(radioUrl, codec, (code, signal) => {
        // Check if this is an actual error that requires reconnection
        const isError = (code !== 0 && code !== null && code !== 1 && signal !== 'SIGTERM' && signal !== 15)

        if (isError && !queue.radioStopped && !queue.isReconnecting) {
            console.log('[radio] ffmpeg closed unexpectedly, stopping metadata and triggering reconnect...');

            // Stop metadata detector when radio crashes
            if (queue.metadataDetector) {
                queue.metadataDetector.stop()
                queue.metadataDetector = null
                console.log('[radio] Metadata detector stopped due to radio crash');
            }

            queue.isReconnecting = true
            queue.radioReconnectAttempts++

            if (queue.radioReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                queue.textChannel.send(`❌ Radio stream terputus setelah ${MAX_RECONNECT_ATTEMPTS} percobaan reconnect. Mohon coba lagi nanti.`)
                queue.radioStopped = true
                queue.isReconnecting = false
                return
            }

            queue.textChannel.send(`🔄 Radio stream terputus, mencoba reconnect (${queue.radioReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`)

            setTimeout(() => {
                const currentQueue = queues.get(guild.id)
                if (currentQueue && !currentQueue.radioStopped && currentQueue.connection.state.status === "ready") {
                    // Metadata detector will be restarted automatically when playRadio is called
                    playRadio(guild, radioUrl, radioName)
                } else {
                    queue.isReconnecting = false
                }
            }, 3000)
        } else if (signal === 'SIGTERM' || signal === 15) {
            console.log('[radio] ffmpeg terminated normally (SIGTERM), no reconnect needed');
        }
    })
    queue.radioFfmpeg = ff

    const resource = createAudioResource(ff.stdout, { inlineVolume: true })
    resource.volume.setVolume(queue.volume ?? 1.0)

    queue.player.play(resource)

    queue.player.on("error", async (err) => {
        console.error("Radio player error:", err)
    })

    queue.connection.on("error", (err) => {
        console.error("Voice connection error:", err)
        queue.textChannel.send("❌ Error connecting to voice channel, stopping radio...")
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        queue.radioStopped = true
        queue.playing = false
        queue.isReconnecting = false
        queue.radioReconnectAttempts = 0
        queues.delete(guild.id)
        saveState()
    })

    if (queue.radioMessage && queue.isReconnecting) {
        // Edit existing radio message if reconnecting
        queue.radioMessage.edit(`📻 Now playing radio: **${radioName}**`).catch(console.error)
    } else {
        // Send new radio message if first time or no existing message
        const radioMsg = await queue.textChannel.send(`📻 Now playing radio: **${radioName}**`)
        queue.radioMessage = radioMsg
        queue.reactionCollector = createReactionUI(radioMsg, queue)
    }

    if (queue.reconnectMessage) {
        queue.reconnectMessage.edit("✅ Berhasil reconnect radio").catch(console.error)
        queue.reconnectMessage = null
    }

    // Reset reconnecting flag after successful reconnect
    queue.isReconnecting = false

    // Set playing state for radio
    queue.playing = true

    // Start metadata detection for current song (with small delay to ensure message is set)
    setTimeout(() => {
        queue.metadataDetector = startRadioMetadataDetection(radioUrl, queue)
    }, 2000)

    saveState()
}

client.on("messageCreate", async msg => {

    if (!msg.content.startsWith(PREFIX)) return

    // Check if user is authorized
    if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(msg.author.id)) {
        return
    }

    const args = msg.content.slice(PREFIX.length).trim().split(/ +/)
    const cmd = args.shift().toLowerCase()
    const query = args.join(" ")

    console.log(`\x1b[36m[COMMAND]\x1b[0m \x1b[33m${cmd}\x1b[0m | \x1b[35m👤 User:\x1b[0m ${msg.author.tag} (${msg.author.id}) | \x1b[34m💬 Channel:\x1b[0m ${msg.channel.name} (${msg.channel.id}) | \x1b[32m📝 Query:\x1b[0m ${query || "N/A"}`)

    if (!msg.member) return
    const voice = msg.member.voice.channel
    if (!voice) return msg.reply("Join VC dulu")

    let queue = queues.get(msg.guild.id)

    if (cmd === "play") {

        if (!query) {
            return msg.reply("Usage: ?play <song name, URL, or multiple URLs separated by space>")
        }

        let songs = []
        let limit = null

        // Check if query contains multiple URLs (space-separated)
        const urls = query.split(' ').filter(part => part.startsWith('http'))

        if (urls.length > 1) {
            // Multiple URLs playback
            msg.channel.send(`📥 Processing ${urls.length} URLs...`)

            for (const url of urls) {
                try {
                    if (url.includes("list=")) {
                        // This is a playlist URL
                        msg.channel.send(`📥 Fetching playlist from: ${url}`)
                        const playlistSongs = await getPlaylistVideos(url)

                        if (limit && limit > 0) {
                            songs.push(...playlistSongs.slice(0, limit))
                        } else {
                            songs.push(...playlistSongs)
                        }
                    } else {
                        // Single video URL
                        const songData = await searchSong(url)
                        songs.push({
                            title: songData.title,
                            url: songData.url,
                            duration: songData.duration,
                            durationFormatted: songData.durationFormatted
                        })
                    }
                } catch (error) {
                    console.error(`Error processing URL ${url}:`, error)
                    msg.channel.send(`❌ Failed to process URL: ${url}`)
                }
            }

            msg.channel.send(`📥 Added **${songs.length}** songs from multiple URLs`)

        } else if (query.startsWith("http")) {
            // Single URL or playlist
            const parts = query.split(" ")
            const url = parts[0]
            limit = parts[1] ? parseInt(parts[1]) : null

            if (url.includes("list=")) {
                // Playlist URL
                msg.channel.send("📥 Fetching playlist...")
                songs = await getPlaylistVideos(url)

                if (limit && limit > 0) {
                    songs = songs.slice(0, limit)
                    msg.channel.send(`📥 Added **${songs.length}** songs from playlist (limited to ${limit})`)
                } else {
                    msg.channel.send(`📥 Added **${songs.length}** songs from playlist`)
                }
            } else {
                // Single video URL
                try {
                    const songData = await searchSong(url)
                    songs.push({
                        title: songData.title,
                        url: songData.url,
                        duration: songData.duration,
                        durationFormatted: songData.durationFormatted
                    })
                    msg.channel.send(`📥 Added **${songs[0].title}**`)
                } catch (error) {
                    console.error("Error fetching single URL:", error)
                    msg.channel.send(`❌ Failed to fetch video from URL: ${url}`)
                    return saveState()
                }
            }
        } else {
            // Search query (song name)
            try {
                const songData = await searchSong(query)
                songs.push({
                    title: songData.title,
                    url: songData.url,
                    duration: songData.duration,
                    durationFormatted: songData.durationFormatted
                })
                msg.channel.send(`📥 Added **${songs[0].title}**`)
            } catch (error) {
                console.error("Error searching for song:", error)
                msg.channel.send(`❌ No results found for: ${query}`)
                return saveState()
            }
        }

        // Early return if no songs were successfully added
        if (songs.length === 0) {
            return saveState()
        }

        if (!queue) {

            const connection = joinVoiceChannel({
                channelId: voice.id,
                guildId: msg.guild.id,
                adapterCreator: msg.guild.voiceAdapterCreator
            })

            const player = createAudioPlayer()

            connection.subscribe(player)

            queue = {
                textChannel: msg.channel,
                connection,
                player,
                songs: [],
                voiceChannelId: voice.id,
                volume: 1.0,
                playHistory: [],
                loopMode: 0,
                isSkipping: false,
                playing: false,
                radioUrl: null,
                radioName: null,
                radioStopped: true,
                musicReconnectAttempts: 0,
                musicReconnectMessage: null,
                isMusicReconnecting: false
            }

            queues.set(msg.guild.id, queue)

        }

        // Stop radio if currently playing before starting YouTube (keep radioUrl to resume later)
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
            queue.radioFfmpeg = null
        }
        queue.radioStopped = true
        queue.playing = false
        queue.isReconnecting = false
        queue.isMusicReconnecting = false
        queue.musicReconnectAttempts = 0
        queue.musicReconnectMessage = null

        queue.songs.push(...songs)
        console.log(`🎵 Adding ${songs.length} songs to queue. Total songs: ${queue.songs.length}`)
        saveState()
        console.log(`💾 State saved. Queue songs count: ${queue.songs.length}`)

        if (queue.songs.length === songs.length) {
            playSong(msg.guild, queue.songs[0])
        }

    }

    if (cmd === "skip") {
        if (queue) {
            queue.isSkipping = true
            if (queue.currentProcesses) {
                queue.currentProcesses.ytdlp.kill()
                queue.currentProcesses.ff.kill()
            }
            queue.player.stop()
            saveState()
            msg.channel.send("⏭️ Skipped!")
        }
    }

    if (cmd === "loop") {
        if (!queue) return msg.reply("Tidak ada queue yang aktif")
        queue.loopMode = ((queue.loopMode || 0) + 1) % 3
        const modes = ["Off ❌", "Single 🔂", "All 🔁"]
        msg.channel.send(`🔂 Loop mode set to: **${modes[queue.loopMode]}**`)
        saveState()
    }

    if (cmd === "shuffle") {
        if (!queue || queue.songs.length < 3)
            return msg.reply("Butuh minimal 2 lagu di antrean untuk shuffle")

        // Fisher-Yates shuffle excluding the first song (currently playing)
        const playing = queue.songs.shift()
        for (let i = queue.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
        }
        queue.songs.unshift(playing)
        msg.channel.send("🔀 Queue berhasil di-shuffle!")
        saveState()
    }

    if (cmd === "queue") {
        if (!queue || queue.songs.length === 0)
            return msg.channel.send("Queue kosong")

        const modes = ["Off ❌", "Single 🔂", "All 🔁"]
        const loopStatus = modes[queue.loopMode || 0]

        let queueMsg = `📜 **Queue | Loop: ${loopStatus}**\n\n`
        queue.songs.slice(0, 10).forEach((song, i) => {
            if (song && song.title) {
                queueMsg += `${i + 1}. ${song.title}\n`
            } else {
                queueMsg += `${i + 1}. Unknown Song (Invalid data)\n`
            }
        })

        if (queue.songs.length > 10) {
            queueMsg += `... and ${queue.songs.length - 10} more`
        }

        msg.channel.send(queueMsg)
    }

    if (cmd === "stop") {
        if (queue?.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue?.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        if (queue?.metadataDetector) {
            queue.metadataDetector.stop()
            queue.metadataDetector = null
        }
        if (queue) {
            queue.radioStopped = true
            queue.playing = false
            queue.isReconnecting = false
            queue.isMusicReconnecting = false
            queue.radioUrl = null
            queue.radioName = null
            queue.hasReactionUI = false
            queue.radioMessage = null
            queue.musicReconnectMessage = null
        }
        queue.songs = []
        queue.player.stop()
        saveState()
        msg.channel.send("⏹️ Berhenti memutar musik/radio")
    }

    if (cmd === "leave") {
        if (!queue) return msg.reply("Bot belum join ke voice channel")

        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        if (queue.metadataDetector) {
            queue.metadataDetector.stop()
            queue.metadataDetector = null
        }
        if (queue.reactionCollector) {
            queue.reactionCollector.stop()
            queue.reactionCollector = null
        }

        msg.channel.send("👋 Keluar dari voice channel")
        queue.songs = []
        queue.player.stop()
        queue.connection.destroy()
        queues.delete(msg.guild.id)
        saveState()
    }

    if (cmd === "radio") {
        if (!query) {
            return msg.reply("Usage: ?radio <station name or URL>")
        }

        try {
            msg.channel.send("📻 Searching for radio station...")

            const radio = await resolveRadioMetadata(query)

            msg.channel.send(`📻 Found: **${radio.name}** ${radio.country ? `(${radio.country})` : ""}`)

            if (!queue) {
                const connection = joinVoiceChannel({
                    channelId: voice.id,
                    guildId: msg.guild.id,
                    adapterCreator: msg.guild.voiceAdapterCreator
                })

                const player = createAudioPlayer()

                connection.subscribe(player)

                queue = {
                    textChannel: msg.channel,
                    connection,
                    player,
                    songs: [],
                    radioFfmpeg: null,
                    voiceChannelId: voice.id,
                    volume: 1.0,
                    hasReactionUI: false,
                    playHistory: [],
                    loopMode: 0,
                    isSkipping: false,
                    musicReconnectAttempts: 0,
                    musicReconnectMessage: null,
                    isMusicReconnecting: false
                }

                queues.set(msg.guild.id, queue)
            } else {
                // Preserve existing volume and playHistory
                console.log("📻 Preserving existing volume and playHistory for radio")
            }

            queue.songs = []
            if (queue.currentProcesses) {
                queue.currentProcesses.ytdlp.kill()
                queue.currentProcesses.ff.kill()
            }

            playRadio(msg.guild, radio.url, radio.name)

        } catch (err) {
            console.error("Radio error:", err)
            msg.reply("❌ Error: " + err.message)
        }
    }

    if (cmd === "volume") {
        if (!queue) return msg.reply("Tidak ada musik yang sedang diputar")
        const volArg = args[0]
        if (!volArg) return msg.reply(`Volume saat ini: **${Math.round((queue.volume ?? 1.0) * 100)}%**`)

        let vol = parseFloat(volArg)
        if (isNaN(vol)) return msg.reply("Masukkan angka antara 0-100 atau 0.0-1.0")
        if (vol > 1) vol = vol / 100
        if (vol < 0) vol = 0
        if (vol > 5) vol = 5

        queue.volume = vol

        if (queue.player.state.status === AudioPlayerStatus.Playing && queue.player.state.resource?.volume) {
            queue.player.state.resource.volume.setVolume(vol)
        }

        saveState()

        msg.channel.send(`🔊 Volume diatur ke **${Math.round(vol * 100)}%**`)
    }

    if (cmd === "clearchat") {
        if (!queue) return msg.reply("Bot belum join ke voice channel")

        const textChannel = queue.textChannel
        if (!textChannel) return msg.reply("Tidak ada text channel terkait")

        const countArg = args[0]
        let limit = 100
        if (countArg) {
            limit = parseInt(countArg)
            if (isNaN(limit) || limit < 1) return msg.reply("Masukkan angka yang valid")
            if (limit > 100) return msg.reply("Maksimal 100 pesan")
        }

        try {
            msg.channel.send(`🗑️ Menghapus ${limit} pesan terakhir...`)

            const messages = await textChannel.messages.fetch({ limit: limit })
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

            const messagesToDelete = messages.filter(m => m.createdTimestamp > twoWeeksAgo)

            if (messagesToDelete.size === 0) {
                return msg.channel.send("ℹ️ Tidak ada pesan yang bisa dihapus (pesan lebih dari 14 hari tidak bisa dihapus)")
            }

            let deletedCount = 0
            for (const [id, message] of messagesToDelete) {
                try {
                    await message.delete()
                    deletedCount++
                } catch (err) {
                    console.error("Error deleting message:", err)
                }
            }

            msg.channel.send(`✅ Berhasil menghapus **${deletedCount}** pesan`)
        } catch (err) {
            console.error("Error deleting messages:", err)
            msg.channel.send("❌ Gagal menghapus pesan: " + err.message)
        }
    }

    if (cmd === "clearreactions") {
        try {
            msg.channel.send("🧹 Menghapus semua reaction dari channel...")
            await removeAllReactionsFromChannel(msg.channel)
            msg.channel.send("✅ Semua reaction berhasil dihapus")
        } catch (err) {
            console.error("Error clearing reactions:", err)
            msg.channel.send("❌ Gagal menghapus reaction: " + err.message)
        }
    }

    if (cmd === "sync") {
        if (!queue) return msg.reply("❌ Tidak ada queue yang aktif. Gunakan command ?play atau ?radio terlebih dahulu.")

        const voice = msg.member.voice.channel
        if (!voice) return msg.reply("❌ Kamu harus berada di voice channel!")

        try {
            // Update voice channel ID dan text channel
            queue.voiceChannelId = voice.id
            queue.textChannel = msg.channel

            // Join ke voice channel baru
            if (queue.connection) {
                queue.connection.destroy()
            }

            const connection = joinVoiceChannel({
                channelId: voice.id,
                guildId: msg.guild.id,
                adapterCreator: msg.guild.voiceAdapterCreator
            })

            connection.subscribe(queue.player)
            queue.connection = connection

            msg.channel.send("✅ Channel ID berhasil di-sync dan bot sudah join ke voice channel!")

            // Resume playback jika ada
            if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                playRadio(msg.guild, queue.radioUrl, queue.radioName)
            } else if (queue.songs && queue.songs.length > 0) {
                playSong(msg.guild, queue.songs[0])
            }

            saveState()

        } catch (err) {
            console.error("Error syncing channel:", err)
            msg.reply("❌ Gagal sync channel: " + err.message)
        }
    }

    if (cmd === "help") {
        const helpEmbed = `
🎵 **Music Selfbot Commands** 🎵

**?play** <song name> - Search and play a song
**?play** <single URL> - Play a single YouTube video
**?play** <playlist URL> [limit] - Play a YouTube playlist (optional limit)
**?play** <URL1 URL2 URL3...> - Play multiple URLs (space-separated)
**?skip** - Skip the current song
**?loop** - Toggle loop mode (Off/Single/All)
**?shuffle** - Shuffle the current queue
**?queue** - Show current queue and loop mode
**?stop** - Stop playing and clear queue
**?volume** [0-100] - Set or check playback volume
**?radio** <station name or URL> - Play a radio station
**?clearchat** [number] - Delete messages in text channel (default 100, max 100)
**?leave** - Leave voice channel and clear queue
**?sync** - Sync channel ID dan auto-join ke voice channel saat ini
**?state** - Show current bot state
**?panel** - Show control panel with reaction UI
**?help** - Show this help message

*You must be in a voice channel to use these commands*
        `.trim()

        msg.channel.send(helpEmbed)
    }

    if (cmd === "panel") {
        if (!queue) {
            return msg.reply("❌ Bot belum join ke voice channel. Gunakan command ?play atau ?radio terlebih dahulu.")
        }
        createCommandPanel(msg, queue)
    }

    if (cmd === "state") {
        let stateMsg = "📊 **Current Bot State**\n\n"

        if (queues.size === 0) {
            stateMsg += "❌ No active queues"
        } else {
            for (const [guildId, queue] of queues) {
                const guild = client.guilds.cache.get(guildId)
                const guildName = guild ? guild.name : "Unknown Guild"
                stateMsg += `🏠 **Guild:** ${guildName} (${guildId})\n`
                // Get channel names
                const voiceChannel = guild?.channels.cache.get(queue.voiceChannelId)
                const voiceChannelName = voiceChannel ? voiceChannel.name : queue.voiceChannelId
                const textChannelName = queue.textChannel?.name || queue.textChannel?.id || "N/A"

                stateMsg += `   📢 **Voice Channel:** ${voiceChannelName} (${queue.voiceChannelId})\n`
                stateMsg += `   💬 **Text Channel:** ${textChannelName} (${queue.textChannel?.id || "N/A"})\n`
                stateMsg += `   🔊 **Volume:** ${Math.round((queue.volume ?? 1.0) * 100)}%\n`

                // Show currently playing with duration and current time
                if (queue.songs && queue.songs.length > 0 && !queue.radioStopped) {
                    const currentSong = queue.songs[0]
                    let nowPlayingInfo = `🎶 **Now Playing:** ${currentSong?.title || 'Unknown Song'}`

                    // Add duration and current time if available
                    if (currentSong.duration) {
                        const currentTime = queue.currentSong && !queue.currentSong.isRadio ?
                            Math.floor((new Date() - new Date(queue.currentSong.startedAt)) / 1000) : 0

                        const formatTime = (seconds) => {
                            const mins = Math.floor(seconds / 60)
                            const secs = Math.floor(seconds % 60)
                            return `${mins}:${secs.toString().padStart(2, '0')}`
                        }

                        nowPlayingInfo += ` (${formatTime(currentTime)}/${formatTime(currentSong.duration)})`
                    }

                    stateMsg += `   ${nowPlayingInfo}\n`
                } else if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                    stateMsg += `   📻 **Now Playing Radio:** ${queue.radioName}\n`
                } else {
                    stateMsg += `   ⏸️ **Now Playing:** Nothing\n`
                }

                if (queue.radioUrl && queue.radioName) {
                    stateMsg += `   📻 **Radio:** ${queue.radioName}\n`
                    stateMsg += `   📻 **Radio URL:** ${queue.radioUrl}\n`
                    stateMsg += `   ⏸️ **Radio Stopped:** ${queue.radioStopped ? "Yes" : "No"}\n`
                }

                if (queue.songs && queue.songs.length > 0) {
                    stateMsg += `   🎵 **Songs in Queue:** ${queue.songs.length}\n`
                    queue.songs.slice(0, 5).forEach((song, index) => {
                        stateMsg += `      ${index + 1}. ${song?.title || 'Unknown Song'}\n`
                    })
                    if (queue.songs.length > 5) {
                        stateMsg += `      ... and ${queue.songs.length - 5} more\n`
                    }
                } else {
                    stateMsg += `   🎵 **Songs in Queue:** 0\n`
                }

                // Show play history (last 5 songs)
                if (queue.playHistory && queue.playHistory.length > 0) {
                    stateMsg += `   📜 **Recently Played (Last 5):**\n`
                    queue.playHistory.slice(0, 5).forEach((song, index) => {
                        const playTime = new Date(song.playedAt).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        stateMsg += `      ${index + 1}. ${song?.title || 'Unknown Song'} (${playTime})\n`
                    })
                } else {
                    stateMsg += `   📜 **Recently Played:** None\n`
                }

                stateMsg += "\n"
            }
        }

        stateMsg += `\n💾 **State File:** ${STATE_FILE}`
        stateMsg += `\n✅ **Total Active Queues:** ${queues.size}`

        msg.channel.send(stateMsg)
    }

})

client.login(TOKEN)