import { createAudioResource, AudioPlayerStatus, StreamType } from "@discordjs/voice"
import { spawn } from "child_process"
import { Readable } from "stream"
import fs from "fs"
import config from "../config"
import { queues, saveState } from "./queue"
import { Song, Processes } from "../types"
import { sendToTextChannel } from "../utils/send"

interface StreamWithProcesses extends Readable {
  processes: Processes
}

function stream(url: string, seekTime: number | null = null): StreamWithProcesses {
  const ytdlpArgs: string[] = ["-f", "bestaudio", "-o", "-"]

  if (fs.existsSync(config.cookiesFile)) {
    ytdlpArgs.push("--cookies", config.cookiesFile)
  }

  if (seekTime) {
    const hh = Math.floor(seekTime / 3600)
    const mm = Math.floor((seekTime % 3600) / 60)
    const ss = Math.floor(seekTime % 60)
    const seekStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    ytdlpArgs.push("--download-sections", `*${seekStr}-`)
  }

  ytdlpArgs.push(url)

  const ytdlp = spawn(config.ytdlpExecutable, ytdlpArgs)

  const ff = spawn(config.ffmpeg, [
    "-i", "pipe:0",
    "-f", "opus",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1"
  ])

  ytdlp.stdout!.pipe(ff.stdin!)

  ytdlp.stderr!.on("data", (data: Buffer) => { console.error("yt-dlp stderr:", data.toString()) })
  ytdlp.on("error", (err: Error) => { console.error("yt-dlp error:", err) })
  ytdlp.on("close", (code: number | null) => {
    if (code !== 0 && code !== null) console.error("yt-dlp exited with code:", code)
  })

  ff.stderr!.on("data", (data: Buffer) => { console.error("ffmpeg stderr:", data.toString()) })
  ff.on("error", (err: Error) => { console.error("ffmpeg error:", err) })
  ff.on("close", (code: number | null) => {
    if (code !== 0 && code !== null) console.error("ffmpeg exited with code:", code)
  })

  const outStream = ff.stdout as unknown as StreamWithProcesses
  outStream.processes = { ytdlp, ff }
  return outStream
}

function handleMusicStreamingError(guild: any, song: Song, source: string, error: Error | null = null): void {
  const queue = queues.get(guild.id)
  if (!queue) return

  if (queue.songs[0] && queue.songs[0].url !== song.url) return

  console.log(`[music] ${source} failed, attempting reconnect...`)
  if (error) console.log(`[music] Error details:`, error.message || error)

  const isBrokenPipe = error && (
    (error.message && (
      error.message.includes("Broken pipe") ||
      error.message.includes("EPIPE") ||
      error.message.includes("Connection reset") ||
      error.message.includes("Connection timed out")
    )) ||
    (error as NodeJS.ErrnoException).code === "EPIPE" ||
    (error as NodeJS.ErrnoException).code === "ECONNRESET"
  )

  if (isBrokenPipe) {
    console.log(`[music] Broken pipe detected in ${source}, will attempt aggressive reconnect...`)
  }

  queue.isMusicReconnecting = true
  queue.musicReconnectAttempts++

  const MAX_MUSIC_RECONNECT_ATTEMPTS = isBrokenPipe ? 5 : 3

  if (queue.musicReconnectAttempts >= MAX_MUSIC_RECONNECT_ATTEMPTS) {
    const errorMsg = isBrokenPipe
      ? `❌ Musik terputus (broken pipe) setelah ${MAX_MUSIC_RECONNECT_ATTEMPTS} percobaan reconnect. Melanjutkan ke lagu berikutnya...`
      : `❌ Musik gagal diputar setelah ${MAX_MUSIC_RECONNECT_ATTEMPTS} percobaan reconnect. Melanjutkan ke lagu berikutnya...`

    sendToTextChannel(queue, errorMsg)
    queue.musicReconnectAttempts = 0
    queue.isMusicReconnecting = false
    queue.musicReconnectMessage = null
    queue.songs.shift()
    if (queue.songs.length > 0) {
      playSong(guild, queue.songs[0])
    }
    return
  }

  const baseDelay = isBrokenPipe ? 1500 : 3000
  const delay = Math.min(baseDelay * Math.pow(2, queue.musicReconnectAttempts - 1), 10000)
  const reconnectText = `❌ Musik terputus (${source}), mencoba reconnect (${queue.musicReconnectAttempts}/${MAX_MUSIC_RECONNECT_ATTEMPTS}) dalam ${delay / 1000} detik...`

  if (queue.musicReconnectMessage) {
    queue.musicReconnectMessage.edit(reconnectText).catch(console.error)
  } else {
    sendToTextChannel(queue, reconnectText).then((msg) => {
      queue.musicReconnectMessage = msg
    }).catch(console.error)
  }

  setTimeout(() => {
    const currentQueue = queues.get(guild.id)
    if (currentQueue && !currentQueue.radioStopped && currentQueue.connection?.state.status === "ready") {
      if (currentQueue.songs[0] && currentQueue.songs[0].url === song.url) {
        console.log(`[music] Attempting to reconnect to: ${song.title}`)
        queue.isMusicReconnecting = false
        playSong(guild, song)
      } else {
        queue.isMusicReconnecting = false
        queue.musicReconnectAttempts = 0
        if (queue.musicReconnectMessage) {
          queue.musicReconnectMessage.delete().catch(() => {})
          queue.musicReconnectMessage = null
        }
      }
    } else {
      queue.isMusicReconnecting = false
    }
  }, delay)
}

