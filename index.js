const { Client } = require("discord.js-selfbot-v13")
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice")
const { spawn } = require("child_process")
const yts = require("yt-search")
const ffmpegStatic = require("ffmpeg-static")
const https = require("https")
const fs = require("fs")
const path = require("path")
const dotenv = require("dotenv")
const { createReactionUI } = require("./reactionUI")
const { startRadioMetadataDetection } = require("./radioMetadata")
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

async function getPlaylistVideos(url) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn(ytdlpExecutable, [
            "--flat-playlist",
            "--get-id",
            "--get-title",
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

            const lines = output.trim().split("\n")
            const videos = []

            for (let i = 0; i < lines.length; i += 2) {
                if (lines[i] && lines[i + 1]) {
                    videos.push({
                        title: lines[i],
                        url: `https://www.youtube.com/watch?v=${lines[i + 1]}`
                    })
                }
            }

            resolve(videos)
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
            playHistory: queue.playHistory || []
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
                    playHistory: guildState.playHistory || []
                }
                queues.set(guildId, queue)

                console.log(`🔄 Resuming playback for guild ${guildId}`)

                if (guildState.radioUrl && guildState.radioName && !guildState.radioStopped) {
                    setTimeout(() => playRadio(guild, guildState.radioUrl, guildState.radioName), 3000)
                } else if (guildState.songs && guildState.songs.length > 0) {
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

            if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                queue.radioReconnectAttempts = 0
                setTimeout(() => playRadio(guild, queue.radioUrl, queue.radioName), 2000)
            } else if (queue.songs.length > 0) {
                setTimeout(() => playSong(guild, queue.songs[0]), 2000)
            }
        } catch (err) {
            console.error(`Error resuming music for guild ${guildId}:`, err)
        }
    }
}

client.on("voiceStateUpdate", (oldState, newState) => {
    if (!oldState.member) return
    if (oldState.member.id === client.user.id && oldState.channel && !newState.channel) {
        console.log("⚠️ Bot was kicked from voice channel")
        const queue = queues.get(oldState.guild.id)
        if (queue) {
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

                            if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                                playRadio(guild, queue.radioUrl, queue.radioName)
                            } else if (queue.songs.length > 0) {
                                playSong(guild, queue.songs[0])
                            }
                        } catch (err) {
                            console.error("Error rejoining voice channel:", err)
                            queue.textChannel?.send("❌ Gagal rejoin ke VC")
                        }
                    }
                }
            }, 5000)
        }
    }
})

