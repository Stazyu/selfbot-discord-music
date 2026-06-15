import { Client, Guild, VoiceChannel, TextChannel } from "selfbotsdk-discordjs"
import config from "./config"
import { queues, loadState, saveState } from "./core/queue"
import { playSong, playRadio } from "./core/player"
import { setClient, resumeAllMusic, registerVoiceStateUpdateHandler } from "./core/voice"
import { handleMessageCreate } from "./commands"
import { setPlaySongFunction, setPlayRadioFunction } from "./ui/reactions"
import { joinVoiceChannel, createAudioPlayer } from "@discordjs/voice"
import { Queue } from "./types"

const client = new Client()
setClient(client)

function gracefulShutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down gracefully...`)
  for (const [, queue] of queues) {
    if (queue.radioFfmpeg) queue.radioFfmpeg.kill()
    if (queue.currentProcesses) {
      queue.currentProcesses.ytdlp.kill()
      queue.currentProcesses.ff.kill()
    }
    if (queue.metadataDetector) queue.metadataDetector.stop()
  }
  process.exit(0)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err))
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err))

client.on("ready", async () => {
  console.log("✅ Logged in as", client.user!.tag)

  setPlaySongFunction(playSong)
  setPlayRadioFunction(playRadio)

  const state = loadState()
  if (state) {
    console.log(`📋 Found state for ${Object.keys(state).length} guild(s)`)
    for (const [guildId, guildState] of Object.entries(state)) {
      const guild: Guild | undefined = client.guilds.cache.get(guildId)
      if (!guild) {
        console.log(`⚠️ Guild ${guildId} not found in cache`)
        continue
      }

      const gs = guildState as Record<string, unknown>
      const voiceChannel = guild.channels.cache.get(gs.voiceChannelId as string) as VoiceChannel | undefined
      if (!voiceChannel) {
        console.log(`⚠️ Voice channel ${gs.voiceChannelId} not found in guild ${guildId}`)
        continue
      }

      const textChannel = client.channels.cache.get(gs.voiceChannelId as string) as TextChannel | undefined
      console.log(`📝 Found voice channel: ${voiceChannel.name} (${voiceChannel.id})`)

      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        })

        const player = createAudioPlayer()
        connection.subscribe(player)

        const queue: Queue = {
          voiceChannelId: gs.voiceChannelId as string,
          songs: (gs.songs || []) as any,
          radioUrl: (gs.radioUrl as string) || null,
          radioName: (gs.radioName as string) || null,
          radioStopped: (gs.radioStopped as boolean) ?? true,
          textChannel: textChannel,
          player: player,
          connection: connection,
          volume: (gs.volume as number) ?? 1.0,
          playHistory: (gs.playHistory || []) as any,
          loopMode: (gs.loopMode as number) || 0,
          isSkipping: false,
          playing: (gs.playing as boolean) || false,
          musicReconnectAttempts: (gs.musicReconnectAttempts as number) || 0,
          musicReconnectMessage: null,
          isMusicReconnecting: (gs.isMusicReconnecting as boolean) || false,
          radioFfmpeg: null,
          reactionCollector: null,
          panelCollector: null,
          reconnectMessage: null
        }
        queues.set(guildId, queue)

        console.log(`🔄 Resuming playback for guild ${guildId} - Queue: ${queue.songs.length} songs, Radio: ${queue.radioName || "None"}`)

        if (gs.radioUrl && gs.radioName && !gs.radioStopped) {
          console.log(`🔄 Resuming radio on startup: ${gs.radioName}`)
          queue.textChannel?.send("🔄 Reconnecting to radio after startup...")
          setTimeout(() => playRadio(guild, gs.radioUrl as string, gs.radioName as string), 3000)
        } else if (gs.songs && (gs.songs as any[]).length > 0) {
          console.log(`🔄 Resuming music queue on startup - ${queue.songs.length} songs`)
          const songs = gs.songs as Array<Record<string, unknown>>
          const resumeFrom = songs[0]?.resumeFrom as number | undefined
          const posStr = resumeFrom ? ` (${Math.floor(resumeFrom / 60)}:${(resumeFrom % 60).toString().padStart(2, "0")})` : ""
          queue.textChannel?.send(`🔄 Resuming music after startup${posStr}...`)
          setTimeout(() => playSong(guild, queue.songs[0]), 3000)
        } else {
          console.log(`ℹ️ No active playback to resume for guild ${guildId}`)
        }
      } catch (err) {
        console.error(`❌ Error resuming playback for guild ${guildId}:`, err)
      }
    }
  } else {
    console.log("ℹ️ No state file found - starting fresh")
  }
})

client.on("disconnect", () => {
  console.log("⚠️ Discord client disconnected, attempting to reconnect...")
  setTimeout(() => {
    if ((client as any).ws.status === 0) client.login(config.token)
  }, 5000)
})

client.on("reconnecting", () => console.log("🔄 Reconnecting to Discord..."))

client.on("resume", (replayed: number) => {
  console.log("✅ Resumed connection, replayed", replayed, "events")
  resumeAllMusic()
})

client.on("error", (err: Error) => console.error("Discord client error:", err))

registerVoiceStateUpdateHandler()

client.on("messageCreate", handleMessageCreate)

client.login(config.token)