async function playSong(guild: any, song: Song | undefined): Promise<void> {
  const queue = queues.get(guild.id)
  if (!queue) return

  const { removeReactionUI } = await import("../ui/reactions")

  if (!song) {
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
      await removeReactionUI(queue.reactionMessage, null)
      queue.reactionMessage = undefined
    }
    if (queue.radioUrl && queue.radioName) {
      queue.radioStopped = false
      sendToTextChannel(queue, "✅ Musik selesai, kembali ke radio...")
      playRadio(guild, queue.radioUrl, queue.radioName)
      return
    }
    sendToTextChannel(queue, "✅ Selesai memutar semua lagu")
    return
  }

  console.log("Playing:", song)

  queue.playing = true

  queue.playHistory.unshift({
    title: song.title,
    url: song.url,
    playedAt: new Date().toISOString(),
    isRadio: false
  })
  if (queue.playHistory.length > 10) {
    queue.playHistory = queue.playHistory.slice(0, 10)
  }

  if (queue.currentProcesses) {
    queue.currentProcesses.ytdlp.kill()
    queue.currentProcesses.ff.kill()
  }

  let seekTime: number | null = null
  if (song.resumeFrom) {
    seekTime = song.resumeFrom
    console.log(`Resuming from ${seekTime} seconds`)
    delete song.resumeFrom
  }

  const startedAt = seekTime
    ? new Date(Date.now() - seekTime * 1000).toISOString()
    : new Date().toISOString()
  queue.currentSong = {
    title: song.title,
    url: song.url,
    startedAt,
    isRadio: false
  }

  const audio = stream(song.url, seekTime)

  const resource = createAudioResource(audio, { inlineVolume: true })
  resource.volume?.setVolume(queue.volume ?? 1.0)

  queue.currentProcesses = audio.processes

  audio.processes.ytdlp.on("error", (err: Error) => {
    if (queue.currentProcesses?.ytdlp !== audio.processes.ytdlp) return
    console.error("yt-dlp error:", err)
    if (!queue.isMusicReconnecting && !queue.radioStopped) {
      handleMusicStreamingError(guild, song, "yt-dlp", err)
    }
  })

  audio.processes.ff.on("error", (err: Error) => {
    if (queue.currentProcesses?.ff !== audio.processes.ff) return
    console.error("ffmpeg error:", err)
    if (!queue.isMusicReconnecting && !queue.radioStopped) {
      handleMusicStreamingError(guild, song, "ffmpeg", err)
    }
  })

  audio.processes.ytdlp.on("close", (code: number | null) => {
    if (queue.currentProcesses?.ytdlp !== audio.processes.ytdlp) return
    if (code !== 0 && code !== null && !queue.isMusicReconnecting && !queue.radioStopped) {
      console.error("yt-dlp exited with code:", code)
      const error = new Error(`yt-dlp exited with code ${code}`)
      ;(error as NodeJS.ErrnoException).code = String(code)
      handleMusicStreamingError(guild, song, "yt-dlp", error)
    }
  })

  audio.processes.ff.on("close", (code: number | null) => {
    if (queue.currentProcesses?.ff !== audio.processes.ff) return
    if (code !== 0 && code !== null && !queue.isMusicReconnecting && !queue.radioStopped) {
      console.error("ffmpeg exited with code:", code)
      const error = new Error(`ffmpeg exited with code ${code}`)
      ;(error as NodeJS.ErrnoException).code = String(code)
      handleMusicStreamingError(guild, song, "ffmpeg", error)
    }
  })

  queue.player.play(resource)

  queue.player.removeAllListeners("error")
  queue.connection?.removeAllListeners("error")

  queue.player.on("error", (err: Error) => {
    if (queue.currentProcesses !== audio.processes) return
    console.error("Audio player error:", err)
    if (!queue.isMusicReconnecting && !queue.radioStopped) {
      handleMusicStreamingError(guild, song, "player", err)
    }
  })

  queue.connection?.on("error", (err: Error) => {
    console.error("Voice connection error:", err)
    sendToTextChannel(queue, "❌ Error connecting to voice channel, stopping music...")
    queue.player.stop()
  })

  const durStr = song.durationFormatted
    ? ` [${song.durationFormatted}]`
    : song.duration
      ? ` [${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, "0")}]`
      : ""
  await sendToTextChannel(queue, `🎵 Now playing **${song.title}**${durStr} 🎵`)
  saveState()

  if (queue._saveInterval) clearInterval(queue._saveInterval)
  queue._saveInterval = setInterval(() => {
    if (queue.playing && queue.currentSong && !queue.currentSong.isRadio) {
      saveState(false)
    }
  }, 15000)

  queue.player.once(AudioPlayerStatus.Idle, () => {
    if (queue._saveInterval) {
      clearInterval(queue._saveInterval)
      queue._saveInterval = undefined
    }

    if (queue.currentProcesses) {
      queue.currentProcesses.ytdlp.kill()
      queue.currentProcesses.ff.kill()
    }

    if (queue.isMusicReconnecting) {
      queue.playing = false
      return
    }

    queue.playing = false
    queue.musicReconnectAttempts = 0
    queue.musicReconnectMessage = null

    if (queue.isSkipping || (queue.loopMode || 0) === 0) {
      queue.songs.shift()
      queue.isSkipping = false
    } else if (queue.loopMode === 2) {
      const shiftedSong = queue.songs.shift()
      if (shiftedSong) queue.songs.push(shiftedSong)
    }

    playSong(guild, queue.songs[0])
  })
}