function stream(url) {

    const ytdlp = spawn(ytdlpExecutable, [
        "-f", "bestaudio",
        "-o", "-",
        url
    ])

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
        console.error('[radio] ffmpeg stderr:', data.toString());
    });

    ff.on('close', (code) => {
        console.log('[radio] ffmpeg closed with code', code);
        if (onClose) onClose(code);
        if (code !== 0 && code !== null && code !== 1) {
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
        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue.reactionCollector && typeof queue.reactionCollector.stop === "function") {
            queue.reactionCollector.stop()
            queue.reactionCollector = null
        }
        queue.hasReactionUI = false
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

    const audio = stream(song.url)

    const resource = createAudioResource(audio, { inlineVolume: true })
    resource.volume.setVolume(queue.volume ?? 1.0)

    queue.currentProcesses = audio.processes

    queue.player.play(resource)

    queue.player.on("error", (err) => {
        console.error("Audio player error:", err)
        queue.textChannel.send("❌ Error playing audio, skipping to next...")
        queue.songs.shift()
        playSong(guild, queue.songs[0])
    })

    queue.connection.on("error", (err) => {
        console.error("Voice connection error:", err)
        queue.textChannel.send("❌ Error connecting to voice channel, stopping music...")
        queue.songs = []
        queue.player.stop()
        queues.delete(msg.guild.id)
        saveState()
    })

    const nowPlayingMsg = await queue.textChannel.send(`🎵 Now playing **${song.title}** 🎵`)
    if (!queue.hasReactionUI) {
        queue.reactionCollector = createReactionUI(nowPlayingMsg, queue)
        queue.hasReactionUI = true
    }
    saveState()

    queue.player.once(AudioPlayerStatus.Idle, () => {
        if (queue.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        queue.songs.shift()
        playSong(guild, queue.songs[0])
    })

}

async function playRadio(guild, radioUrl, radioName) {
    const queue = queues.get(guild.id)

    if (!queue) {
        console.error("Queue not found for radio")
        return
    }

    console.log("📻 Playing radio:", radioName)

    if (queue.radioFfmpeg) {
        queue.radioFfmpeg.kill()
    }

    queue.radioStopped = false
    queue.radioUrl = radioUrl
    queue.radioName = radioName
    queue.radioReconnectAttempts = 0
    queue.reconnectMessage = null
    queue.isReconnecting = false
    const MAX_RECONNECT_ATTEMPTS = 5

    // Stop existing metadata detection if any
    if (queue.metadataDetector) {
        queue.metadataDetector.stop()
        queue.metadataDetector = null
    }

    const codec = await detectStreamCodec(radioUrl)
    const ff = spawnRadioFfmpeg(radioUrl, codec, (code) => {
        if (code !== 0 && code !== null && !queue.radioStopped && !queue.isReconnecting) {
            console.log('[radio] ffmpeg closed unexpectedly, triggering reconnect...');
            queue.isReconnecting = true
            queue.radioReconnectAttempts++

            if (queue.radioReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                queue.textChannel.send(`❌ Radio stream terputus setelah ${MAX_RECONNECT_ATTEMPTS} percobaan reconnect. Mohon coba lagi nanti.`)
                queue.radioStopped = true
                queue.isReconnecting = false
                return
            }

            const delay = Math.min(5000 * Math.pow(2, queue.radioReconnectAttempts - 1), 30000)
            const reconnectText = `❌ Radio stream terputus, mencoba reconnect (${queue.radioReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) dalam ${delay / 1000} detik...`

            if (queue.reconnectMessage) {
                queue.reconnectMessage.edit(reconnectText).catch(console.error)
            } else {
                queue.reconnectMessage = queue.textChannel.send(reconnectText)
            }

            setTimeout(() => {
                const currentQueue = queues.get(guild.id)
                if (currentQueue && !currentQueue.radioStopped && currentQueue.connection.state.status === "ready") {
                    playRadio(guild, radioUrl, radioName)
                } else {
                    queue.isReconnecting = false
                }
            }, delay)
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
        queue.isReconnecting = false
        queue.radioReconnectAttempts = 0
        queues.delete(guild.id)
        saveState()
    })

    const radioMsg = await queue.textChannel.send(`📻 Now playing radio: **${radioName}**`)
    queue.radioMessage = radioMsg
    if (!queue.hasReactionUI) {
        queue.reactionCollector = createReactionUI(radioMsg, queue)
        queue.hasReactionUI = true
    }
    if (queue.reconnectMessage) {
        queue.reconnectMessage.edit("✅ Berhasil reconnect radio").catch(console.error)
        queue.reconnectMessage = null
    }

    // Start metadata detection for current song
    queue.metadataDetector = startRadioMetadataDetection(radioUrl, queue)

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

        let songs = []
        let limit = null

        if (query.startsWith("http")) {

            if (query.includes("list=")) {

                const parts = query.split(" ")
                const url = parts[0]
                limit = parts[1] ? parseInt(parts[1]) : null

                msg.channel.send("📥 Fetching playlist...")
                songs = await getPlaylistVideos(url)

                if (limit && limit > 0) {
                    songs = songs.slice(0, limit)
                }

                msg.channel.send(`📥 Added **${songs.length}** songs from playlist`)

            } else {
                const videoId = extractYouTubeVideoId(query)
                const search = await yts({ videoId })
                console.log(search)

                songs.push({
                    title: search.title,
                    url: query
                })

                const addedMsg = await msg.channel.send(`📥 Added **${songs[0].title}**`)
                if (!queue.hasReactionUI) {
                    queue.reactionCollector = createReactionUI(addedMsg, queue)
                    queue.hasReactionUI = true
                }

            }

        } else {

            const search = await yts(query)

            songs.push({
                title: search.videos[0].title,
                url: search.videos[0].url
            })

            const addedMsg = await msg.channel.send(`📥 Added **${songs[0].title}**`)
            if (!queue.hasReactionUI) {
                queue.reactionCollector = createReactionUI(addedMsg, queue)
                queue.hasReactionUI = true
            }

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
                hasReactionUI: false,
                playHistory: []
            }

            queues.set(msg.guild.id, queue)

        }

        // Stop radio if currently playing before starting YouTube (keep radioUrl to resume later)
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
            queue.radioFfmpeg = null
        }
        queue.radioStopped = true
        queue.isReconnecting = false

        queue.songs.push(...songs)
        saveState()

        if (queue.songs.length === songs.length) {
            playSong(msg.guild, queue.songs[0])
        }

    }

    if (cmd === "skip") {
        if (queue?.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        queue?.player.stop()
        saveState()
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
            queue.isReconnecting = false
            queue.radioUrl = null
            queue.radioName = null
            queue.hasReactionUI = false
            queue.radioMessage = null
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
                    playHistory: []
                }

                queues.set(msg.guild.id, queue)
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

    if (cmd === "help") {
        const helpEmbed = `
🎵 **Music Selfbot Commands** 🎵

**?play** <song name or URL> - Play a song from YouTube
**?play** <playlist URL> [limit] - Play a YouTube playlist (optional limit)
**?skip** - Skip the current song
**?stop** - Stop playing and clear the queue
**?volume** [0-100] - Set or check playback volume
**?radio** <station name or URL> - Play a radio station
**?clearchat** [number] - Delete messages in text channel (default 100, max 100)
**?leave** - Leave voice channel and clear queue
**?state** - Show current bot state
**?help** - Show this help message

*You must be in a voice channel to use these commands*
        `.trim()

        msg.channel.send(helpEmbed)
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
                stateMsg += `   📢 **Voice Channel:** ${queue.voiceChannelId}\n`
                stateMsg += `   💬 **Text Channel:** ${queue.textChannel?.id || "N/A"}\n`
                stateMsg += `   🔊 **Volume:** ${Math.round((queue.volume ?? 1.0) * 100)}%\n`

                // Show currently playing
                if (queue.songs && queue.songs.length > 0 && !queue.radioStopped) {
                    stateMsg += `   🎶 **Now Playing:** ${queue.songs[0].title}\n`
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
                        stateMsg += `      ${index + 1}. ${song.title}\n`
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
                        stateMsg += `      ${index + 1}. ${song.title} (${playTime})\n`
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