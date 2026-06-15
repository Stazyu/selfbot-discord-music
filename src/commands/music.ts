import { joinVoiceChannel, createAudioPlayer, AudioPlayerStatus } from "@discordjs/voice"
import { spawn } from "child_process"
import { Message, Guild, VoiceChannel } from "selfbotsdk-discordjs"
import { queues, saveState, createDefaultQueue } from "../core/queue"
import { playSong } from "../core/player"
import { searchSong } from "../services/youtube"
import { formatDuration } from "../utils/format"
import config from "../config"
import { Queue, PlaylistVideoEntry, Song } from "../types"

interface PlaylistJSON {
  entries: Array<{
    title?: string
    id?: string
    duration?: number
  }>
}

async function getPlaylistVideos(url: string): Promise<PlaylistVideoEntry[]> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(config.ytdlpExecutable, ["--dump-single-json", url])

    let output = ""
    let errorOutput = ""
    ytdlp.stdout!.on("data", (data: Buffer) => { output += data.toString() })
    ytdlp.stderr!.on("data", (data: Buffer) => { errorOutput += data.toString() })

    ytdlp.on("close", (code: number | null) => {
      if (code !== 0) {
        console.error("yt-dlp stderr:", errorOutput)
        reject(new Error("yt-dlp failed: " + errorOutput))
        return
      }

      try {
        const data: PlaylistJSON = JSON.parse(output)
        const videos = data.entries
          .filter(video => video && video.title && video.id)
          .map(video => ({
            title: video.title!,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            duration: video.duration || 0,
            durationFormatted: formatDuration(video.duration ?? null)
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

async function handlePlay(msg: Message, args: string[], guild: Guild, voice: VoiceChannel | null, queue: Queue | undefined): Promise<void> {
  const query = args.join(" ")

  if (!query) {
    msg.reply("Usage: ?play <song name, URL, or multiple URLs separated by space>")
    return
  }

  let songs: Song[] = []
  let limit: number | null = null

  const urls = query.split(" ").filter(part => part.startsWith("http"))

  if (urls.length > 1) {
    msg.channel.send(`📥 Processing ${urls.length} URLs...`)

    for (const url of urls) {
      try {
        if (url.includes("list=")) {
          msg.channel.send(`📥 Fetching playlist from: ${url}`)
          const playlistSongs = await getPlaylistVideos(url)
          songs.push(...playlistSongs)
        } else {
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
    const parts = query.split(" ")
    const url = parts[0]
    limit = parts[1] ? parseInt(parts[1]) : null

    if (url.includes("list=")) {
      msg.channel.send("📥 Fetching playlist...")
      songs = await getPlaylistVideos(url)

      if (limit && limit > 0) {
        songs = songs.slice(0, limit)
        msg.channel.send(`📥 Added **${songs.length}** songs from playlist (limited to ${limit})`)
      } else {
        msg.channel.send(`📥 Added **${songs.length}** songs from playlist`)
      }
    } else {
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
        saveState()
        return
      }
    }
  } else {
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
      saveState()
      return
    }
  }

  if (songs.length === 0) {
    saveState()
    return
  }

  if (!queue) {
    if (!voice) {
      msg.reply("Join VC dulu")
      return
    }
    const connection = joinVoiceChannel({
      channelId: voice.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    })

    const player = createAudioPlayer()
    connection.subscribe(player)

    const playbackChannel = (msg.channel as any).guild
      ? msg.channel
      : (voice.guild.systemChannel || voice.guild.channels.cache.find(c => {
          const ch = c as any
          return ch.isTextBased && ch.type === 0
        }) || voice.guild.channels.cache.first())

    queue = createDefaultQueue({
      textChannel: playbackChannel as any,
      connection,
      player,
      voiceChannelId: voice.id
    })

    queues.set(guild.id, queue)
  }

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
    playSong(guild, queue.songs[0])
  }
}

function handleSkip(msg: Message, queue: Queue | undefined): void {
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

function handleLoop(msg: Message, queue: Queue | undefined): void {
  if (!queue) {
    msg.reply("Tidak ada queue yang aktif")
    return
  }
  queue.loopMode = ((queue.loopMode || 0) + 1) % 3
  const modes = ["Off ❌", "Single 🔂", "All 🔁"]
  msg.channel.send(`🔂 Loop mode set to: **${modes[queue.loopMode]}**`)
  saveState()
}

function handleShuffle(msg: Message, queue: Queue | undefined): void {
  if (!queue || queue.songs.length < 3) {
    msg.reply("Butuh minimal 2 lagu di antrean untuk shuffle")
    return
  }

  const playing = queue.songs.shift()
  for (let i = queue.songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]]
  }
  if (playing) queue.songs.unshift(playing)
  msg.channel.send("🔀 Queue berhasil di-shuffle!")
  saveState()
}

function handleQueue(msg: Message, queue: Queue | undefined): void {
  if (!queue || queue.songs.length === 0) {
    msg.channel.send("Queue kosong")
    return
  }

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

function handleStop(msg: Message, queue: Queue | undefined): void {
  if (!queue) {
    msg.reply("❌ Tidak ada musik yang sedang diputar")
    return
  }

  if (queue.currentProcesses) {
    queue.currentProcesses.ytdlp.kill()
    queue.currentProcesses.ff.kill()
  }
  if (queue.radioFfmpeg) queue.radioFfmpeg.kill()
  if (queue.metadataDetector) {
    queue.metadataDetector.stop()
    queue.metadataDetector = undefined
  }

  queue.radioStopped = true
  queue.playing = false
  queue.isReconnecting = false
  queue.isMusicReconnecting = false
  queue.radioUrl = null
  queue.radioName = null
  queue.hasReactionUI = false
  queue.radioMessage = undefined
  queue.musicReconnectMessage = null
  queue.songs = []
  queue.player.stop()
  saveState()
  msg.channel.send("⏹️ Berhenti memutar musik/radio")
}

function handleVolume(msg: Message, args: string[], queue: Queue | undefined): void {
  if (!queue) {
    msg.reply("Tidak ada musik yang sedang diputar")
    return
  }
  const volArg = args[0]
  if (!volArg) {
    msg.reply(`Volume saat ini: **${Math.round((queue.volume ?? 1.0) * 100)}%**`)
    return
  }

  let vol = parseFloat(volArg)
  if (isNaN(vol)) {
    msg.reply("Masukkan angka antara 0-100 atau 0.0-1.0")
    return
  }
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

export {
  handlePlay,
  handleSkip,
  handleLoop,
  handleShuffle,
  handleQueue,
  handleStop,
  handleVolume,
  getPlaylistVideos
}