async function playRadio(guild: any, radioUrl: string, radioName: string): Promise<void> {
  const queue = queues.get(guild.id)
  const { startRadioMetadataDetection } = await import("../services/radioMetadata")
  const { detectStreamCodec, spawnRadioFfmpeg } = await import("../services/radio")

  if (!queue) {
    console.error("Queue not found for radio")
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const resolvedUrl = await fetch(radioUrl, { signal: controller.signal }).then(res => {
      clearTimeout(timeout)
      return res.url
    })
    radioUrl = resolvedUrl
  } catch (err) {
    console.log(`[radio] Failed to resolve radio URL, using original: ${(err as Error).message}`)
  }

  console.log("Playing radio:", radioName)

  try {
    if (queue.radioFfmpeg) queue.radioFfmpeg.kill()

    // Clean up old listeners to prevent leak on reconnect
    queue.player.removeAllListeners("error")
    queue.player.removeAllListeners(AudioPlayerStatus.Idle)
    queue.connection?.removeAllListeners("error")

    queue.radioStopped = false
    queue.radioUrl = radioUrl
    queue.radioName = radioName
    if (!queue.isReconnecting) {
      queue.radioReconnectAttempts = 0
      queue.reconnectMessage = null
    }
    const MAX_RECONNECT_ATTEMPTS = 5

    if (queue.metadataDetector) {
      queue.metadataDetector.stop()
      queue.metadataDetector = undefined
    }

    const codec = await detectStreamCodec(radioUrl)

    const doRadioReconnect = (reason: string) => {
      if (queue.radioStopped || queue.isReconnecting) return false

      console.log(`[radio] Triggering reconnect due to: ${reason}`)

      if (queue.metadataDetector) {
        queue.metadataDetector.stop()
        queue.metadataDetector = undefined
      }

      queue.isReconnecting = true
      queue.radioReconnectAttempts!++

      if (queue.radioReconnectAttempts! >= MAX_RECONNECT_ATTEMPTS) {
        const errorMsg = `❌ Radio stream terputus (${reason}) setelah ${MAX_RECONNECT_ATTEMPTS} percobaan reconnect. Mohon coba lagi nanti.`
        sendToTextChannel(queue, errorMsg)
        queue.radioStopped = true
        queue.isReconnecting = false
        return false
      }

      const delay = 3000
      const reconnectMsg = `📻 Now playing radio: **${radioName}** (Reconnecting ${queue.radioReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...)`

      if (queue.radioMessage) {
        queue.radioMessage.edit(reconnectMsg).catch(console.error)
      } else {
        sendToTextChannel(queue, reconnectMsg)
      }

      setTimeout(() => {
        const currentQueue = queues.get(guild.id)
        if (currentQueue && !currentQueue.radioStopped) {
          playRadio(guild, radioUrl, radioName)
        } else {
          console.log(`[radio] Reconnect cancelled - Queue: ${!!currentQueue}, Stopped: ${currentQueue?.radioStopped}`)
          queue.isReconnecting = false
        }
      }, delay)

      return true
    }

    const ff = spawnRadioFfmpeg(radioUrl, codec, (code: number | null, signal: string | null) => {
      // Explicit SIGTERM: we intentionally killed ffmpeg (stop, new radio, etc.)
      if (signal === "SIGTERM" || signal === "15") {
        console.log("[radio] ffmpeg terminated normally (SIGTERM), no reconnect needed")
        return
      }

      // If radio was already stopped, ignore this close event
      if (queue.radioStopped) return

      // For radio streams, ANY exit (clean code 0, error, or killed by unexpected signal)
      // means the stream is gone and we need to reconnect
      const isBrokenPipe = ((code === 32 || code === 1) && signal === null) || ff._brokenPipeDetected
      const exitReason = code === 0 && signal === null
        ? "stream ended cleanly"
        : isBrokenPipe
          ? "broken pipe"
          : `exit code=${code} signal=${signal}`

      console.log(`[radio] ffmpeg closed: ${exitReason}, triggering reconnect...`)
      doRadioReconnect(exitReason)
    })
    queue.radioFfmpeg = ff

    const resource = createAudioResource(ff.stdout!, { inlineVolume: true, inputType: StreamType.OggOpus })
    resource.volume?.setVolume(queue.volume ?? 1.0)
    queue.player.play(resource)

    // Player error → reconnect
    queue.player.on("error", async (err: Error) => {
      console.error("Radio player error:", err)
      doRadioReconnect(`player error: ${err.message}`)
    })

    // Player Idle → stream ended without error, reconnect
    queue.player.once(AudioPlayerStatus.Idle, () => {
      if (queue.radioStopped || queue.isReconnecting) return
      console.log("[radio] Audio player went idle while radio should be playing, triggering reconnect...")
      doRadioReconnect("player idle")
    })

    queue.connection?.on("error", (err: Error) => {
      console.error("Voice connection error:", err)
      sendToTextChannel(queue, "❌ Error connecting to voice channel, stopping radio...")
      if (queue.radioFfmpeg) queue.radioFfmpeg.kill()
      if (queue._saveInterval) {
        clearInterval(queue._saveInterval)
        queue._saveInterval = undefined
      }
      queue.radioStopped = true
      queue.playing = false
      queue.isReconnecting = false
      queue.radioReconnectAttempts = 0
      saveState()
    })

    if (queue.radioMessage && queue.isReconnecting) {
      queue.radioMessage.edit(`📻 Now playing radio: **${radioName}**`).catch(console.error)
    } else {
      try {
        const radioMsg = await sendToTextChannel(queue, `📻 Now playing radio: **${radioName}**`)
        queue.radioMessage = radioMsg || undefined
      } catch (sendErr) {
        console.error(`[radio] Failed to send radio message: ${(sendErr as Error).message}`)
        queue.radioMessage = undefined
      }
    }

    if (queue.reconnectMessage) {
      queue.reconnectMessage.edit("✅ Berhasil reconnect radio").catch(console.error)
      queue.reconnectMessage = null
    }

    queue.isReconnecting = false
    queue.playing = true

    setTimeout(() => {
      queue.metadataDetector = startRadioMetadataDetection(radioUrl, queue)
    }, 2000)

    saveState()
  } catch (err) {
    console.error(`[radio] Unexpected error in playRadio: ${(err as Error).message}`)
    const errMsg = (err as Error).message
    if (errMsg && errMsg.includes("Missing Access")) {
      console.error("[radio] Stopping radio due to Missing Access (bot likely removed from channel/server)")
      if (queue) {
        queue.radioStopped = true
        queue.isReconnecting = false
        queue.playing = false
      }
      return
    }
    if (queue && !queue.radioStopped && !queue.isReconnecting) {
      queue.isReconnecting = true
      queue.radioReconnectAttempts = (queue.radioReconnectAttempts || 0) + 1
      const delay = 3000
      setTimeout(() => {
        const currentQueue = queues.get(guild.id)
        if (currentQueue && !currentQueue.radioStopped) {
          playRadio(guild, radioUrl, radioName)
        }
      }, delay)
    }
  }
}

export { stream, playSong, playRadio, handleMusicStreamingError }
