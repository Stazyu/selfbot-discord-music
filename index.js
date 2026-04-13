const { Client } = require("discord.js-selfbot-v13")
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice")
const { spawn } = require("child_process")
const yts = require("yt-search")
const ffmpeg = require("ffmpeg-static")
const https = require("https")
const dotenv = require("dotenv")
dotenv.config()


// Read config from environment variables or config.json
const config = {
    prefix: process.env.DISCORD_PREFIX || "?",
    token: process.env.DISCORD_TOKEN
}

// Fallback to config.json if env vars not set
if (!config.token) {
    try {
        const fileConfig = require("./config.json")
        config.prefix = fileConfig.prefix || config.prefix
        config.token = fileConfig.token
    } catch (err) {
        console.error("Error: DISCORD_TOKEN environment variable or config.json required")
        process.exit(1)
    }
}

const ytdlpExecutable = process.platform === "win32" ? "./yt-dlp.exe" : "./yt-dlp"

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

client.on("ready", () => {
    console.log("✅ Logged in as", client.user.tag)
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

function spawnRadioFfmpeg(inputUrl) {
    const args = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', inputUrl,
        '-vn',
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '2',
        '-b:a', '128k',
        'pipe:1'
    ];

    const ff = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    ff.on('spawn', () => console.log('[radio] ffmpeg spawned for', inputUrl));
    ff.on('close', (code) => {
        console.log('[radio] ffmpeg closed with code', code);
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
        queue.connection.destroy()
        queues.delete(guild.id)
        return
    }

    console.log("🎵 Playing:", song)

    if (queue.currentProcesses) {
        queue.currentProcesses.ytdlp.kill()
        queue.currentProcesses.ff.kill()
    }

    const audio = stream(song.url)

    const resource = createAudioResource(audio)

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
    })

    queue.textChannel.send(`🎵 Now playing **${song.title}**`)

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

    const ff = spawnRadioFfmpeg(radioUrl)
    queue.radioFfmpeg = ff

    const resource = createAudioResource(ff.stdout)

    queue.player.play(resource)

    queue.player.on("error", (err) => {
        console.error("Radio player error:", err)
        if (!queue.radioStopped) {
            queue.textChannel.send("❌ Error playing radio, trying to reconnect...")
            setTimeout(() => {
                const currentQueue = queues.get(guild.id)
                if (currentQueue && !currentQueue.radioStopped && currentQueue.connection.state.status === "ready") {
                    playRadio(guild, radioUrl, radioName)
                }
            }, 5000)
        }
    })

    queue.connection.on("error", (err) => {
        console.error("Voice connection error:", err)
        queue.textChannel.send("❌ Error connecting to voice channel, stopping radio...")
        if (queue.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        queue.radioStopped = true
    })

    queue.textChannel.send(`📻 Now playing radio: **${radioName}**`)

    queue.player.once(AudioPlayerStatus.Idle, () => {
        console.log("Radio stream ended, checking if should reconnect...")
        const currentQueue = queues.get(guild.id)
        if (currentQueue && !currentQueue.radioStopped && currentQueue.connection.state.status === "ready") {
            console.log("Radio stream ended, reconnecting...")
            playRadio(guild, radioUrl, radioName)
        } else {
            console.log("Radio stopped or connection lost, not reconnecting")
        }
    })
}

client.on("messageCreate", async msg => {

    if (!msg.content.startsWith(PREFIX)) return

    const args = msg.content.slice(PREFIX.length).trim().split(/ +/)
    const cmd = args.shift().toLowerCase()
    const query = args.join(" ")

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

                const search = await yts(query)

                songs.push({
                    title: search.all[0].title,
                    url: query
                })

                msg.channel.send(`📥 Added **${songs[0].title}**`)

            }

        } else {

            const search = await yts(query)

            songs.push({
                title: search.videos[0].title,
                url: search.videos[0].url
            })

            msg.channel.send(`📥 Added **${songs[0].title}**`)

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
                songs: []
            }

            queues.set(msg.guild.id, queue)

        }

        queue.songs.push(...songs)

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
    }

    if (cmd === "stop") {
        if (queue?.currentProcesses) {
            queue.currentProcesses.ytdlp.kill()
            queue.currentProcesses.ff.kill()
        }
        if (queue?.radioFfmpeg) {
            queue.radioFfmpeg.kill()
        }
        if (queue) {
            queue.radioStopped = true
        }
        queue.songs = []
        queue.player.stop()
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
                    radioFfmpeg: null
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

    if (cmd === "help") {
        const helpEmbed = `
🎵 **Music Selfbot Commands** 🎵

**?play** <song name or URL> - Play a song from YouTube
**?play** <playlist URL> [limit] - Play a YouTube playlist (optional limit)
**?skip** - Skip the current song
**?stop** - Stop playing and clear the queue
**?radio** <station name or URL> - Play a radio station
**?help** - Show this help message

*You must be in a voice channel to use these commands*
        `.trim()

        msg.channel.send(helpEmbed)
    }

})

client.login(TOKEN)